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
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const { encodeSession, decodeSession } = require("./lib/sessionCodec");
const { startBot } = require("./bot");
const config = require("./config");

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

const TEMP_DIR = path.join(__dirname, "temp_sessions");
const DEPLOY_DIR = path.join(__dirname, "deployed_sessions");
fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.mkdirSync(DEPLOY_DIR, { recursive: true });

const pairRequests = new Map(); // requestId -> { status, code?, sessionId?, error? }
const runningBots = new Map(); // id -> { sock, status }

// ───────── Pairing ─────────

app.post("/api/pair", async (req, res) => {
  const digitsOnly = String(req.body.phone || "").replace(/[^0-9]/g, "");
  if (digitsOnly.length < 9) {
    return res.status(400).json({ error: "Enter your WhatsApp number with country code, digits only." });
  }

  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const sessionDir = path.join(TEMP_DIR, requestId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const entry = { status: "connecting" };
  pairRequests.set(requestId, entry);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      browser: [config.BOT_NAME, "Chrome", "1.0.0"],
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      if (update.connection === "open") {
        try {
          const sessionId = encodeSession(sessionDir);
          entry.status = "ready";
          entry.sessionId = sessionId;

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
          console.error(err);
        }
        setTimeout(() => sock.end(undefined), 4000);
      }
    });

    if (!state.creds.registered) {
      await new Promise((r) => setTimeout(r, 1500));
      const code = await sock.requestPairingCode(digitsOnly);
      entry.status = "code_ready";
      entry.code = code;
      console.log(`[PAIR] Code ${code} issued for request ${requestId}`);
    }

    res.json({ requestId, code: entry.code || null });
  } catch (err) {
    console.error(err);
    entry.status = "error";
    entry.error = "Failed to start pairing. Try again.";
    res.status(500).json({ error: entry.error });
  }
});

app.get("/api/pair/status/:id", (req, res) => {
  const data = pairRequests.get(req.params.id);
  if (!data) return res.status(404).json({ error: "Unknown request id" });
  res.json(data);
});

// ───────── Deploy ─────────

app.post("/api/deploy", async (req, res) => {
  const sessionId = String(req.body.sessionId || "").trim();
  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required." });
  }

  const id = crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 16);

  if (runningBots.has(id)) {
    return res.json({ status: "already_running", id });
  }

  const sessionDir = path.join(DEPLOY_DIR, id);

  try {
    decodeSession(sessionId, sessionDir);
  } catch (err) {
    return res.status(400).json({ error: "That session ID looks invalid or corrupted." });
  }

  const entry = { sock: null, status: "starting" };
  runningBots.set(id, entry);

  try {
    const sock = await startBot(sessionDir, {
      onOpen: () => { entry.status = "online"; },
      onClose: () => { entry.status = "offline"; },
    });
    entry.sock = sock;
    res.json({ status: "deployed", id });
  } catch (err) {
    console.error(err);
    runningBots.delete(id);
    res.status(500).json({ error: "Failed to deploy bot with this session." });
  }
});

app.get("/api/deploy/status/:id", (req, res) => {
  const entry = runningBots.get(req.params.id);
  if (!entry) return res.json({ running: false });
  res.json({ running: true, status: entry.status });
});

// ───────── Pages ─────────

app.get("/", (req, res) => res.redirect("/pair.html"));

// ───────── Start (single port — required for Render/Railway/Heroku) ─────────

const PORT = process.env.PORT || config.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ ADEZ MD web services running on port ${PORT}`);
  console.log(`   Pair:   /pair.html`);
  console.log(`   Deploy: /deploy.html`);
});
