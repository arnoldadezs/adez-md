// config.js — ADEZ MD configuration

module.exports = {
  BOT_NAME: "ADEZ MD",
  BOT_NUMBER: "254111783552",        // without + and without @s.whatsapp.net
  OWNER_NAME: "ARNOLD ADEZ",
  OWNER_NUMBER: "254111783552",      // used for owner-only commands
  PREFIX: ".",
  // Public-facing footer used in the menu / replies
  FOOTER: "ADEZ MD | Owner: ARNOLD ADEZ",

  // Single port for the combined web server (Render/Railway/Heroku set process.env.PORT themselves)
  PORT: process.env.PORT || 3000,
};
