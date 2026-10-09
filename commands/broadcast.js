// commands/broadcast.js — owner-only command example
module.exports = {
  name: "broadcast",
  aliases: ["bc"],
  description: "(Owner only) Send a message to all groups the bot is in",
  ownerOnly: true,
  async execute({ sock, msg, sender, args }) {
    const text = args.join(" ");
    if (!text) {
      return sock.sendMessage(sender, { text: "⚠️ Usage: .broadcast <message>" }, { quoted: msg });
    }

    const groups = await sock.groupFetchAllParticipating();
    const ids = Object.keys(groups);

    for (const id of ids) {
      await sock.sendMessage(id, { text: `📢 *Broadcast*\n\n${text}` }).catch(() => {});
    }

    await sock.sendMessage(sender, { text: `✅ Broadcast sent to ${ids.length} group(s).` }, { quoted: msg });
  },
};
