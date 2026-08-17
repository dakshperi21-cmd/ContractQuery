# Probable — Polymarket Contract Lookup

A tiny website for looking up Polymarket trading contracts by search query and
seeing their live prices, volume, liquidity, and other stats — with optional
user accounts to save your query history ("recents"), and a password-gated
admin stats page.

## How it works

- **`server.py`** — a dependency-free Python 3 (stdlib only — no `pip install`
  needed) server that:
  - serves the static frontend in `public/`
  - proxies a few read-only endpoints from Polymarket's public Gamma API
    (`gamma-api.polymarket.com`) under `/api/*`, since that host doesn't send
    CORS headers so the browser can't call it directly.
    - `GET /api/search?q=...` → searches contracts by keyword
    - `GET /api/market?id=...` → full detail for one contract
    - `GET /api/orderbook?token_id=...` → live order book (CLOB API)
  - No API key or wallet needed for any of the above — all Polymarket
    endpoints used are public, unauthenticated market-data APIs.
  - handles accounts + saved query history, backed by a **Supabase**
    (hosted Postgres) project, talked to over plain HTTPS via its REST API
    (PostgREST) — so still zero extra Python packages.
    - `POST /api/auth/signup`, `/api/auth/login`, `/api/auth/logout`, `GET /api/auth/me`
    - `GET /api/queries`, `POST /api/queries`, `DELETE /api/queries?id=...`
  - serves a password-gated `/admin.html` + `/api/admin/*` stats API
    (total users, total queries, signups/queries today, a 7-day chart).
- **`public/`** — vanilla HTML/CSS/JS frontend, no build step, no framework.

Without Supabase configured, the site still works fully for anonymous market
lookups — only the login/signup/recents endpoints are disabled (they return
`501`). Without `ADMIN_PASSWORD` set, `/admin.html` just can't be unlocked.

## Run it locally

```bash
python3 server.py        # serves on http://127.0.0.1:8000
```

Then open http://127.0.0.1:8000 and search for a contract, e.g.
"Fed rate decision", "Bitcoin $150k", "Trump".

To use a different port: `python3 server.py 3000`.

## Setting up accounts (Supabase)

1. Go to [supabase.com](https://supabase.com) → sign up (free) → **New project**.
   Pick any name/region and set a database password (you won't need it again —
   the app talks to Supabase over its REST API with a different key).
2. Once the project is ready, open **SQL Editor** → **New query**, paste in
   the contents of [`supabase_schema.sql`](supabase_schema.sql) from this repo,
   and run it. This creates the `users`, `sessions`, and `queries` tables.
3. Open **Project Settings → API**. You need two values:
   - **Project URL** (e.g. `https://xxxxxxxx.supabase.co`) → `SUPABASE_URL`
   - **`service_role` secret key** (NOT the `anon`/`public` key — the secret
     one, under "Project API keys") → `SUPABASE_SERVICE_KEY`

   The `service_role` key has full access to your database, so treat it like
   a password: never commit it to git, never put it in frontend code. This
   app only ever uses it from `server.py`, server-side.
4. Set both as environment variables wherever you run the server:
   ```bash
   export SUPABASE_URL="https://xxxxxxxx.supabase.co"
   export SUPABASE_SERVICE_KEY="eyJ..."
   python3 server.py
   ```
5. On Render: **Dashboard → your service → Environment**, add
   `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` there (the `render.yaml` in this
   repo already declares both as required secrets, so Render will prompt for
   them on deploy).

### A note on persistence

Supabase's free tier is a real, persistent Postgres database — accounts and
saved queries won't disappear when your Render service sleeps or redeploys.
(Supabase free projects do pause after 7 days of *total inactivity*, including
no API calls at all — just visiting the site periodically keeps it awake, or
you can upgrade if you want a guarantee.)

## Setting up the admin stats page

Set one more environment variable:

```bash
export ADMIN_PASSWORD="pick-something-only-you-know"
```

Then visit `/admin.html` (e.g. http://127.0.0.1:8000/admin.html, or
`https://<your-render-url>/admin.html`) and enter that password. It shows
total users, total queries logged, signups/queries today, a 7-day activity
chart, and the most recent signups. The page isn't linked from anywhere in
the public site — it's only reachable if you know the URL and the password.

## Notes

- Not affiliated with Polymarket. Not financial advice.
- Search results and market IDs are the same ones Polymarket's own site uses
  (`public-search` on the Gamma API), so results should match what you'd find
  on polymarket.com.
- Passwords are hashed with PBKDF2-HMAC-SHA256 (200,000 iterations, random
  16-byte salt per user) — never stored or logged in plaintext.
