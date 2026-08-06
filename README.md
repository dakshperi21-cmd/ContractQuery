# Polymarket Contract Lookup

A tiny website for looking up Polymarket trading contracts by search query and
seeing their live prices, volume, liquidity, and other stats.

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
  - No API key or wallet needed — all endpoints used are Polymarket's public
    market-data API.
- **`public/`** — vanilla HTML/CSS/JS frontend, no build step, no framework.

## Run it

```bash
python3 server.py        # serves on http://127.0.0.1:8000
```

Then open http://127.0.0.1:8000 in a browser and search for a contract, e.g.
"Fed rate decision", "Bitcoin $150k", "Trump".

To use a different port: `python3 server.py 3000`.

## Notes

- Not affiliated with Polymarket. Not financial advice.
- Search results and market IDs are the same ones Polymarket's own site uses
  (`public-search` on the Gamma API), so results should match what you'd find
  on polymarket.com.
