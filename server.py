#!/usr/bin/env python3
"""
Polymarket Contract Lookup — backend

A tiny, dependency-free (stdlib only) web server that:
  1. Serves the static frontend in ./public
  2. Proxies a few read-only Polymarket public API endpoints under /api/*
     (the browser can't call gamma-api.polymarket.com / clob.polymarket.com
     directly because those hosts don't send CORS headers, so this server
     fetches on the frontend's behalf).

No API key / wallet needed — everything used here is Polymarket's public,
unauthenticated market-data API.

Run:
    python3 server.py [port]        # default port 8000
"""

import json
import os
import sys
import urllib.request
import urllib.parse
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

GAMMA_BASE = "https://gamma-api.polymarket.com"
CLOB_BASE = "https://clob.polymarket.com"
PUBLIC_DIR = Path(__file__).parent / "public"
DEFAULT_PORT = 8000
USER_AGENT = "Mozilla/5.0 (compatible; PolymarketLookup/1.0)"


def http_get_json(url: str, timeout: float = 10.0):
    """GET a URL and parse the response body as JSON. Raises on failure."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return json.loads(raw)


def safe_json_loads(value, default):
    """Gamma API embeds JSON as strings inside JSON (e.g. outcomes, outcomePrices)."""
    if value is None:
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def simplify_market(market: dict, event: dict) -> dict:
    """Flatten a gamma-api market (nested inside an event) into the shape the frontend wants."""
    outcomes = safe_json_loads(market.get("outcomes"), [])
    prices = safe_json_loads(market.get("outcomePrices"), [])
    outcomes_with_prices = []
    for i, name in enumerate(outcomes):
        price = None
        if i < len(prices):
            try:
                price = float(prices[i])
            except (TypeError, ValueError):
                price = None
        outcomes_with_prices.append({"name": name, "price": price})

    def num(key, src=None):
        src = src if src is not None else market
        v = src.get(key)
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    return {
        "id": market.get("id"),
        "question": market.get("question"),
        "slug": market.get("slug"),
        "description": market.get("description"),
        "image": market.get("image") or event.get("image"),
        "active": market.get("active"),
        "closed": market.get("closed"),
        "restricted": market.get("restricted"),
        "endDate": market.get("endDate") or market.get("endDateIso"),
        "startDate": market.get("startDate") or market.get("startDateIso"),
        "outcomes": outcomes_with_prices,
        "volume": num("volumeNum") if market.get("volumeNum") is not None else num("volume"),
        "volume24hr": num("volume24hr"),
        "volume1wk": num("volume1wk"),
        "volume1mo": num("volume1mo"),
        "liquidity": num("liquidityNum") if market.get("liquidityNum") is not None else num("liquidity"),
        "bestBid": num("bestBid"),
        "bestAsk": num("bestAsk"),
        "lastTradePrice": num("lastTradePrice"),
        "spread": num("spread"),
        "oneDayPriceChange": num("oneDayPriceChange"),
        "oneHourPriceChange": num("oneHourPriceChange"),
        "clobTokenIds": safe_json_loads(market.get("clobTokenIds"), []),
        "eventTitle": event.get("title"),
        "eventSlug": event.get("slug"),
        "eventId": event.get("id"),
        "groupItemTitle": market.get("groupItemTitle"),
        "url": (
            f"https://polymarket.com/event/{event.get('slug')}"
            if event.get("slug") else
            f"https://polymarket.com/market/{market.get('slug')}"
        ),
    }


def do_search(query: str, limit: int) -> list:
    url = (
        f"{GAMMA_BASE}/public-search?"
        + urllib.parse.urlencode({"q": query, "limit_per_type": limit, "events_status": "active"})
    )
    data = http_get_json(url)
    results = []
    for event in data.get("events", []):
        for market in event.get("markets", []):
            results.append(simplify_market(market, event))
    return results


def do_market_lookup(market_id: str) -> dict:
    # id lookup
    try:
        data = http_get_json(f"{GAMMA_BASE}/markets/{urllib.parse.quote(market_id)}")
        if isinstance(data, list):
            data = data[0] if data else None
    except urllib.error.HTTPError:
        data = None

    if not data:
        # fall back to slug lookup
        url = f"{GAMMA_BASE}/markets?" + urllib.parse.urlencode({"slug": market_id})
        arr = http_get_json(url)
        data = arr[0] if arr else None

    if not data:
        return None

    events = data.get("events") or []
    event = events[0] if events else {}
    return simplify_market(data, event)


def do_orderbook(token_id: str):
    url = f"{CLOB_BASE}/book?" + urllib.parse.urlencode({"token_id": token_id})
    try:
        return http_get_json(url)
    except urllib.error.HTTPError as e:
        return {"error": f"no orderbook ({e.code})"}


class Handler(BaseHTTPRequestHandler):
    server_version = "PolymarketLookup/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status, message):
        self._send_json({"error": message}, status=status)

    def _serve_static(self, path: str):
        if path == "/":
            path = "/index.html"
        # prevent path traversal
        rel = path.lstrip("/")
        file_path = (PUBLIC_DIR / rel).resolve()
        if PUBLIC_DIR.resolve() not in file_path.parents and file_path != PUBLIC_DIR.resolve():
            self._send_error_json(403, "forbidden")
            return
        if not file_path.exists() or not file_path.is_file():
            self._send_error_json(404, "not found")
            return

        content_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
        }
        ctype = content_types.get(file_path.suffix, "application/octet-stream")
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        try:
            if parsed.path == "/api/search":
                query = (qs.get("q") or [""])[0].strip()
                limit = int((qs.get("limit") or ["10"])[0])
                if not query:
                    self._send_json({"results": []})
                    return
                results = do_search(query, limit)
                self._send_json({"results": results})
                return

            if parsed.path == "/api/market":
                market_id = (qs.get("id") or [""])[0].strip()
                if not market_id:
                    self._send_error_json(400, "missing id")
                    return
                market = do_market_lookup(market_id)
                if market is None:
                    self._send_error_json(404, "market not found")
                    return
                self._send_json({"market": market})
                return

            if parsed.path == "/api/orderbook":
                token_id = (qs.get("token_id") or [""])[0].strip()
                if not token_id:
                    self._send_error_json(400, "missing token_id")
                    return
                self._send_json(do_orderbook(token_id))
                return

            if parsed.path.startswith("/api/"):
                self._send_error_json(404, "unknown endpoint")
                return

            self._serve_static(parsed.path)

        except urllib.error.HTTPError as e:
            self._send_error_json(e.code, f"upstream error: {e.reason}")
        except urllib.error.URLError as e:
            self._send_error_json(502, f"upstream unreachable: {e.reason}")
        except Exception as e:  # noqa: BLE001
            self._send_error_json(500, f"server error: {e}")


def main():
    # Render (and most PaaS hosts) inject the port to bind via $PORT.
    # Fall back to a CLI arg for local runs, then a default.
    port = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PORT))
    host = os.environ.get("HOST", "0.0.0.0")
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Polymarket Contract Lookup running on {host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
