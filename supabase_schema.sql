-- Polymarket Contract Lookup — Supabase schema
-- Run this once in your Supabase project's SQL Editor (Project → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS).

create table if not exists users (
  id bigint generated always as identity primary key,
  username text unique not null,
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists queries (
  id bigint generated always as identity primary key,
  -- Nullable on purpose: anonymous (not-logged-in) searches and contract
  -- views get logged here too, with user_id left null, so admin stats
  -- ("total queries") reflect all site usage, not just signed-in users.
  -- Only rows with a user_id ever show up in that user's Recents panel.
  user_id bigint references users(id) on delete cascade,
  kind text not null check (kind in ('search', 'market')),
  query_text text not null,
  market_id text,
  market_question text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_queries_user_updated on queries (user_id, updated_at desc);
create index if not exists idx_sessions_user on sessions (user_id);
create index if not exists idx_sessions_expires on sessions (expires_at);

-- Lock every table down at the row-security level. The app never uses the
-- public "anon" key — it always talks to Supabase with the secret
-- "service_role" key from the server, which bypasses RLS entirely. Enabling
-- RLS with zero policies means that even if the anon key ever leaked, it
-- could not read or write anything here.
alter table users enable row level security;
alter table sessions enable row level security;
alter table queries enable row level security;
