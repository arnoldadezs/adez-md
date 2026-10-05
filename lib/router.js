const { logMessage, supabase } = require("./supabase");
const yts = require("yt-search");
const sharp = require("sharp");
const { evaluate } = require("mathjs");
const crypto = require("crypto");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OWNER_NAME = "Arnold Adez";
const POWERED_BY = "ADEZ TECH";

// AI Chat history storage (in-memory)
const chatHistory = {};

// Extracts plain text from any type of WhatsApp message
function getMessageText(msg) {
  const m = msg.message;
  return (
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption ||
    m?.videoMessage?.caption ||
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
  return jid.endsWith("@g.us");
}

function numberToJid(number) {
  return number.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
}

const lastRiddle = {};
const RIDDLES = [
  { q: "The more you take, the more you leave behind. What am I?", a: "Footsteps" },
  { q: "I speak without a mouth and hear without ears. What am I?", a: "An echo" },
  { q: "What has keys but no locks, space but no room?", a: "A keyboard" },
  { q: "What gets wetter as it dries?", a: "A towel" },
];

const TRUTHS = [
  "What's the most embarrassing thing you've ever done?",
  "What's a secret you've never told anyone in this chat?",
  "What's your biggest fear?",
  "Who was your first crush?",
];

const DARES = [
  "Send a voice note singing your favorite song.",
  "Text your crush right now and tell them 'hi'.",
  "Change your profile picture to something silly for an hour.",
  "Reply to this using only emojis for the next 3 messages.",
];

const WYR = [
  "Would you rather be able to fly or be invisible?",
  "Would you rather always be 10 minutes late or 20 minutes early?",
  "Would you rather lose your phone or your wallet?",
  "Would you rather never use social media again or never watch TV again?",
];

const EIGHT_BALL = [
  "Yes, definitely.",
  "No way.",
  "Ask again later.",
  "It is certain.",
  "Very doubtful.",
  "Signs point to yes.",
  "Cannot predict now.",
];

const REACTIONS = [
  "hug", "pat", "cuddle", "slap", "kiss", "poke", "wink", "wave",
  "dance", "highfive", "cry", "smile", "bonk", "yeet", "handhold",
  "nom", "bite", "blush", "glomp", "smug",
];

async function fetchReactionGif(type) {
  const res = await fetch(`https://api.waifu.pics/sfw/${type}`);
  const data = await res.json();
  return data.url;
}

async function handleMessage(sock, msg, { PREFIX, OWNER_NUMBER, BOT_NAME, botPhone }) {
  const from = msg.key.remoteJid;
  const text = getMessageText(msg).trim();

  console.log(`[MSG TEXT] "${text}" from=${from}`);

  if (!text.startsWith(PREFIX)) return;

  const args = text.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();
  const argText = args.join(" ").trim();

  if (!command) return;

  const sender = msg.key.participant || msg.key.remoteJid || "";
  const isOwner = sender.includes(OWNER_NUMBER);

  console.log(`[CMD RECEIVED] command=".${command}" sender=${sender} chat=${from}`);

  if (supabase) {
    logMessage({ jid: from, sender, body: text, command, botPhone });
  }

  const reply = async (content) => {
    try {
      const result = await sock.sendMessage(from, { text: content }, { quoted: msg });
      console.log(`[REPLY SENT OK] to ${from}`);
      return result;
    } catch (err) {
      console.error(`[REPLY FAILED] to ${from}:`, err);
      throw err;
    }
  };

  if (REACTIONS.includes(command)) {
    try {
      const url = await fetchReactionGif(command);
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      const targetTag = mentioned?.[0] ? `@${mentioned[0].split("@")[0]}` : "";
      await sock.sendMessage(
        from,
        {
          video: { url },
          gifPlayback: true,
          caption: targetTag ? `${command} ${targetTag}` : `${command}!`,
          mentions: mentioned || [],
        },
        { quoted: msg }
      );
    } catch (err) {
      await reply("Couldn't fetch that reaction right now.");
    }
    return;
  }

  switch (command) {
    // ---- GENERAL ----
    case "ping": {
      const start = Date.now();
      await reply("Pinging...");
      const latency = Date.now() - start;
      await reply(`Pong! 🏓 ${latency}ms`);
      break;
    }

    case "menu":
    case "help": {
      const seconds = Math.floor(process.uptime());
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);

      const box = (emoji, title, desc, items) => {
        const lines = items.map((i) => `│ ${i}`).join("\n");
        return (
          `╭──── ${emoji} ${title} ────╮\n` +
          `│ 📝 ${desc}\n` +
          `│ ──────────────────\n` +
          `${lines}\n` +
          `╰─────────────────────╯\n\n`
        );
      };

      let menuText =
        `╭──── 🤖 *${BOT_NAME}* ────╮\n` +
        `│ Owner  : ${OWNER_NAME}\n` +
        `│ Prefix : ${PREFIX}\n` +
        `│ Uptime : ${h}h ${m}m\n` +
        `╰─────────────────────╯\n\n`;

      menuText += box("🔧", "GENERAL", "General commands", [
        `${PREFIX}menu`, `${PREFIX}ping`, `${PREFIX}alive`, `${PREFIX}repo`,
        `${PREFIX}owner`, `${PREFIX}jid`, `${PREFIX}readmore`, `${PREFIX}vcard`
      ]);

      menuText += box("🔍", "SEARCH", "Search commands", [
        `${PREFIX}google <query>`, `${PREFIX}image <query>`, `${PREFIX}weather <city>`,
        `${PREFIX}lyrics <song>`, `${PREFIX}yts <query>`
      ]);

      menuText += box("📥", "DOWNLOADER", "Download commands", [
        `${PREFIX}play <song>`, `${PREFIX}instagram <url>`, `${PREFIX}tiktok <url>`,
        `${PREFIX}facebook <url>`, `${PREFIX}twitter <url>`, `${PREFIX}spotify <url>`,
        `${PREFIX}soundcloud <url>`, `${PREFIX}pinterest <url>`
      ]);

      menuText += box("🔄", "CONVERTER", "Converter commands", [
        `${PREFIX}toimg`, `${PREFIX}toaudio`, `${PREFIX}tomp3`, `${PREFIX}togif`,
        `${PREFIX}toviewonce`, `${PREFIX}toptt`
      ]);

      menuText += box("🎮", "FUN", "Entertainment", [
        `${PREFIX}joke`, `${PREFIX}fact`, `${PREFIX}quote`, `${PREFIX}dice`,
        `${PREFIX}coinflip`, `${PREFIX}8ball`, `${PREFIX}truth`, `${PREFIX}dare`, `${PREFIX}wyr`
      ]);

      menuText += box("🤖", "GPT", "AI Commands", [
        `${PREFIX}gpt <query>`, `${PREFIX}clearai`, `${PREFIX}lastchat`, `${PREFIX}gpthistory`
      ]);

      menuText += box("👥", "GROUP", "Group management", [
        `${PREFIX}grouplink`, `${PREFIX}tagall`, `${PREFIX}kick`, `${PREFIX}promote`,
        `${PREFIX}demote`, `${PREFIX}add`, `${PREFIX}groupinfo`, `${PREFIX}poll`
      ]);

      menuText += box("🔒", "PRIVACY", "Privacy settings", [
        `${PREFIX}privacy`, `${PREFIX}lastseen`, `${PREFIX}readreceipts`, `${PREFIX}disappearing`
      ]);

      menuText += box("🛠️", "TOOLS", "Utility tools", [
        `${PREFIX}translate <text>`, `${PREFIX}tts <text>`, `${PREFIX}qr <text>`,
        `${PREFIX}ip`, `${PREFIX}inspect`, `${PREFIX}scan`, `${PREFIX}pdf`
      ]);

      menuText += box("⚙️", "SETTINGS", "Bot settings", [
        `${PREFIX}prefix`, `${PREFIX}botname`, `${PREFIX}mode`, `${PREFIX}timezone`
      ]);

      menuText += box("👑", "OWNER", "Owner only", [
        `${PREFIX}eval`, `${PREFIX}shell`, `${PREFIX}logout`, `${PREFIX}update`,
        `${PREFIX}pp`, `${PREFIX}warn`, `${PREFIX}setsudo`
      ]);

      menuText += `> Powered by ${POWERED_BY} 🖤`;

      try {
        await sock.sendMessage(
          from,
          { image: { url: "https://github.com/adeztech2.png" }, caption: menuText },
          { quoted: msg }
        );
      } catch (err) {
        await reply(menuText);
      }
      break;
    }

    case "alive": {
      await reply(`${BOT_NAME} is alive and running ✅\nPowered by ${POWERED_BY}\nPrefix: ${PREFIX}`);
      break;
    }

    case "runtime":
    case "uptime": {
      const seconds = Math.floor(process.uptime());
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      await reply(`Uptime: ${h}h ${m}m ${s}s`);
      break;
    }

    case "jid": {
      await reply(`This chat's JID:\n${from}`);
      break;
    }

    case "repo":
    case "source": {
      await reply(`${BOT_NAME} source code:\nhttps://github.com/adeztech2/adez-md`);
      break;
    }

    case "readmore": {
      await reply("━━━━━━━━━━━━━━━━━━\n*${BOT_NAME}*\n━━━━━━━━━━━━━━━━━━\n\nA powerful WhatsApp bot with multiple features.");
      break;
    }

    case "vcard": {
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${BOT_NAME}\nTEL:${OWNER_NUMBER}\nEND:VCARD`;
      await sock.sendMessage(from, { contacts: { displayName: BOT_NAME, contacts: [{ vcard }] } }, { quoted: msg });
      break;
    }

    // ---- SEARCH ----

    case "google": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}google <query>`);
        return;
      }
      try {
        await fetch(`https://www.google.com/search?q=${encodeURIComponent(argText)}`);
        await reply(`🔍 Google Search Results for "${argText}":\n\nVisit: https://www.google.com/search?q=${encodeURIComponent(argText)}`);
      } catch (err) {
        await reply("Google search failed.");
      }
      break;
    }

    case "image": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}image <query>`);
        return;
      }
      try {
        await reply(`🖼️ Image search for "${argText}":\n\nhttps://www.google.com/search?tbm=isch&q=${encodeURIComponent(argText)}`);
      } catch (err) {
        await reply("Image search failed.");
      }
      break;
    }

    case "weather": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}weather <city>`);
        return;
      }
      try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(argText)}?format=j1`);
        const data = await res.json();
        const current = data?.current_condition?.[0];
        if (!current) {
          await reply("Weather data not found.");
          return;
        }
        const weather = `🌍 Weather in ${argText}\n\nTemp: ${current.temp_C}°C\nCondition: ${current.weatherDesc?.[0]?.value || "N/A"}\nHumidity: ${current.humidity}%\nWind: ${current.windspeedKmph} km/h`;
        await reply(weather);
      } catch (err) {
        await reply("Weather lookup failed.");
      }
      break;
    }

    case "lyrics": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}lyrics <song>`);
        return;
      }
      try {
        await reply(`🎵 Lyrics for "${argText}":\n\nSearch on: https://www.genius.com/search?q=${encodeURIComponent(argText)}`);
      } catch (err) {
        await reply("Lyrics search failed.");
      }
      break;
    }

    case "yts": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}yts <query>`);
        return;
      }
      try {
        const { videos } = await yts(argText);
        if (!videos || videos.length === 0) {
          await reply("No results found.");
          return;
        }
        let result = `🎥 YouTube Search Results:\n\n`;
        videos.slice(0, 5).forEach((v, i) => {
          result += `${i + 1}. ${v.title}\nChannel: ${v.author.name}\nViews: ${v.views}\n${v.url}\n\n`;
        });
        await reply(result);
      } catch (err) {
        await reply("YouTube search failed.");
      }
      break;
    }

    // ---- DOWNLOADER ----

    case "play":
    case "yt": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}play <song or video name>`);
        return;
      }
      await reply(`🎵 Searching for "${argText}"...`);
      try {
        const { videos } = await yts(argText);
        if (!videos || videos.length === 0) {
          await reply("No results found.");
          return;
        }
        const top = videos[0];
        const caption = `*${top.title}*\n\nChannel: ${top.author.name}\nDuration: ${top.timestamp}\nViews: ${top.views.toLocaleString()}\n\n${top.url}`;
        await sock.sendMessage(from, { image: { url: top.thumbnail }, caption }, { quoted: msg });
      } catch (err) {
        await reply("YouTube search failed.");
      }
      break;
    }

    case "instagram": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}instagram <URL>`);
        return;
      }
      await reply("Instagram downloader is not configured yet. Coming soon!");
      break;
    }

    case "tiktok": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}tiktok <URL>`);
        return;
      }
      await reply("TikTok downloader is not configured yet. Coming soon!");
      break;
    }

    case "facebook": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}facebook <URL>`);
        return;
      }
      await reply("Facebook downloader is not configured yet. Coming soon!");
      break;
    }

    case "twitter": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}twitter <URL>`);
        return;
      }
      await reply("Twitter downloader is not configured yet. Coming soon!");
      break;
    }

    case "spotify": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}spotify <URL or query>`);
        return;
      }
      await reply("Spotify downloader is not configured yet. Coming soon!");
      break;
    }

    case "soundcloud": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}soundcloud <URL>`);
        return;
      }
      await reply("SoundCloud downloader is not configured yet. Coming soon!");
      break;
    }

    case "pinterest": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}pinterest <URL>`);
        return;
      }
      await reply("Pinterest downloader is not configured yet. Coming soon!");
      break;
    }

    // ---- CONVERTER ----

    case "sticker":
    case "s": {
      const quoted = getQuoted(msg);
      const target = quoted || msg;
      if (!target.message?.imageMessage) {
        await reply(`Reply to an image with ${PREFIX}sticker`);
        return;
      }
      try {
        const buffer = await downloadMediaMessage(target, "buffer", {});
        const webp = await sharp(buffer).resize(512, 512, { fit: "cover" }).webp().toBuffer();
        await sock.sendMessage(from, { sticker: webp }, { quoted: msg });
      } catch (err) {
        await reply("Couldn't create sticker.");
      }
      break;
    }

    case "toimg": {
      const quoted = getQuoted(msg);
      const target = quoted || msg;
      if (!target.message?.stickerMessage) {
        await reply(`Reply to a sticker with ${PREFIX}toimg`);
        return;
      }
      try {
        const buffer = await downloadMediaMessage(target, "buffer", {});
        const png = await sharp(buffer).png().toBuffer();
        await sock.sendMessage(from, { image: png }, { quoted: msg });
      } catch (err) {
        await reply("Couldn't convert sticker to image.");
      }
      break;
    }

    case "toaudio": {
      await reply("Audio conversion not configured yet. Coming soon!");
      break;
    }

    case "tomp3": {
      await reply("MP3 conversion not configured yet. Coming soon!");
      break;
    }

    case "togif": {
      await reply("GIF conversion not configured yet. Coming soon!");
      break;
    }

    case "toviewonce": {
      await reply("View once conversion not configured yet. Coming soon!");
      break;
    }

    case "toptt": {
      await reply("PTT conversion not configured yet. Coming soon!");
      break;
    }

    // ---- GPT ----

    case "gpt":
    case "ai": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}gpt <your question>`);
        return;
      }
      if (!ANTHROPIC_API_KEY) {
        await reply("AI isn't configured yet. Add ANTHROPIC_API_KEY in environment variables.");
        return;
      }
      try {
        if (!chatHistory[from]) chatHistory[from] = [];
        chatHistory[from].push({ role: "user", content: argText });

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 500,
            messages: chatHistory[from],
          }),
        });
        const data = await res.json();
        if (data.error) {
          await reply(`AI Error: ${data.error.message}`);
          return;
        }
        const response = data?.content?.[0]?.text || "No response from AI.";
        chatHistory[from].push({ role: "assistant", content: response });
        await reply(response);
      } catch (err) {
        console.error("AI request error:", err);
        await reply("AI request failed. Try again.");
      }
      break;
    }

    case "clearai": {
      if (chatHistory[from]) {
        chatHistory[from] = [];
        await reply("✅ Chat history cleared!");
      } else {
        await reply("No chat history to clear.");
      }
      break;
    }

    case "lastchat": {
      if (!chatHistory[from] || chatHistory[from].length === 0) {
        await reply("No chat history found.");
        return;
      }
      const last = chatHistory[from][chatHistory[from].length - 1];
      await reply(`Last message:\n\n${last.content}`);
      break;
    }

    case "gpthistory": {
      if (!chatHistory[from] || chatHistory[from].length === 0) {
        await reply("No chat history found.");
        return;
      }
      let history = `📜 Chat History (Last 10):\n\n`;
      chatHistory[from].slice(-10).forEach((msg, i) => {
        history += `${i + 1}. ${msg.role.toUpperCase()}: ${msg.content.substring(0, 50)}...\n`;
      });
      await reply(history);
      break;
    }

    // ---- GROUP ----

    case "grouplink": {
      if (!isGroup(from)) {
        await reply("This command only works in groups.");
        return;
      }
      try {
        const code = await sock.groupInviteCode(from);
        await reply(`🔗 Group Link:\nhttps://chat.whatsapp.com/${code}`);
      } catch (err) {
        await reply("Couldn't get invite link. Make sure the bot is an admin.");
      }
      break;
    }

    case "tagall": {
      if (!isGroup(from)) {
        await reply("This command only works in groups.");
        return;
      }
      try {
        const meta = await sock.groupMetadata(from);
        const mentions = meta.participants.map((p) => p.id);
        const textOut = mentions.map((jid) => `@${jid.split("@")[0]}`).join(" ");
        await sock.sendMessage(from, { text: textOut, mentions }, { quoted: msg });
      } catch (err) {
        await reply("Couldn't tag everyone.");
      }
      break;
    }

    case "kick": {
      if (!isGroup(from)) {
        await reply("This command only works in groups.");
        return;
      }
      if (!isOwner) {
        await reply("This command is for the bot owner only.");
        return;
      }
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      const targetJid = mentioned?.[0];
      if (!targetJid) {
        await reply(`Usage: ${PREFIX}kick (reply/mention a member)`);
        return;
      }
      try {
        await sock.groupParticipantsUpdate(from, [targetJid], "remove");
        await reply("✅ Member kicked.");
      } catch (err) {
        await reply("Couldn't kick member.");
      }
      break;
    }

    case "promote": {
      if (!isGroup(from)) {
        await reply("This command only works in groups.");
        return;
      }
      if (!isOwner) {
        await reply("This command is for the bot owne
