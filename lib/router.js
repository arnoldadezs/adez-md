const { downloadMediaMessage } = require("@whiskeysockets/baileys");

// Minimal, robust router implementation to avoid runtime SyntaxError.
// This replaces a truncated/invalid file with a smaller, well-formed module.

// Extract plain text from common WhatsApp message shapes
function getMessageText(msg) {
  const m = msg?.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ""
  );
}

function getQuoted(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return null;
  return {
    key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant },
    message: ctx.quotedMessage,
  };
}

function isGroup(jid) {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

async function handleMessage(sock, msg, { PREFIX = ".", OWNER_NUMBER = "", BOT_NAME = "BOT", botPhone = "" } = {}) {
  try {
    const from = msg?.key?.remoteJid;
    const text = String(getMessageText(msg) || "").trim();

    if (!from) return;

    console.log(`[router] message from=${from} text="${text}"`);

    // Only react to commands that start with the prefix
    if (!text.startsWith(PREFIX)) return;

    const args = text.slice(PREFIX.length).trim().split(/\s+/).filter(Boolean);
    const command = (args.shift() || "").toLowerCase();
    const argText = args.join(" ").trim();

    const sender = msg.key.participant || msg.key.remoteJid || "";
    const isOwner = sender.includes(OWNER_NUMBER);

    const reply = async (content) => {
      try {
        return await sock.sendMessage(from, { text: String(content) }, { quoted: msg });
      } catch (err) {
        console.error("[router] reply failed:", err?.message || err);
      }
    };

    // Basic built-in commands (keeps behaviour minimal but useful)
    switch (command) {
      case "ping":
        await reply("Pong! 🏓");
        break;

      case "alive":
        await reply(`${BOT_NAME} is alive ✅\nPrefix: ${PREFIX}`);
        break;

      case "jid":
        await reply(`This chat's JID:\n${from}`);
        break;

      case "menu":
      case "help":
        await reply(`Commands: ${PREFIX}ping ${PREFIX}alive ${PREFIX}jid ${PREFIX}help`);
        break;

      case "sticker":
      case "s": {
        // Try to create a sticker if an image was sent or quoted
        const quoted = getQuoted(msg);
        const target = quoted || msg;
        if (!target.message?.imageMessage) {
          await reply(`Reply to an image with ${PREFIX}sticker`);
          break;
        }
        try {
          const buffer = await downloadMediaMessage(target, "buffer", {});
          // Send the buffer back as a sticker (Baileys accepts Buffer for sticker)
          await sock.sendMessage(from, { sticker: buffer }, { quoted: msg });
        } catch (err) {
          console.error("[router] sticker error:", err);
          await reply("Couldn't create sticker.");
        }
        break;
      }

      default:
        // Unknown command: show a short help message
        await reply(`Unknown command: ${command}. Send ${PREFIX}help for a short list.`);
    }
  } catch (err) {
    console.error("[router] handleMessage error:", err);
  }
}

module.exports = { handleMessage };
