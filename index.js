const express = require("express");
const path = require("path");
const PairingManager = require("./pairing");
const { handleMessage } = require("./lib/router");
const { getResumableSessions } = require("./lib/supabase");

const BOT_NAME = "ADEZ MD";
const PREFIX = ".";
const MODE = "public";
const TOTAL_COMMANDS = 61;
const DEVELOPER = "Arnold Adez";
const DEVELOPER_CONTACT = "+254111783552";
const PORT = process.env.PORT || 3000;

// Initialize the pairing manager
const pairManager = new PairingManager({
  onQRGenerated: (phone, qr) => {
    console.log(`[${phone}] 📱 QR generated`);
  },
  onStatusChange: (phone, status) => {
    console.log(`[${phone}] Status: ${status}`);
  },
  onConnected: (phone) => {
    console.log(`[${phone}] ✅ Connected and online!`);
  },
  onDisconnected: (phone) => {
    console.log(`[${phone}] Disconnected`);
  },
  onMessage: async (msg, ctx) => {
    try {
      await handleMessage(ctx.sock, msg, {
        PREFIX,
        OWNER_NUMBER: ctx.phone,
        BOT_NAME,
        botPhone: ctx.phone,
      });
    } catch (err) {
      console.error(`[${ctx.phone}] Error handling message:`, err.message);
    }
  },
});

// ========== EXPRESS SERVER ==========

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pair.html"));
});

app.get("/slots", (req, res) => {
  const status = pairManager.getSlotStatus();
  res.json({
    used: status.used,
    max: "unlimited",
    slots: status.slots,
  });
});

app.get("/status", (req, res) => {
  const phone = pairManager.normalizeNumber(req.query.phone);
  const status = pairManager.getStatus(phone);
  res.json(status);
});

app.get("/start-session", async (req, res) => {
  const phone = pairManager.normalizeNumber(req.query.phone);

  if (!phone || !pairManager.isValidPhone(phone)) {
    return res.status(400).json({
      error: "Enter a full phone number with country code, e.g. 254111783552",
    });
  }

  try {
    await pairManager.startBot(phone);
    return res.json({ ok: true, phone });
  } catch (err) {
    console.error(`[${phone}] Start session error:`, err.message);
    return res.status(500).json({ error: "Failed to start session." });
  }
});

app.get("/request-code", async (req, res) => {
  const phone = pairManager.normalizeNumber(req.query.phone);

  if (!phone || !pairManager.isValidPhone(phone)) {
    return res.status(400).json({
      error: "Enter a full phone number with country code, e.g. 254111783552",
    });
  }

  try {
    const code = await pairManager.requestPairingCode(phone);
    return res.json({ code });
  } catch (err) {
    console.error(`[${phone}] Pairing code error:`, err.message);
    return res.status(500).json({
      error: err.message || "Failed to generate pairing code. Try again.",
    });
  }
});

app.get("/qr", async (req, res) => {
  const phone = pairManager.normalizeNumber(req.query.phone);
  const qr = pairManager.getLatestQR(phone);

  if (!phone || !qr) {
    return res
      .status(404)
      .send("No QR available yet. It may already be connected, or still starting up.");
  }

  try {
    const buffer = await require("qrcode").toBuffer(qr, { width: 280 });
    res.type("png").send(buffer);
  } catch (err) {
    console.error(`[${phone}] QR generation error:`, err.message);
    return res.status(500).send("Failed to generate QR");
  }
});

// ========== STARTUP ==========

async function resumeLinkedSessions() {
  try {
    const phones = await getResumableSessions();
    if (!Array.isArray(phones) || phones.length === 0) {
      console.log("No previously linked session(s) to resume.");
      return;
    }

    console.log(`Resuming ${phones.length} previously linked session(s)...`);
    for (const phone of phones) {
      pairManager.startBot(phone).catch((err) =>
        console.error(`[${phone}] Resume failed:`, err.message)
      );
    }
  } catch (err) {
    console.error("Failed to resume sessions:", err.message);
  }
}

app.listen(PORT, () => {
  console.log(`✅ Pairing page running on port ${PORT}`);
  resumeLinkedSessions();
});

// ========== GRACEFUL SHUTDOWN ==========

process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await pairManager.shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await pairManager.shutdown();
  process.exit(0);
});

process.on("unhandledRejection", (e) =>
  console.error("Unhandled rejection:", e.message)
);
process.on("uncaughtException", (e) =>
  console.error("Uncaught exception:", e.message)
);
