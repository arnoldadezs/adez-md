const fs = require('fs-extra');
const path = require('path');

if (fs.existsSync('set.env')) {
  require('dotenv').config({ path: path.join(__dirname, 'set.env') });
}

const session = process.env.SESSION || '';
const dev = process.env.OWNER_NUMBER || '254748387615';
const waUsername = process.env.WHATSAPP_USERNAME || 'arnoldadez';
const devUsernames = (process.env.DEV_USERNAMES
  ? process.env.DEV_USERNAMES.split(',').map(u => u.trim().replace(/^@/, '').toLowerCase())
  : ['arnoldadez', 'adeztech', 'arnoldadezs']
);

const botPrefix = process.env.PREFIX || '.';
const botAuthor = process.env.OWNER_NAME || 'Arnold Adez';
const botUrl = process.env.BOT_PIC || 'https://raw.githubusercontent.com/adeztech2/adez-md/main/public/bot-pic.svg';
const botGurl = process.env.BOT_GURL || 'https://github.com/arnoldadezs/adez-md';
const botTimezone = process.env.BOT_TIMEZONE || 'Africa/Nairobi';
const botBotname = process.env.BOTNAME || 'ADEZ MD';
const botPackname = process.env.BOT_PACKNAME || 'ADEZ MD';
const botMode = process.env.BOT_MODE || 'public';
const botSessionName = process.env.BOT_SESSION_NAME || 'adez-md';
const autosocialdownload = process.env.AUTO_SOCIAL_DOWNLOAD || 'false';

module.exports = {
  dev,
  session,
  waUsername,
  devUsernames,
  botPrefix,
  botAuthor,
  autosocialdownload,
  botUrl,
  botGurl,
  botTimezone,
  botBotname,
  botPackname,
  botMode,
  botSessionName,
};
