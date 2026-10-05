const { createClient } = require("@supabase/supabase-js");
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

const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Auth state management for Baileys
async function useSupabaseAuthState(phoneNumber) {
  const credentialsFile = path.join(__dirname, `../auth_info_${phoneNumber}.json`);

  // Load existing credentials or create new ones
  let creds = {};
  if (fs.existsSync(credentialsFile)) {
    try {
      creds = JSON.parse(fs.readFileSync(credentialsFile, "utf-8"));
    } catch (err) {
      console.warn("Failed to load credentials file, starting fresh:", err.message);
    }
  }

  // Save credentials whenever they're updated
  const saveCreds = () => {
    try {
      fs.writeFileSync(credentialsFile, JSON.stringify(creds, null, 2));
    } catch (err) {
      console.error("Failed to save credentials:", err.message);
    }
  };

  // Clear session (logout)
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

  // Return state object for Baileys
  const state = {
    creds,
    keys: {
      get: (type, jids) => {
        const data = {};
        jids.forEach((jid) => {
          let value = creds[type];
          if (type === "sessions" && value) {
            value = value[jid];
          } else if (value) {
            value = value[jid];
          }
          data[jid] = value;
        });
        return data;
      },
      set: (data) => {
        Object.keys(data).forEach((category) => {
          creds[category] = creds[category] || {};
          Object.assign(creds[category], data[category]);
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
