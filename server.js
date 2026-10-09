// server.js — ONE Express app serving both pair.html and deploy.html on ONE port.
// Hosting platforms like Render/Railway/Heroku only expose process.env.PORT —
// running two separate app.listen() calls on fixed ports (as before) breaks on them.

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const { encodeSession, decodeSession } = require("./lib/sessionCodec");
const { startBot } = require("./bot");
const config = require("./config");

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pair.html"));
});

const TEMP_DIR = path.join(__dirname, "temp_sessions");
const DEPLOY_DIR = path.join(__dirname, "deployed_sessions");
fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.mkdirSync(DEPLOY_DIR, { recursive: true });

const pairRequests = new Map(); // requestId -> { status, code?, sessionId?, error?, lastDisconnect?, startedAt? }
const runningBots = new Map(); // id -> { sock, status }

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return String(value);
  }
}

// ───────── Pairing ─────────

app.post("/api/pair", async (req, res) => {
  const digitsOnly = String(req.body.phone || "").replace(/[^0-9]/g, "");
  if (digitsOnly.length < 9) {
    return res.status(400).json({ error: "Enter your WhatsApp number with country code, digits only." });
  }

  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const sessionDir = path.join(TEMP_DIR, requestId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const entry = { status: "connecting", startedAt: Date.now() };
  pairRequests.set(requestId, entry);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      browser: Browsers.ubuntu("Chrome"),
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const statusCode = update.lastDisconnect?.error?.output?.statusCode;
      const reason = update.lastDisconnect?.error?.message;

      if (update.connection === "close") {
        entry.lastDisconnect = update.lastDisconnect;
        entry.status = entry.status === "ready" ? entry.status : "error";

        if (entry.status === "error") {
          entry.error = `Connection closed before linking finished (code ${statusCode || "?"}).`;
        }

        console.log(
          `[PAIR] Connection closed for ${requestId}. code=${statusCode} reason=${reason}`
        );
        console.log(`[PAIR] Disconnect payload for ${requestId}: ${safeJson(update)}`);
      }

      if (update.connection === "open") {
        try {
          const sessionId = encodeSession(sessionDir);
          entry.status = "ready";
          entry.sessionId = sessionId;
          entry.error = null;

          const ownJid = sock.user.id;
          await sock.sendMessage(ownJid, {
            text:
              `✅ *${config.BOT_NAME}* linked successfully!\n\n` +
              `Copy the SESSION ID below and paste it into the Deploy page to bring your bot online:\n\n` +
              `${sessionId}\n\n` +
              `⚠️ Keep this private — anyone with it can control this WhatsApp account.`,
          });
        } catch (err) {
          entry.status = "error";
          entry.error = "Linked, but failed to generate/send session id.";
          console.error(`[PAIR] ${requestId} linked but failed to send session id:`, err);
        }
        setTimeout(() => sock.end(undefined), 4000);
      }
    });

    if (!state.creds.registered) {
      await new Promise((r) => setTimeout(r, 3000));
      const code = await sock.requestPairingCode(digitsOnly);
      entry.status = "code_ready";
      entry.code = code;
      console.log(`[PAIR] Code ${code} issued for request ${requestId}`);
    }

    res.json({ requestId, code: entry.code || null });
  } catch (err) {
    console.error(`[PAIR] ${requestId} failed to start pairing:`, err);
    entry.status = "error";
    entry.error = "Failed to start pairing. Try again.";
    res.status(500).json({ error: entry.error });
  }
});

app.get("/api/pair/status/:requestId", (req, res) => {
  const { requestId } = req.params;
  const entry = pairRequests.get(requestId);

  if (!entry) {
    return res.status(404).json({ status: "not_found", error: "Pairing request not found." });
  }

  res.json({
    requestId,
    status: entry.status,
    code: entry.code || null,
    sessionId: entry.sessionId || null,
    error: entry.error || null,
    lastDisconnect: entry.lastDisconnect || null,
  });
});

// ───────── Deploy existing session ─────────

app.post("/api/deploy", async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId || !String(sessionId).startsWith("ADEZ~")) {
    return res.status(400).json({ error: "Valid session ID is required." });
  }

  const sessionKey = crypto.randomBytes(6).toString("hex");
  const targetDir = path.join(DEPLOY_DIR, sessionKey);

  try {
    decodeSession(sessionId, targetDir);
    const bot = await startBot(targetDir, {
      onOpen: () => {
        console.log(`[DEPLOY] Bot online: ${sessionKey}`);
      },
      onClose: (statusCode) => {
        console.log(`[DEPLOY] Bot closed: ${sessionKey} code=${statusCode}`);
      },
    });

    runningBots.set(sessionKey, { sessionId, status: "online", sock: bot });
    res.json({ ok: true, sessionKey, status: "online" });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Invalid or corrupted session ID." });
  }
});

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    port: config.PORT,
    pairRequests: pairRequests.size,
    runningBots: runningBots.size,
  });
});

const PORT = config.PORT;
app.listen(PORT, () => {
  console.log(`🚀 ADEZ MD server listening on port ${PORT}`);
});

module.exports = app;
