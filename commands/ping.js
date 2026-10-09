// commands/ping.js
module.exports = {
  name: "ping",
  aliases: ["speed"],
  description: "Check if the bot is alive and its response speed",
  ownerOnly: false,
  async execute({ sock, msg, sender }) {
    const start = Date.now();
    const sent = await sock.sendMessage(sender, { text: "🏓 Pinging..." }, { quoted: msg });
    const latency = Date.now() - start;
    await sock.sendMessage(
      sender,
      { text: `🏓 Pong!\n⚡ Speed: ${latency}ms`, edit: sent.key }
    ).catch(async () => {
      // Fallback if edit isn't supported by the connected client
      await sock.sendMessage(sender, { text: `🏓 Pong!\n⚡ Speed: ${latency}ms` });
    });
  },
};
