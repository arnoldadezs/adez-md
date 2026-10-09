// bot.js — core ADEZ MD logic. Called by server.js for both the temporary pairing
// session and the real deployed session.

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const config = require("./config");
const { loadCommands } = require("./lib/loadCommands");

const commands = loadCommands();

/**
 * Starts (or restarts) a bot instance bound to the given session directory.
 * @param {string} sessionDir - folder containing creds.json etc.
 * @param {object} [hooks] - optional callbacks: onOpen(sock), onClose(reason)
 */
async function startBot(sessionDir, hooks = {}) {
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

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[${sessionDir}] connection closed. code=${statusCode} reconnect=${shouldReconnect}`);
      hooks.onClose?.(statusCode);
      if (shouldReconnect) startBot(sessionDir, hooks);
    } else if (connection === "open") {
      console.log(`✅ ${config.BOT_NAME} online — session: ${sessionDir}`);
      hooks.onOpen?.(sock);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const body =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      "";

    if (!body.startsWith(config.PREFIX)) return;

    const args = body.slice(config.PREFIX.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    const cmd = commands.get(commandName);
    if (!cmd) return;

    const participant = msg.key.participant || msg.key.remoteJid;
    const senderNumber = participant.split("@")[0];
    const isOwner = senderNumber === config.OWNER_NUMBER;

    if (cmd.ownerOnly && !isOwner) {
      await sock.sendMessage(sender, { text: "⛔ This command is restricted to the bot owner." }, { quoted: msg });
      return;
    }

    try {
      await cmd.execute({ sock, msg, sender, args, isOwner, commands, config });
    } catch (err) {
      console.error(`Error running command "${commandName}":`, err);
      await sock.sendMessage(sender, { text: "⚠️ An error occurred while running that command." }, { quoted: msg });
    }
  });

  return sock;
}

module.exports = { startBot };
