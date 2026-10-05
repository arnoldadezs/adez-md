const { logMessage, supabase } = require("./supabase");
const yts = require("yt-search");
const sharp = require("sharp");
const { evaluate } = require("mathjs");
const crypto = require("crypto");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OWNER_NAME = "Arnold Adez";
const POWERED_BY = "ADEZ TECH";

const chatHistory = {};

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

function numberToJid(number) {
  return String(number || "").replace(/[^0-9]/g, "") + "@s.whatsapp.net";
}

const lastRiddle = {};
const RIDDLES = [
  { q: "The more you take, the more you leave behind. What am I?", a: "Footsteps" },
  { q: "I speak without a mouth and hear without ears. What am I?", a: "An echo" },
  { q: "What has keys but no locks, space but no room?", a: "A keyboard" },
  { q: "What gets wetter as it dries?", a: "A towel" },
  { q: "What can travel around the world while staying in one corner?", a: "A stamp" },
];

const TRUTHS = [
  "What's the most embarrassing thing you've ever done?",
  "What's a secret you've never told anyone in this chat?",
  "What's your biggest fear?",
  "Who was your first crush?",
  "What's something you lied about recently?",
];

const DARES = [
  "Send a voice note singing your favorite song.",
  "Text your crush right now and tell them 'hi'.",
  "Change your profile picture to something silly for an hour.",
  "Reply to this using only emojis for the next 3 messages.",
  "Tell the group your most awkward childhood memory.",
];

const WYR = [
  "Would you rather be able to fly or be invisible?",
  "Would you rather always be 10 minutes late or 20 minutes early?",
  "Would you rather lose your phone or your wallet?",
  "Would you rather never use social media again or never watch TV again?",
  "Would you rather have unlimited money or unlimited time?",
];

const EIGHT_BALL = [
  "Yes, definitely.",
  "No way.",
  "Ask again later.",
  "It is certain.",
  "Very doubtful.",
  "Signs point to yes.",
  "Cannot predict now.",
  "Outlook good.",
];

const REACTIONS = [
  "hug", "pat", "cuddle", "slap", "kiss", "poke", "wink", "wave",
  "dance", "highfive", "cry", "smile", "bonk", "yeet", "handhold",
  "nom", "bite", "blush", "glomp", "smug",
];

function pick(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "";
  return arr[Math.floor(Math.random() * arr.length)];
}

async function fetchReactionGif(type) {
  const res = await fetch(`https://api.waifu.pics/sfw/${type}`);
  const data = await res.json();
  return data.url;
}

async function handleMessage(sock, msg, { PREFIX = ".", OWNER_NUMBER = "", BOT_NAME = "ADEZ MD", botPhone = "" } = {}) {
  const from = msg?.key?.remoteJid;
  const text = String(getMessageText(msg) || "").trim();

  if (!from || !text.startsWith(PREFIX)) return;

  const args = text.slice(PREFIX.length).trim().split(/\s+/).filter(Boolean);
  const command = (args.shift() || "").toLowerCase();
  const argText = args.join(" ").trim();

  if (!command) return;

  const sender = msg.key.participant || msg.key.remoteJid || "";
  const isOwner = sender.includes(String(OWNER_NUMBER));

  if (supabase) {
    logMessage({ jid: from, sender, body: text, command, botPhone });
  }

  const reply = async (content) => {
    try {
      return await sock.sendMessage(from, { text: String(content) }, { quoted: msg });
    } catch (err) {
      console.error("[router] reply failed:", err?.message || err);
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
    case "ping": {
      const start = Date.now();
      await reply("Pinging...");
      await reply(`Pong! 🏓 ${(Date.now() - start)}ms`);
      break;
    }

    case "alive":
    case "status": {
      await reply(`${BOT_NAME} is alive ✅\nPrefix: ${PREFIX}\nPowered by ${POWERED_BY}`);
      break;
    }

    case "runtime":
    case "uptime": {
      const sec = Math.floor(process.uptime());
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
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

    case "owner": {
      await reply(`Owner: ${OWNER_NAME}\nWhatsApp: ${OWNER_NUMBER || "not configured"}`);
      break;
    }

    case "menu":
    case "help": {
      const menu = [
        `${PREFIX}ping`, `${PREFIX}alive`, `${PREFIX}help`, `${PREFIX}menu`, `${PREFIX}repo`, `${PREFIX}jid`, `${PREFIX}uptime`,
        `${PREFIX}play`, `${PREFIX}youtube`, `${PREFIX}google`, `${PREFIX}image`, `${PREFIX}weather`, `${PREFIX}lyrics`,
        `${PREFIX}sticker`, `${PREFIX}toimg`, `${PREFIX}gpt`, `${PREFIX}ai`, `${PREFIX}joke`, `${PREFIX}fact`, `${PREFIX}quote`,
        `${PREFIX}dice`, `${PREFIX}coinflip`, `${PREFIX}8ball`, `${PREFIX}truth`, `${PREFIX}dare`, `${PREFIX}wyr`, `${PREFIX}riddle`,
        `${PREFIX}grouplink`, `${PREFIX}tagall`, `${PREFIX}kick`, `${PREFIX}promote`, `${PREFIX}demote`, `${PREFIX}add`,
        `${PREFIX}tts`, `${PREFIX}translate`, `${PREFIX}qr`, `${PREFIX}math`, `${PREFIX}calc`
      ].join("\n");
      await reply(`ADEZ MD Commands:\n\n${menu}`);
      break;
    }

    case "sticker":
    case "s": {
      const quoted = getQuoted(msg);
      const target = quoted || msg;
      if (!target.message?.imageMessage) {
        await reply(`Reply to an image with ${PREFIX}sticker`);
        break;
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
        break;
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

    case "toaudio":
    case "tomp3": {
      await reply("Audio conversion is not configured yet. Coming soon!");
      break;
    }

    case "togif":
    case "toviewonce":
    case "toptt": {
      await reply("This conversion is not configured yet.");
      break;
    }

    case "google": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}google <query>`);
        break;
      }
      await reply(`🔎 Search: https://www.google.com/search?q=${encodeURIComponent(argText)}`);
      break;
    }

    case "image": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}image <query>`);
        break;
      }
      await reply(`🖼️ Images: https://www.google.com/search?tbm=isch&q=${encodeURIComponent(argText)}`);
      break;
    }

    case "weather": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}weather <city>`);
        break;
      }
      try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(argText)}?format=j1`);
        const data = await res.json();
        const current = data?.current_condition?.[0];
        if (!current) {
          await reply("Weather data not found.");
          break;
        }
        await reply(
          `🌍 Weather in ${argText}\nTemp: ${current.temp_C}°C\nCondition: ${current.weatherDesc?.[0]?.value || "N/A"}\nHumidity: ${current.humidity}%\nWind: ${current.windspeedKmph} km/h`
        );
      } catch (err) {
        await reply("Weather lookup failed.");
      }
      break;
    }

    case "lyrics": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}lyrics <song>`);
        break;
      }
      await reply(`🎵 Lyrics search: https://www.genius.com/search?q=${encodeURIComponent(argText)}`);
      break;
    }

    case "yt":
    case "youtube":
    case "play": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}play <song or video name>`);
        break;
      }
      try {
        const { videos } = await yts(argText);
        if (!videos || videos.length === 0) {
          await reply("No results found.");
          break;
        }
        const top = videos[0];
        const caption = `*${top.title}*\n\nChannel: ${top.author.name}\nDuration: ${top.timestamp}\nViews: ${top.views.toLocaleString()}\n\n${top.url}`;
        await sock.sendMessage(from, { image: { url: top.thumbnail }, caption }, { quoted: msg });
      } catch (err) {
        await reply("YouTube search failed.");
      }
      break;
    }

    case "instagram":
    case "tiktok":
    case "facebook":
    case "twitter":
    case "spotify":
    case "soundcloud":
    case "pinterest": {
      await reply(`${command.toUpperCase()} downloader is not configured yet. Coming soon!`);
      break;
    }

    case "joke": {
      const joke = pick([
        "Why did the scarecrow win an award? Because he was outstanding in his field!",
        "I told my computer I needed a break, and now it sends me to sleep mode.",
        "Why do programmers prefer dark mode? Because light attracts bugs.",
      ]);
      await reply(`😂 ${joke}`);
      break;
    }

    case "fact": {
      const fact = pick([
        "Octopuses have three hearts.",
        "Honey never spoils.",
        "Bananas are berries, but strawberries aren't.",
        "A day on Venus is longer than a year on Venus.",
      ]);
      await reply(`💡 ${fact}`);
      break;
    }

    case "quote": {
      const quote = pick([
        "Success is the sum of small efforts repeated day in and day out. ~ Robert Collier",
        "Do not wait to strike till the iron is hot; but make it hot by striking. ~ William Butler Yeats",
        "It always seems impossible until it's done. ~ Nelson Mandela",
      ]);
      await reply(`💬 ${quote}`);
      break;
    }

    case "dice": {
      await reply(`🎲 ${Math.floor(Math.random() * 6) + 1}`);
      break;
    }

    case "coinflip": {
      await reply(Math.random() < 0.5 ? "🪙 Heads" : "🪙 Tails");
      break;
    }

    case "8ball":
    case "eightball": {
      await reply(`🎱 ${pick(EIGHT_BALL)}`);
      break;
    }

    case "truth": {
      await reply(`🧠 ${pick(TRUTHS)}`);
      break;
    }

    case "dare": {
      await reply(`🔥 ${pick(DARES)}`);
      break;
    }

    case "wyr": {
      await reply(`🤔 ${pick(WYR)}`);
      break;
    }

    case "riddle": {
      const key = `${from}`;
      const used = lastRiddle[key] || 0;
      const chosen = RIDDLES[used % RIDDLES.length];
      lastRiddle[key] = (used + 1) % RIDDLES.length;
      await reply(`🧩 ${chosen.q}`);
      break;
    }

    case "answer": {
      const key = `${from}`;
      const used = lastRiddle[key] || 0;
      const chosen = RIDDLES[(used + RIDDLES.length - 1) % RIDDLES.length];
      const answer = chosen.a;
      await reply(`✅ ${answer}`);
      break;
    }

    case "gpt":
    case "ai": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}gpt <your question>`);
        break;
      }
      if (!ANTHROPIC_API_KEY) {
        await reply("AI isn't configured yet. Add ANTHROPIC_API_KEY in environment variables.");
        break;
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
          break;
        }
        const response = data?.content?.[0]?.text || "No response from AI.";
        chatHistory[from].push({ role: "assistant", content: response });
        await reply(response);
      } catch (err) {
        await reply("AI request failed. Try again.");
      }
      break;
    }

    case "clearai": {
      chatHistory[from] = [];
      await reply("✅ Chat history cleared!");
      break;
    }

    case "lastchat": {
      if (!chatHistory[from] || chatHistory[from].length === 0) {
        await reply("No chat history found.");
        break;
      }
      const last = chatHistory[from][chatHistory[from].length - 1];
      await reply(`Last message:\n\n${last.content}`);
      break;
    }

    case "gpthistory": {
      if (!chatHistory[from] || chatHistory[from].length === 0) {
        await reply("No chat history found.");
        break;
      }
      let history = "📜 Chat History:\n\n";
      chatHistory[from].slice(-10).forEach((entry, i) => {
        history += `${i + 1}. ${entry.role.toUpperCase()}: ${String(entry.content).slice(0, 50)}...\n`;
      });
      await reply(history);
      break;
    }

    case "math":
    case "calc": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}calc <expression>`);
        break;
      }
      try {
        const result = evaluate(argText);
        await reply(`🧮 ${result}`);
      } catch (err) {
        await reply("Invalid math expression.");
      }
      break;
    }

    case "qr": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}qr <text>`);
        break;
      }
      const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(argText)}&size=240`;
      await sock.sendMessage(from, { image: { url: qrUrl }, caption: `QR for: ${argText}` }, { quoted: msg });
      break;
    }

    case "tts": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}tts <text>`);
        break;
      }
      await reply(`🔊 TTS for "${argText}" is not enabled in this build yet.`);
      break;
    }

    case "translate": {
      if (!argText) {
        await reply(`Usage: ${PREFIX}translate <text>`);
        break;
      }
      await reply(`🌐 Translation support is not enabled yet for "${argText}".`);
      break;
    }

    case "grouplink": {
      if (!isGroup(from)) {
        await reply("This command only works in groups.");
        break;
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
        break;
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
        break;
      }
      if (!isOwner) {
        await reply("This command is for the bot owner only.");
        break;
      }
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      const targetJid = mentioned?.[0];
      if (!targetJid) {
        await reply(`Usage: ${PREFIX}kick (mention a member)`);
        break;
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
        break;
      }
      if (!isOwner) {
        await reply("This command is for the bot owner only.");
        break;
      }
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      const targetJid = mentioned?.[0];
      if (!targetJid) {
        await reply(`Usage: ${PREFIX}promote (mention a member)`);
        break;
      }
      try {
        await sock.groupParticipantsUpdate(from, [targetJid], "promote");
        await reply("✅ Member promoted.");
      } catch (err) {
        await reply("Couldn't promote member.");
      }
      break;
    }

    case "demote": {
      if (!isGroup(from)) {
        await reply("This command only works in groups.");
        break;
      }
      if (!isOwner) {
        await reply("This command is for the bot owner only.");
        break;
      }
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      const targetJid = mentioned?.[0];
      if (!targetJid) {
        await reply(`Usage: ${PREFIX}demote (mention a member)`);
        break;
      }
      try {
        await sock.groupParticipantsUpdate(from, [targetJid], "demote");
        await reply("✅ Member demoted.");
      } catch (err) {
        await reply("Couldn't demote member.");
      }
      break;
    }

    case "add": {
      if (!isGroup(from)) {
        await reply("This command only works in groups.");
        break;
      }
      if (!isOwner) {
        await reply("This command is for the bot owner only.");
        break;
      }
      if (!argText) {
        await reply(`Usage: ${PREFIX}add <number>`);
        break;
      }
      const target = numberToJid(argText);
      try {
        await sock.groupParticipantsUpdate(from, [target], "add");
        await reply(`✅ Added ${target}`);
      } catch (err) {
        await reply("Couldn't add member.");
      }
      break;
    }

    case "eval": {
      if (!isOwner) {
        await reply("Owner only.");
        break;
      }
      if (!argText) {
        await reply(`Usage: ${PREFIX}eval <code>`);
        break;
      }
      try {
        const result = await Function(`"use strict"; return (${argText})`)();
        await reply(String(result));
      } catch (err) {
        await reply(`Eval error: ${err.message}`);
      }
      break;
    }

    default: {
      await reply(`Unknown command: ${command}. Send ${PREFIX}help for a list.`);
    }
  }
}

module.exports = { handleMessage };
