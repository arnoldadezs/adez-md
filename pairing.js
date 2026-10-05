const {
  default: makeWASocket,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  initAuthCreds,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const qrcode = require("qrcode");
const { useSupabaseAuthState } = require("./lib/authState");
const { upsertSession, removeSession } = require("./lib/supabase");

// ============================================================================
// PAIRING MANAGER - Handles all WhatsApp connection lifecycle
// ============================================================================

class PairingManager {
  constructor(options = {}) {
    this.sessions = new Map();
    this.KNOWN_GOOD_WA_VERSION = [2, 3000, 1044015310];
    this.MAX_AUTO_RETRIES = 5;
    this.AUTH_RESET_AFTER_RETRIES = 3;
    this.logger = pino({ level: "silent" });
    this.onQRGenerated = options.onQRGenerated || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onConnected = options.onConnected || (() => {});
    this.onDisconnected = options.onDisconnected || (() => {});
    this.onMessage = options.onMessage || (() => {});
  }

  /**
   * Get or create a session entry
   */
  getEntry(phone) {
    let entry = this.sessions.get(phone);
    if (!entry) {
      entry = {
        phone,
        sock: null,
        latestQR: null,
        status: "idle", // idle -> pairing -> connected -> disconnected
        hasAlertedOwner: false,
        retryCount: 0,
        startingPromise: null,
        pairingReady: false,
        retryTimer: null,
        lastSavePromise: null,
        createdAt: new Date(),
        lastUpdate: new Date(),
        errorLog: [],
      };
      this.sessions.set(phone, entry);
    }
    return entry;
  }

  /**
   * Validate phone number format
   */
  normalizeNumber(raw) {
    return (raw || "").replace(/[^0-9]/g, "");
  }

  isValidPhone(phone) {
    return phone.length >= 9 && phone.length <= 15;
  }

  /**
   * Check if credentials are valid for Baileys
   */
  hasValidCreds(creds) {
    return !!(
      creds &&
      creds.noiseKey &&
      creds.signedIdentityKey &&
      creds.pairingEphemeralKeyPair &&
      creds.advSecretKey
    );
  }

  /**
   * Schedule a restart with exponential backoff
   */
  scheduleRestart(phone, delay = 2000) {
    const entry = this.getEntry(phone);
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    entry.retryTimer = setTimeout(() => {
      console.log(`[${phone}] ⏰ Scheduled restart triggered`);
      this.startBot(phone).catch((err) =>
        console.error(`[${phone}] Restart failed:`, err.message)
      );
    }, delay);
  }

  /**
   * Log error to entry history
   */
  logError(phone, error) {
    const entry = this.getEntry(phone);
    const timestamp = new Date().toISOString();
    entry.errorLog.push({ timestamp, error: error.toString() });
    if (entry.errorLog.length > 10) entry.errorLog.shift();
  }

  /**
   * Get current slot status
   */
  getSlotStatus() {
    return {
      used: this.sessions.size,
      slots: Array.from(this.sessions.values()).map((entry) => ({
        phone: entry.phone,
        status: entry.status,
        retries: entry.retryCount,
        uptime: Math.round((Date.now() - entry.createdAt) / 1000),
      })),
    };
  }

  /**
   * Get latest QR for a phone
   */
  getLatestQR(phone) {
    const entry = this.sessions.get(phone);
    return entry?.latestQR || null;
  }

  /**
   * Get session status
   */
  getStatus(phone) {
    const entry = this.sessions.get(phone);
    return {
      status: entry?.status || "not_started",
      retries: entry?.retryCount || 0,
      errors: entry?.errorLog || [],
    };
  }

  /**
   * Main bot start function - with singleton pattern
   */
  async startBot(phone, options = {}) {
    phone = this.normalizeNumber(phone);

    if (!this.isValidPhone(phone)) {
      throw new Error("Invalid phone number format");
    }

    const entry = this.getEntry(phone);

    // Prevent concurrent startups
    if (entry.startingPromise) {
      console.log(`[${phone}] ⏳ Already starting, waiting...`);
      return entry.startingPromise;
    }

    // Create the startup promise
    const startPromise = this._doStartBot(phone, options);
    entry.startingPromise = startPromise;

    try {
      await startPromise;
    } finally {
      entry.startingPromise = null;
    }

    return startPromise;
  }

  /**
   * Actual startup logic
   */
  async _doStartBot(phone, options = {}) {
    const entry = this.getEntry(phone);
    entry.lastUpdate = new Date();

    console.log(`[${phone}] 🤖 Starting WhatsApp bot...`);
    this.onStatusChange(phone, "starting");

    try {
      // Kill old socket
      if (entry.sock) {
        try {
          entry.sock.ev.removeAllListeners();
          entry.sock.end(undefined);
        } catch (e) {}
        entry.sock = null;
      }

      // Load or initialize auth state
      let auth = await useSupabaseAuthState(phone);

      // Smart creds reset logic:
      if (!this.hasValidCreds(auth.state.creds)) {
        if (
          entry.retryCount >= this.AUTH_RESET_AFTER_RETRIES ||
          options.forceReset
        ) {
          console.log(
            `[${phone}] 🧹 Creds incomplete after ${entry.retryCount} retries. Resetting...`
          );
          await auth.clearSession();
          await removeSession(phone);
          auth = await useSupabaseAuthState(phone);
        }
      }

      // Initialize fresh creds if still empty
      if (!this.hasValidCreds(auth.state.creds)) {
        console.log(`[${phone}] 🆕 Creating fresh credentials...`);
        Object.assign(auth.state.creds, initAuthCreds());
        await auth.saveCreds();
      }

      const { state, saveCreds, clearSession } = auth;

      let version = this.KNOWN_GOOD_WA_VERSION;
      try {
        const fetched = await fetchLatestBaileysVersion();
        if (fetched?.version) {
          version = fetched.version;
          console.log(`[${phone}] 📦 Using WA version: ${version.join(".")}`);
        }
      } catch (err) {
        console.log(
          `[${phone}] ⚠️ Could not fetch WA version, using fallback`
        );
      }

      const s = makeWASocket({
        auth: state,
        version,
        browser: Browsers.macOS("Chrome"),
        logger: this.logger,
        printQRInTerminal: false,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        emitOwnEventsOnly: false,
      });

      entry.sock = s;
      entry.status = "pairing";
      entry.pairingReady = false;

      s.ev.on("creds.update", async () => {
        try {
          console.log(`[${phone}] 💾 Saving credentials...`);
          entry.lastSavePromise = saveCreds();
          await entry.lastSavePromise;
          console.log(`[${phone}] ✅ Credentials saved`);
        } catch (err) {
          console.error(`[${phone}] ❌ Failed to save credentials:`, err.message);
          this.logError(phone, err);
        }
      });

      s.ev.on("connection.update", async (update) => {
        if (entry.sock !== s) {
          console.log(`[${phone}] ⏭️ Ignoring event from old socket`);
          return;
        }

        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          entry.latestQR = qr;
          entry.pairingReady = true;
          entry.status = "pairing";
          entry.lastUpdate = new Date();
          console.log(`[${phone}] 📱 QR generated`);
          this.onQRGenerated(phone, qr);
        }

        if (connection === "connecting") {
          entry.status = "connecting";
          entry.lastUpdate = new Date();
          console.log(`[${phone}] 🔗 Connecting...`);
          this.onStatusChange(phone, "connecting");
        }

        if (connection === "open") {
          entry.retryCount = 0;
          entry.latestQR = null;
          entry.status = "connected";
          entry.lastUpdate = new Date();
          console.log(`[${phone}] ✅ Connected and online!`);
          this.onStatusChange(phone, "connected");
          this.onConnected(phone);

          try {
            await upsertSession(phone, "connected");
          } catch (e) {}

          if (!entry.hasAlertedOwner) {
            entry.hasAlertedOwner = true;
            setTimeout(() => this._sendWelcomeMessage(s, phone), 1000);
          }
        }

        if (connection === "close") {
          entry.pairingReady = false;
          entry.lastUpdate = new Date();

          const err = lastDisconnect?.error;
          const httpStatus = new Boom(err)?.output?.statusCode ?? 0;
          const baileyReason =
            err?.output?.statusCode ??
            err?.statusCode ??
            (typeof err?.message === "string" && /bad session/i.test(err.message)
              ? DisconnectReason.badSession
              : 0);

          console.log(
            `[${phone}] ⚠️ Connection closed (http=${httpStatus}, baileysReason=${baileyReason})`
          );

          if (entry.lastSavePromise) {
            try {
              await entry.lastSavePromise;
              console.log(`[${phone}] ✅ Last save confirmed before handling disconnect`);
            } catch (e) {
              console.warn(`[${phone}] ⚠️ Last save was rejected:`, e.message);
            }
          }

          this._handleDisconnect(phone, baileyReason, clearSession);
        }
      });

      s.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify" || entry.sock !== s) return;

        for (const msg of messages) {
          if (!msg.message || msg.key.remoteJid === "status@broadcast") {
            continue;
          }
          try {
            this.onMessage(msg, {
              sock: s,
              phone,
              entry,
            });
          } catch (err) {
            console.error(`[${phone}] Error handling message:`, err.message);
            this.logError(phone, err);
          }
        }
      });
    } catch (err) {
      console.error(`[${phone}] ❌ Error starting bot:`, err.message);
      this.logError(phone, err);
      entry.status = "error";
      this.onStatusChange(phone, "error");

      const delay = Math.min(2000 * (entry.retryCount + 1), 30000);
      this.scheduleRestart(phone, delay);
    }
  }

  /**
   * Handle disconnect logic
   * Only true bad sessions should wipe auth.
   * 408/500/515/restartRequired are temporary transport errors and should retry.
   */
  async _handleDisconnect(phone, reason, clearSession) {
    const entry = this.getEntry(phone);
    entry.status = "disconnected";
    this.onStatusChange(phone, "disconnected");
    this.onDisconnected(phone);

    const shouldResetSession =
      reason === DisconnectReason.loggedOut ||
      reason === DisconnectReason.badSession;

    if (shouldResetSession) {
      console.log(
        `[${phone}] 🧹 Session must be reset (reason: ${reason})`
      );
      entry.retryCount = 0;
      entry.hasAlertedOwner = false;
      entry.latestQR = null;

      try {
        await clearSession();
        await removeSession(phone);
      } catch (e) {
        console.error(`[${phone}] Failed to clear session:`, e.message);
        this.logError(phone, e);
      }

      this.sessions.delete(phone);
      this.scheduleRestartOnFreshEntry(phone, 3000);
      return;
    }

    entry.retryCount++;
    const delay =
      entry.retryCount > this.MAX_AUTO_RETRIES
        ? 60000
        : Math.min(2000 * entry.retryCount, 20000);

    console.log(
      `[${phone}] ⏳ Retrying in ${Math.round(delay / 1000)}s (attempt ${entry.retryCount}/${this.MAX_AUTO_RETRIES})`
    );

    try {
      await upsertSession(phone, "disconnected");
    } catch (e) {}

    this.scheduleRestart(phone, delay);
  }

  scheduleRestartOnFreshEntry(phone, delay) {
    setTimeout(() => {
      this.startBot(phone).catch((err) =>
        console.error(`[${phone}] Fresh restart failed:`, err.message)
      );
    }, delay);
  }

  async _sendWelcomeMessage(sock, phone) {
    try {
      const ownerJid = `${phone}@s.whatsapp.net`;
      await sock.sendMessage(ownerJid, {
        text:
          `✅ *ADEZ MD* linked successfully!\n\n` +
          `🤖 Bot Name: ADEZ MD\n` +
          `🔧 Prefix: .\n` +
          `👤 Mode: Public\n` +
          `💾 Commands: 61\n` +
          `👨‍💻 Developer: Arnold Adez\n` +
          `📱 Contact: +254111783552\n\n` +
          `📖 Send *.menu* to see all available commands.\n\n` +
          `You are the owner of this bot instance.`,
      });
      console.log(`[${phone}] 📨 Welcome message sent`);
    } catch (err) {
      console.error(`[${phone}] Failed to send welcome message:`, err.message);
    }
  }

  async requestPairingCode(phone) {
    phone = this.normalizeNumber(phone);

    if (!this.isValidPhone(phone)) {
      throw new Error("Invalid phone number");
    }

    const entry = this.getEntry(phone);

    if (!entry.sock) {
      await this.startBot(phone);
    }

    let attempts = 0;
    while (!entry.pairingReady && attempts < 30) {
      await new Promise((r) => setTimeout(r, 500));
      attempts++;
    }

    if (!entry.sock || !entry.pairingReady) {
      throw new Error("Bot is still connecting, please wait 10 seconds and try again");
    }

    if (entry.sock.authState?.creds?.registered) {
      throw new Error("Already connected. No pairing needed.");
    }

    console.log(`[${phone}] 📝 Generating pairing code...`);
    const code = await entry.sock.requestPairingCode(phone);
    console.log(`[${phone}] ✅ Pairing code generated: ${code}`);

    return code;
  }

  async stopSession(phone) {
    phone = this.normalizeNumber(phone);
    const entry = this.sessions.get(phone);

    if (!entry) return;

    console.log(`[${phone}] 🛑 Stopping session...`);

    if (entry.retryTimer) clearTimeout(entry.retryTimer);

    if (entry.sock) {
      try {
        entry.sock.ev.removeAllListeners();
        entry.sock.end(undefined);
      } catch (e) {}
    }

    this.sessions.delete(phone);
    console.log(`[${phone}] ✅ Session stopped`);
  }

  async resumeSessions(phones) {
    console.log(`⏳ Resuming ${phones.length} session(s)...`);
    for (const phone of phones) {
      this.startBot(phone).catch((err) =>
        console.error(`[${phone}] Resume failed:`, err.message)
      );
    }
  }

  async shutdown() {
    console.log(`🛑 Shutting down all ${this.sessions.size} session(s)...`);
    const phones = Array.from(this.sessions.keys());
    for (const phone of phones) {
      await this.stopSession(phone);
    }
    console.log("✅ All sessions shut down");
  }
}

module.exports = PairingManager;
