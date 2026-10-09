// commands/menu.js
const config = require("../config");

module.exports = {
  name: "menu",
  aliases: ["help", "list"],
  description: "Show all available commands",
  ownerOnly: false,
  async execute({ sock, msg, sender, commands }) {
    const seen = new Set();
    let list = "";

    for (const cmd of commands.values()) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);
      list += `\n▢ ${config.PREFIX}${cmd.name} — ${cmd.description || "no description"}`;
    }

    const text =
      `╭──「 *${config.BOT_NAME}* 」\n` +
      `│ Owner: ${config.OWNER_NAME}\n` +
      `│ Prefix: [ ${config.PREFIX} ]\n` +
      `╰────────────────\n` +
      `\n📜 *Commands:*${list}\n\n` +
      `_${config.FOOTER}_`;

    await sock.sendMessage(sender, { text }, { quoted: msg });
  },
};
