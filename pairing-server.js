const express = require("express");
const path = require("path");
const PairingManager = require("./pairing");
const { getResumableSessions } = require("./lib/supabase");

const PORT = process.env.PORT || 3000;
const pairManager = new PairingManager({
  onQRGenerated: (phone, qr) => {
    console.log(`[${phone}] 📱 QR generated and ready for pairing`);
  },
  onStatusChange: (phone, status) => {
    console.log(`[${phone}] Status changed: ${status}`);
  },
  onConnected: (phone) => {
    console.log(`[${phone}] Connected successfully`);
  },
  onDisconnected: (phone) => {
    console.log(`[${phone}] Disconnected`);
  },
  onMessage: async (msg, ctx) => {
    // This is a pairing app, so messages are not handled here.
    // Hook your message router here if needed.
    console.log(`[${ctx.phone}] Message received from ${msg.key.remoteJid}`);
  },
});

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
  res.json({
    used: pairManager.sessions.size,
    max: "unlimited",
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
    console.error("Start session error:", err);
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
    console.error("Pairing code error:", err);
    return res.status(500).json({
      error: err.message || "Failed to generate pairing code. Try again.",
    });
  }
});

app.get("/qr", async (req, res) => {
  const phone = pairManager.normalizeNumber(req.query.phone);
  const qr = pairManager.getLatestQR(phone);

  if (!phone || !qr) {
    return res.status(404).send("No QR available yet.");
  }

  try {
    const buffer = await require("qrcode").toBuffer(qr, { width: 280 });
    res.type("png").send(buffer);
  } catch (err) {
    console.error("QR generation error:", err);
    return res.status(500).send("Failed to generate QR");
  }
});

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
    console.error("Failed to resume sessions:", err);
  }
}

app.listen(PORT, () => {
  console.log(`✅ Pairing app running on port ${PORT}`);
  resumeLinkedSessions();
});
