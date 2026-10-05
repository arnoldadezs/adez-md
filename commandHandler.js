const fs = require('fs-extra');
const path = require('path');
const settings = require('./settings');

const commandsDir = path.join(__dirname, 'commands');
const commands = new Map(); // commandName -> commandModule
const aliases = new Map(); // alias -> commandName
const cooldowns = new Map(); // `${userId}:${commandName}` -> expiresAt (ms)

/**
 * Try to extract a text body from a WhatsApp message object.
 * Works with common Baileys message shapes: conversation, extendedTextMessage, image/video captions, buttons, list.
 */
function extractBody(message) {
  if (!message) return '';
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage && message.extendedTextMessage.text) return message.extendedTextMessage.text;
  if (message.imageMessage && message.imageMessage.caption) return message.imageMessage.caption;
  if (message.videoMessage && message.videoMessage.caption) return message.videoMessage.caption;
  if (message.audioMessage && message.audioMessage.caption) return message.audioMessage.caption;
  if (message.buttonsResponseMessage && message.buttonsResponseMessage.selectedButtonId) return message.buttonsResponseMessage.selectedButtonId;
  if (message.listResponseMessage && message.listResponseMessage.singleSelectReply && message.listResponseMessage.singleSelectReply.selectedRowId) return message.listResponseMessage.singleSelectReply.selectedRowId;
  return '';
}

function isOwner(sender) {
  if (!sender) return false;
  // sender typically looks like "2547...@s.whatsapp.net"
  const id = sender.split('@')[0];
  if (settings.dev && id === settings.dev.replace(/[^0-9]/g, '')) return true; // numeric compare if env contains raw number
  if (settings.dev && sender === settings.dev) return true;
  // check devUsernames - best-effort: compare against part before @ and also against lowercase pushName if caller provides
  const username = id.toLowerCase();
  return settings.devUsernames && settings.devUsernames.includes(username);
}

async function loadCommands(dir = commandsDir) {
  commands.clear();
  aliases.clear();

  if (!await fs.pathExists(dir)) return;

  const files = await fs.readdir(dir);
  for (const file of files) {
    const full = path.join(dir, file);
    const stat = await fs.stat(full);
    if (stat.isDirectory()) {
      // recursively load subcommands (optional)
      await loadCommands(full);
      continue;
    }
    if (!file.endsWith('.js')) continue;
    try {
      delete require.cache[require.resolve(full)];
      const mod = require(full);
      if (!mod || !mod.name) {
        console.warn(`Skipping command file without a name: ${full}`);
        continue;
      }
      const name = mod.name.toLowerCase();
      commands.set(name, Object.assign({ file: full }, mod));
      if (mod.aliases && Array.isArray(mod.aliases)) {
        for (const a of mod.aliases) aliases.set(a.toLowerCase(), name);
      }
    } catch (err) {
      console.error(`Failed loading command ${full}:`, err);
    }
  }
}

/**
 * Find a command by name or alias.
 */
function getCommand(name) {
  if (!name) return null;
  const key = name.toLowerCase();
  if (commands.has(key)) return commands.get(key);
  if (aliases.has(key)) {
    const primary = aliases.get(key);
    return commands.get(primary) || null;
  }
  return null;
}

/**
 * Simple reply helper that tries a few common methods on the conn object.
 */
async function reply(conn, msg, text) {
  try {
    // bailey-like: conn.sendMessage(jid, { text })
    if (conn && typeof conn.sendMessage === 'function') {
      const jid = msg.key && msg.key.remoteJid ? msg.key.remoteJid : (msg.from || msg.chat || null);
      if (!jid) return;
      await conn.sendMessage(jid, { text }, { quoted: msg });
      return;
    }
    // a fallback: msg.reply (some wrappers implement)
    if (typeof msg.reply === 'function') {
      await msg.reply(text);
      return;
    }
    console.log('Reply:', text);
  } catch (err) {
    console.error('Failed to send reply:', err);
  }
}

/**
 * Main handler entrypoint.
 * - conn: WhatsApp connection/client instance
 * - m: message object (the full message wrapper as received from Baileys)
 */
async function handle(conn, m) {
  try {
    if (!m || !m.message) return;
    const body = extractBody(m.message);
    if (!body) return;

    const prefix = settings.botPrefix || '.';
    if (!body.startsWith(prefix)) return;

    const withoutPrefix = body.slice(prefix.length).trim();
    if (!withoutPrefix) return;

    const parts = withoutPrefix.split(/\s+/);
    const cmdName = parts.shift().toLowerCase();
    const args = parts;

    await ensureCommandsLoaded();

    const cmd = getCommand(cmdName);
    if (!cmd) {
      // unknown command - optional: ignore or notify
      return;
    }

    // owner-only check
    if (cmd.ownerOnly && !isOwner(m.key && m.key.participant ? m.key.participant : (m.key && m.key.remoteJid ? m.key.remoteJid.split(':')[0] : undefined))) {
      await reply(conn, m, '❌ This command is restricted to the bot owner.');
      return;
    }

    // developer-only check (if command marks devOnly)
    if (cmd.devOnly && !isOwner(m.key && m.key.participant ? m.key.participant : (m.key && m.key.remoteJid ? m.key.remoteJid.split(':')[0] : undefined))) {
      await reply(conn, m, '❌ This command is restricted to developers.');
      return;
    }

    // cooldowns (per user per command)
    const userId = (m.key && (m.key.participant || m.key.remoteJid)) ? (m.key.participant || m.key.remoteJid) : 'unknown';
    const cooldownKey = `${userId}:${cmd.name}`;
    const now = Date.now();
    if (cooldowns.has(cooldownKey)) {
      const expires = cooldowns.get(cooldownKey);
      if (now < expires) {
        const secs = Math.ceil((expires - now) / 1000);
        await reply(conn, m, `⏳ Please wait ${secs}s before using \`${cmd.name}\` again.`);
        return;
      }
    }

    // set cooldown if defined on command (in seconds)
    if (cmd.cooldown && Number(cmd.cooldown) > 0) {
      cooldowns.set(cooldownKey, now + Number(cmd.cooldown) * 1000);
      // schedule deletion to avoid unbounded growth
      setTimeout(() => cooldowns.delete(cooldownKey), Number(cmd.cooldown) * 1000 + 1000);
    }

    // run the command
    try {
      // commands may be functions or modules with run(conn, m, args, context)
      if (typeof cmd === 'function') {
        await cmd(conn, m, args, { settings });
      } else if (cmd.run && typeof cmd.run === 'function') {
        await cmd.run(conn, m, args, { settings });
      } else {
        await reply(conn, m, '❌ Invalid command module (no runnable function).');
      }
    } catch (err) {
      console.error(`Error executing command ${cmd.name}:`, err);
      await reply(conn, m, '❌ An error occurred while executing the command.');
    }
  } catch (err) {
    console.error('commandHandler.handle error:', err);
  }
}

let _loaded = false;
async function ensureCommandsLoaded() {
  if (_loaded) return;
  await loadCommands();
  _loaded = true;
}

/**
 * Reload a single command file by name (useful for hot-reload).
 * Returns true if reloaded, false otherwise.
 */
async function reloadCommand(name) {
  await ensureCommandsLoaded();
  const cmd = getCommand(name);
  if (!cmd) return false;
  try {
    const full = cmd.file;
    delete require.cache[require.resolve(full)];
    const mod = require(full);
    commands.set(mod.name.toLowerCase(), Object.assign({ file: full }, mod));
    // refresh aliases mapping
    // rebuild aliases map conservatively
    aliases.clear();
    for (const [n, c] of commands.entries()) {
      if (c.aliases && Array.isArray(c.aliases)) for (const a of c.aliases) aliases.set(a.toLowerCase(), n);
    }
    return true;
  } catch (err) {
    console.error('Failed to reload command:', err);
    return false;
  }
}

/**
 * Convenience: list loaded commands
 */
function listCommands() {
  return Array.from(commands.keys());
}

module.exports = {
  handle,
  loadCommands,
  reloadCommand,
  listCommands,
  // exported for tests or external use:
  _internal: {
    commands,
    aliases,
    cooldowns,
  },
};
