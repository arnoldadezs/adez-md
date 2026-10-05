const { createClient } = require("@supabase/supabase-js");

// Node 20 has no built-in WebSocket; Supabase's realtime module needs one.
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = require("ws");
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn(
    "⚠️  SUPABASE_URL or SUPABASE_KEY not set. Storage features will not work."
  );
}

// If env vars are present, create a normal client. Otherwise provide a safe no-op
// client that preserves the supabase.from(...).select(...).eq(...).maybeSingle() chaining
// pattern used throughout the codebase but does not throw at startup.
let supabase;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
} else {
  const noopChain = () => {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      neq() { return chain; },
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: async () => ({ data: null, error: null }),
      insert: async () => ({ data: null, error: null }),
      delete: async () => ({ data: null, error: null }),
    };
    return chain;
  };
  supabase = { from: () => noopChain() };
}

// Records/updates the user, and logs the message.
async function logMessage({ jid, sender, body, command, botPhone }) {
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
    console.error("Supabase logging error:", err?.message || err);
  }
}

// --- Session bookkeeping (multi-user pairing) ---
async function upsertSession(phone, status) {
  try {
    await supabase.from("sessions").upsert({
      phone,
      status,
      last_update: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Supabase session upsert error:", err?.message || err);
  }
}

async function getResumableSessions() {
  try {
    const { data, error } = await supabase
      .from("sessions")
      .select("phone")
      .neq("status", "logged_out");
    if (error) throw error;
    return (data || []).map((row) => row.phone);
  } catch (err) {
    console.error("Supabase session fetch error:", err?.message || err);
    return [];
  }
}

async function removeSession(phone) {
  try {
    await supabase.from("sessions").delete().eq("phone", phone);
  } catch (err) {
    console.error("Supabase session delete error:", err?.message || err);
  }
}

module.exports = {
  supabase,
  logMessage,
  upsertSession,
  getResumableSessions,
  removeSession,
};
