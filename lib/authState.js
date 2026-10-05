const { createClient } = require("@supabase/supabase-js");
const { initAuthCreds } = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");

// Node 20 has no built-in WebSocket; Supabase's realtime module needs one.
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = require("ws");
}

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn(
    "⚠️ SUPABASE_URL or SUPABASE_KEY not set. Storage features will not work."
  );
}

const supabase =
  SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

function getCredentialsPath(phoneNumber) {
  const safePhone =
    String(phoneNumber || "unknown").replace(/[^0-9]/g, "") || "unknown";
  return path.join(__dirname, `../auth_info_${safePhone}.json`);
}

function readAuthFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw || !raw.trim()) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`Failed to read auth file ${filePath}:`, err.message);
    return {};
  }
}

function writeAuthFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error(`Failed to write auth file ${filePath}:`, err.message);
    return false;
  }
}

function normalizeCreds(creds) {
  if (!creds || typeof creds !== "object") {
    return initAuthCreds();
  }

  const fresh = initAuthCreds();

  return {
    ...fresh,
    ...creds,
    noiseKey: creds.noiseKey || fresh.noiseKey,
    signedIdentityKey: creds.signedIdentityKey || fresh.signedIdentityKey,
    pairingEphemeralKeyPair:
      creds.pairingEphemeralKeyPair || fresh.pairingEphemeralKeyPair,
    advSecretKey: creds.advSecretKey || fresh.advSecretKey,
  };
}

// Auth state management for Baileys
async function useSupabaseAuthState(phoneNumber) {
  const credentialsFile = getCredentialsPath(phoneNumber);

  // Load existing credentials or create new ones.
  let creds = normalizeCreds(readAuthFile(credentialsFile));

  const saveCreds = () => {
    writeAuthFile(credentialsFile, creds);
  };

  const clearSession = () => {
    try {
      if (fs.existsSync(credentialsFile)) {
        fs.unlinkSync(credentialsFile);
      }
      creds = {};
    } catch (err) {
      console.error("Failed to clear credentials:", err.message);
    }
  };

  const state = {
    creds,
    keys: {
      get: (type, ids) => {
        const out = {};
        const data = creds[type] || {};

        for (const id of ids || []) {
          out[id] = data[id] || null;
        }

        return out;
      },
      set: (data) => {
        if (!data || typeof data !== "object") return;

        Object.keys(data).forEach((category) => {
          creds[category] = creds[category] || {};
          Object.assign(creds[category], data[category] || {});
        });

        saveCreds();
      },
    },
  };

  return { state, saveCreds, clearSession };
}

// Records/updates the user, and logs the message.
async function logMessage({ jid, sender, body, command, botPhone }) {
  if (!supabase) return;

  try {
    const { data: existing } = await supabase
      .from("users")
      .select("message_count")
      .eq("jid", jid)
      .eq("bot_phone", botPhone)
      .maybeSingle();

    await supabase.from("users").upsert({
      jid,
      bot_phone: botPhone,
      last_seen: new Date().toISOString(),
      message_count: (existing?.message_count || 0) + 1,
    });

    await supabase.from("messages").insert({
      jid,
      sender,
      body,
      command,
      bot_phone: botPhone,
    });
  } catch (err) {
    console.error("Supabase logging error:", err.message);
  }
}

// Creates or updates a session's status row
async function upsertSession(phone, status) {
  if (!supabase) return;

  try {
    await supabase.from("sessions").upsert({
      phone,
      status,
      last_update: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Supabase session upsert error:", err.message);
  }
}

// Returns every phone number that should be reconnected on boot
async function getResumableSessions() {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from("sessions")
      .select("phone")
      .neq("status", "logged_out");
    if (error) throw error;
    return (data || []).map((row) => row.phone);
  } catch (err) {
    console.error("Supabase session fetch error:", err.message);
    return [];
  }
}

async function removeSession(phone) {
  if (!supabase) return;

  try {
    await supabase.from("sessions").delete().eq("phone", phone);
  } catch (err) {
    console.error("Supabase session delete error:", err.message);
  }
}

module.exports = {
  supabase,
  useSupabaseAuthState,
  logMessage,
  upsertSession,
  getResumableSessions,
  removeSession,
};
