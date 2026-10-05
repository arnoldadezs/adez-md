-- Run this in Supabase: Dashboard → SQL Editor → New Query → paste → Run
-- (This is the full schema for a brand-new setup. If you already ran the old
-- version of this file, use supabase_migration.sql instead — don't re-run this one.)

create table if not exists users (
  jid text,
  bot_phone text,
  name text,
  first_seen timestamptz default now(),
  last_seen timestamptz default now(),
  message_count integer default 0,
  primary key (jid, bot_phone)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  jid text not null,
  bot_phone text,
  sender text,
  body text,
  command text,
  created_at timestamptz default now()
);

create table if not exists settings (
  key text primary key,
  value text
);

-- Stores the WhatsApp login session (Baileys auth state), so it survives redeploys.
-- Keys are namespaced per phone number, e.g. "254111783552:creds".
create table if not exists auth_state (
  key text primary key,
  value text
);

-- Tracks every phone number that has ever linked its own bot, and its current status
create table if not exists sessions (
  phone text primary key,
  status text,
  last_update timestamptz default now()
);
