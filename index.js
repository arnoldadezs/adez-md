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
const express = require("express");
const path = require("path");

const { handleMessage } = require("./lib/router");
const { useSupabaseAuthState } = require("./lib/authState");
const { upsertSession, removeSession, getResumableSessions } = require("./lib/supabase");

const BOT_NAME = "ADEZ MD";
const PREFIX = ".";
const MODE = "public";
const TOTAL_COMMANDS = 61;
const DEVELOPER = "Arnold Adez";
const DEVELOPER_CONTACT = "+254111783552";
const PORT = process.env.PORT || 3000;
const MAX_SESSIONS = Infinity;
const KNOWN_GOOD_WA_VERSION = [2, 3000, 1044015310];
const MAX_AUTO_RETRIES = 5;
const AUTH_RESET_AFTER_RETRIES = 2;

const sessions = new Map();

process.on("unhandledRejection", (e) => console.error("Unhandled rejection:", e));
process.on("uncaughtException", (e) => console.error("Uncaught exception:", e));

function normalizeNumber(raw) {
  return (raw || "").replace(/[^0-9]/g, "");
}

function isValidPhone(phone) {
  return phone.length >= 9;
}

function getEntry(phone) {
  let entry = sessions.get(phone);
  if (!entry) {
    entry = {
      sock: null,
      latestQR: null,
      status: "pairing",
      hasAlertedOwner: false,
      retryCount: 0,
      starting: false,
      pairingReady: false,
      retryTimer: null,
      lastSavePromise: null,
    };
    sessions.set(phone, entry);
  }
  return entry;
}

// Baileys creds are valid only when all required keys exist
function hasValidCreds(c) {
  return !!(
    c &&
    c.noiseKey &&
    c.signedIdentityKey &&
    c.pairingEphemeralKeyPair &&
    c.advSecretKey
  );
}

function scheduleRestart(phone, delay) {
  const entry = getEntry(phone);
  clearTimeout(entry.retryTimer);
  entry.retryTimer = setTimeout(() => startBot(phone), delay);
}

function slotsFull(phone) {
  return !sessions.has(phone) && sessions.size >= MAX_SESSIONS;
}

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET");
  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pair.html"));
});

app.get("/slots", (req, res) => {
  res.json({ used: sessions.size, max: MAX_SESSIONS === Infinity ? "unlimited" : MAX_SESSIONS });
});

app.get("/qr", async (req, res) => {
  const phone = normalizeNumber(req.query.phone);
  const entry = sessions.get(phone);

  if (!entry || !entry.latestQR) {
    res.status(404).send("No QR available yet. It may already be connected, or still starting up.");
    return;
  }

  try {
    const buffer = await qrcode.toBuffer(entry.latestQR, { width: 280 });
    res.type("png").send(buffer);
  } catch (err) {
    res.status(500).send("Failed to generate QR");
  }
});

app.get("/status", (req, res) => {
  const phone = normalizeNumber(req.query.phone);
  const entry = sessions.get(phone);
  res.json({ status: entry?.status || "not_started" });
});

app.get("/start-session", async (req, res) => {
  const phone = normalizeNumber(req.query.phone);
  if (!phone || !isValidPhone(phone)) {
    res.status(400).json({ error: "Enter a full phone number with country code, e.g. 254111783552" });
    return;
  }
  if (slotsFull(phone)) {
    res.status(403).json({ error: `All ${MAX_SESSIONS} slots are full.` });
    return;
  }

  try {
    const entry = getEntry(phone);
    if (!entry.sock) {
      await startBot(phone);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Start session error:", err);
    res.status(500).json({ error: "Failed to start session." });
  }
});

app.get("/request-code", async (req, res) => {
  const phone = normalizeNumber(req.query.phone);
  if (!phone || !isValidPhone(phone)) {
    res.status(400).json({ error: "Enter a full phone number with country code, e.g. 254111783552" });
    return;
  }
  if (slotsFull(phone)) {
    res.status(403).json({ error: `All ${MAX_SESSIONS} slots are full.` });
    return;
  }

  try {
    const entry = getEntry(phone);
    if (!entry.sock) {
      await startBot(phone);
    }

    if (!entry.sock || !entry.pairingReady) {
      res.status(503).json({ error: "Bot is still connecting, wait about 10 seconds and try again." });
      return;
    }
    if (entry.sock.authState?.creds?.registered) {
      res.status(400).json({ error: "Already connected. No pairing needed." });
      return;
    }
    if (!hasValidCreds(entry.sock.authState?.creds)) {
      res.status(500).json({ error: "Session was corrupt. It is being reset, try again in 15 seconds." });
      scheduleRestart(phone, 1000);
      return;
    }

    const code = await entry.sock.requestPairingCode(phone);
    res.json({ code });
  } catch (err) {
    console.error("Pairing code error:", err);
    res.status(500).json({ error: "Failed to generate pairing code. Try again." });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Pairing page running on port ${PORT}`);
  resumeAllSessions();
});

async function resumeAllSessions() {
  try {
    const phones = await getResumableSessions();
    console.log(`Resuming ${phones.length} previously linked session(s)...`);
    const limit = MAX_SESSIONS === Infinity ? phones.length : MAX_SESSIONS;
    for (const phone of phones.slice(0, limit)) {
      startBot(phone).catch((err) => console.error(`[${phone}] Failed to resume:`, err));
    }
  } catch (err) {
    console.error("Failed to resume sessions:", err);
  }
}

async function startBot(phone) {
  const entry = getEntry(phone);

  if (entry.starting) return;
  entry.starting = true;
  entry.pairingReady = false;

  console.log(`[${phone}] 🤖 Starting WhatsApp bot...`);

  try {
    if (entry.sock) {
      try {
        entry.sock.ev.removeAllListeners();
        entry.sock.end(undefined);
      } catch (e) {}
      entry.sock = null;
    }

    let auth = await useSupabaseAuthState(phone);

    // Don't wipe a fresh session immediately. A partial/empty creds object can happen
    // during startup or while retrying a temporary disconnect.
    if (!hasValidCreds(auth.state.creds)) {
      if (entry.retryCount >= AUTH_RESET_AFTER_RETRIES) {
        console.log(`[${phone}] 🧹 Saved session is incomplete or corrupt, resetting it...`);
        await auth.clearSession();
        await removeSession(phone);
        auth = await useSupabaseAuthState(phone);
      }
    }

    if (!hasValidCreds(auth.state.creds)) {
      Object.assign(auth.state.creds, initAuthCreds());
      await auth.saveCreds();
    }

    const { state, saveCreds, clearSession } = auth;

    let version = KNOWN_GOOD_WA_VERSION;
    try {
      const fetched = await fetchLatestBaileysVersion();
      if (fetched?.version) version = fetched.version;
    } catch (err) {
      console.log(`[${phone}] ⚠️ Could not fetch latest WA version, using known-good fallback.`);
    }

    const s = makeWASocket({
      auth: state,
      version,
      browser: Browsers.macOS("Chrome"),
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
    });

    entry.sock = s;

    s.ev.on("creds.update", async () => {
      try {
        console.log(`[${phone}] 💾 Saving auth creds...`);
        entry.lastSavePromise = saveCreds();
        await entry.lastSavePromise;
        console.log(`[${phone}] ✅ Auth creds saved`);
      } catch (err) {
        console.error(`[${phone}] ❌ Failed to save auth creds:`, err.message);
      }
    });

    s.ev.on("connection.update", async (update) => {
      if (entry.sock !== s) return;

      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        entry.latestQR = qr;
        entry.pairingReady = true;
        entry.status = "pairing";
        console.log(`[${phone}] 📱 QR generated`);
      }

      if (connection === "close") {
        entry.pairingReady = false;
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode ?? 0;
        console.log(`[${phone}] ⚠️ Connection closed (reason ${statusCode})`);
        entry.status = "disconnected";

        if (entry.lastSavePromise) {
          try {
            await entry.lastSavePromise;
          } catch (e) {
            console.warn(`[${phone}] lastSavePromise was rejected:`, e.message);
          }
        }

        if (statusCode === DisconnectReason.connectionReplaced) {
          console.log(`[${phone}] ⚠️ Another instance is using this session. Stop the bot on every other host!`);
        }

        const shouldResetSession =
          statusCode === DisconnectReason.loggedOut ||
          statusCode === DisconnectReason.badSession ||
          (statusCode === 500 && entry.retryCount >= AUTH_RESET_AFTER_RETRIES);

        if (shouldResetSession) {
          console.log(`[${phone}] 🧹 Session invalid. Clearing it, you will need to pair again.`);
          entry.retryCount = 0;
          entry.hasAlertedOwner = false;
          entry.latestQR = null;

          try {
            await clearSession();
            await removeSession(phone);
          } catch (e) {
            console.error(`[${phone}] Failed to clear session:`, e.message);
          }

          sessions.delete(phone);
          scheduleRestartOnFreshEntry(phone, 2000);
          return;
        }

        entry.retryCount++;
        try {
          await upsertSession(phone, "disconnected");
        } catch (e) {}

        const delay =
          entry.retryCount > MAX_AUTO_RETRIES
            ? 60000
            : Math.min(2000 * entry.retryCount, 20000);

        console.log(`[${phone}] ⏳ Retrying in ${Math.round(delay / 1000)}s (attempt ${entry.retryCount})...`);
        scheduleRestart(phone, delay);
      } else if (connection === "open") {
        entry.retryCount = 0;
        entry.latestQR = null;
        entry.status = "connected";

        try {
          await upsertSession(phone, "connected");
        } catch (e) {}

        console.log(`[${phone}] ${BOT_NAME} is connected and online! ✅`);

        if (!entry.hasAlertedOwner) {
          entry.hasAlertedOwner = true;
          const ownerJid = `${phone}@s.whatsapp.net`;
          s.sendMessage(ownerJid, {
            text:
              `✅ *${BOT_NAME}* linked successfully!\n\n` +
              `Bot Name: ${BOT_NAME}\n` +
              `Prefix: ${PREFIX}\n` +
              `Mode: ${MODE}\n` +
              `Commands: ${TOTAL_COMMANDS}\n` +
              `Developer: ${DEVELOPER}\n` +
              `Developer WhatsApp: ${DEVELOPER_CONTACT}\n\n` +
              `Send *${PREFIX}menu* to see all commands.\n\n` +
              `This bot is now linked to your own number — you're the owner of this instance.`,
          }).catch((err) => console.error(`[${phone}] Failed to send link alert:`, err));
        }
      }
    });

    s.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      if (entry.sock !== s) return;

      for (const msg of messages) {
        if (!msg.message || msg.key.remoteJid === "status@broadcast") continue;
        try {
          await handleMessage(s, msg, { PREFIX, OWNER_NUMBER: phone, BOT_NAME, botPhone: phone });
        } catch (err) {
          console.error(`[${phone}] Error handling message:`, err);
        }
      }
    });
  } catch (err) {
    console.error(`[${phone}] ❌ Error starting bot:`, err.message);
    entry.status = "disconnected";
    scheduleRestart(phone, 10000);
  } finally {
    entry.starting = false;
  }
}

// Explicit delayed restart after session reset
function scheduleRestartOnFreshEntry(phone, delay) {
  setTimeout(() => startBot(phone), delay);
}
