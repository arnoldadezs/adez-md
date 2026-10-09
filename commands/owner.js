// commands/owner.js
const config = require("../config");

module.exports = {
  name: "owner",
  aliases: ["creator"],
  description: "Get the bot owner's contact",
  ownerOnly: false,
  async execute({ sock, msg, sender }) {
    await sock.sendMessage(
      sender,
      {
        contacts: {
          displayName: config.OWNER_NAME,
          contacts: [
            {
              vcard:
                `BEGIN:VCARD\nVERSION:3.0\n` +
                `FN:${config.OWNER_NAME}\n` +
                `TEL;type=CELL;type=VOICE;waid=${config.OWNER_NUMBER}:+${config.OWNER_NUMBER}\n` +
                `END:VCARD`,
            },
          ],
        },
      },
      { quoted: msg }
    );
  },
};
