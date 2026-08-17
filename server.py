#!/usr/bin/env python3
"""
Probable — Polymarket contract lookup, backend

A dependency-free (stdlib only) web server that:
  1. Serves the static frontend in ./public
  2. Proxies a few read-only Polymarket public API endpoints under /api/*
     (the browser can't call gamma-api.polymarket.com / clob.polymarket.com
     directly because those hosts don't send CORS headers, so this server
     fetches on the frontend's behalf).
  3. Provides username/password accounts + a "recents" query history,
     backed by a Supabase (Postgres) project via its REST API (PostgREST) —
     called over plain HTTPS with urllib, so still no extra pip packages.
  4. Serves a password-gated /admin.html page + /api/admin/* stats API.

No API key / wallet needed for the Polymarket data itself. Accounts require
a Supabase project — see README.md for setup. Without SUPABASE_URL /
SUPABASE_SERVICE_KEY set, the site still works fully for anonymous market
lookups; only auth/recents/admin endpoints are disabled (501).

Run:
    python3 server.py [port]        # default port 8000
"""

import hashlib
import hmac
import http.cookies
import json
import os
import secrets
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

GAMMA_BASE = "https://gamma-api.polymarket.com"
CLOB_BASE = "https://clob.polymarket.com"
PUBLIC_DIR = Path(__file__).parent / "public"
DEFAULT_PORT = 8000
USER_AGENT = "Mozilla/5.0 (compatible; PolymarketLookup/1.0)"

def _normalize_supabase_url(raw: str) -> str:
    """Accept the base project URL even if someone pastes it with a path
    already attached (e.g. from a "Connect" dialog showing .../rest/v1) —
    we always append /rest/v1/{table} ourselves, so strip common suffixes."""
    url = (raw or "").strip().rstrip("/")
    for suffix in ("/rest/v1", "/rest", "/auth/v1", "/storage/v1"):
        if url.lower().endswith(suffix):
            url = url[: -len(suffix)]
            break
    return url


SUPABASE_URL = _normalize_supabase_url(os.environ.get("SUPABASE_URL"))
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or ""
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or ""

SESSION_TTL_DAYS = 30
ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60
PBKDF2_ITERATIONS = 200_000

# ---------------------------------------------------------------------------
# generic helpers
# ---------------------------------------------------------------------------


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


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def iso_days_ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def iso_today_start() -> str:
    n = datetime.now(timezone.utc)
    return n.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


# ---------------------------------------------------------------------------
# Polymarket (Gamma / CLOB) proxy logic
# ---------------------------------------------------------------------------


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
    try:
        data = http_get_json(f"{GAMMA_BASE}/markets/{urllib.parse.quote(market_id)}")
        if isinstance(data, list):
            data = data[0] if data else None
    except urllib.error.HTTPError:
        data = None

    if not data:
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


def do_price_history(token_id: str, interval: str = "max", fidelity: int = 180):
    url = f"{CLOB_BASE}/prices-history?" + urllib.parse.urlencode({
        "market": token_id, "interval": interval, "fidelity": fidelity,
    })
    try:
        data = http_get_json(url)
    except urllib.error.HTTPError as e:
        return {"error": f"no price history ({e.code})", "points": []}
    points = [{"t": p.get("t"), "p": p.get("p")} for p in data.get("history", [])]
    return {"points": points}


# ---------------------------------------------------------------------------
# curated market browser — free, keyword-bucketed off the public Gamma API
# ---------------------------------------------------------------------------

BROWSE_CATEGORIES = [
    ("politics", "Politics & Elections", [
        "election", "president", "senate", "governor", "prime minister", "parliament",
        "congress", "poll", "impeach", "cabinet", "vote", "primary", "referendum",
    ]),
    ("economy", "Fed & Economy", [
        "fed ", "federal reserve", "interest rate", "inflation", "cpi", "gdp",
        "recession", "rate decision", "rate cut", "rate hike", "treasury", "jobs report",
        "unemployment", "powell",
    ]),
    ("tech", "Tech, AI & Crypto", [
        "bitcoin", "ethereum", "crypto", " ai ", "openai", "chatgpt", "anthropic",
        "apple", "tesla", "spacex", "nvidia", "google", "meta ", "elon musk",
        "artificial intelligence", "grok", "gemini",
    ]),
    ("sports", "Sports", [
        "nba", "nfl", "mlb", "nhl", "soccer", "football", "tennis", "ufc", "boxing",
        "olympics", "world cup", "premier league", "super bowl", "champions league",
        "f1", "formula 1", "golf",
    ]),
]


def do_browse(per_category: int = 6) -> list:
    url = f"{GAMMA_BASE}/markets?" + urllib.parse.urlencode({
        "active": "true", "closed": "false", "order": "volume24hr",
        "ascending": "false", "limit": 200,
    })
    raw_markets = http_get_json(url)

    buckets = {key: [] for key, _, _ in BROWSE_CATEGORIES}
    seen_event_ids = {key: set() for key in buckets}

    for market in raw_markets:
        events = market.get("events") or []
        event = events[0] if events else {}
        haystack = f" {market.get('question', '')} {event.get('title', '')} ".lower()
        for key, _, keywords in BROWSE_CATEGORIES:
            if len(buckets[key]) >= per_category:
                continue
            if any(kw in haystack for kw in keywords):
                # avoid piling up many sub-markets from the same event (e.g. every
                # esports game in a series) — one entry per event per category
                eid = event.get("id") or market.get("id")
                if eid in seen_event_ids[key]:
                    continue
                seen_event_ids[key].add(eid)
                buckets[key].append(simplify_market(market, event))

    return [
        {"key": key, "label": label, "markets": buckets[key]}
        for key, label, _ in BROWSE_CATEGORIES
        if buckets[key]
    ]


# ---------------------------------------------------------------------------
# Supabase (Postgres via PostgREST) client — plain HTTPS, no driver needed
# ---------------------------------------------------------------------------


def supabase_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)


def _require_supabase():
    if not supabase_configured():
        raise ApiError(501, "accounts are not configured on this server (missing SUPABASE_URL / SUPABASE_SERVICE_KEY)")


def sb_request(method: str, table: str, params: dict = None, body=None, extra_headers: dict = None, timeout=10.0):
    _require_supabase()
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            parsed = json.loads(raw) if raw else None
            return parsed, resp.headers
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", "replace")
        raise ApiError(502, f"database error ({e.code}): {err_body[:300]}") from e
    except urllib.error.URLError as e:
        raise ApiError(502, f"database unreachable: {e.reason}") from e


def sb_select(table: str, select: str = "*", limit: int = None, order: str = None, **filters):
    params = dict(filters)
    params["select"] = select
    if limit is not None:
        params["limit"] = str(limit)
    if order:
        params["order"] = order
    rows, _ = sb_request("GET", table, params=params)
    return rows or []


def sb_insert(table: str, row: dict):
    rows, _ = sb_request("POST", table, body=row, extra_headers={"Prefer": "return=representation"})
    return rows[0] if rows else None


def sb_update(table: str, filters: dict, patch: dict):
    rows, _ = sb_request("PATCH", table, params=filters, body=patch, extra_headers={"Prefer": "return=representation"})
    return rows


def sb_delete(table: str, filters: dict):
    rows, _ = sb_request("DELETE", table, params=filters, extra_headers={"Prefer": "return=representation"})
    return rows


def sb_count(table: str, **filters) -> int:
    params = dict(filters)
    params["select"] = "id"
    _, headers = sb_request(
        "GET", table, params=params,
        extra_headers={"Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"},
    )
    content_range = headers.get("Content-Range", "*/0")
    total = content_range.split("/")[-1]
    return int(total) if total.isdigit() else 0


# ---------------------------------------------------------------------------
# passwords + sessions
# ---------------------------------------------------------------------------


def hash_password(password: str, salt: bytes = None):
    if salt is None:
        salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return salt.hex(), dk.hex()


def verify_password(password: str, salt_hex: str, hash_hex: str) -> bool:
    try:
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    _, dk_hex = hash_password(password, salt)
    return hmac.compare_digest(dk_hex, hash_hex)


USERNAME_RE_ALLOWED = "abcdefghijklmnopqrstuvwxyz0123456789_"


def validate_username(username: str) -> str:
    u = (username or "").strip().lower()
    if not (3 <= len(u) <= 24):
        raise ApiError(400, "username must be 3-24 characters")
    if any(c not in USERNAME_RE_ALLOWED for c in u):
        raise ApiError(400, "username may only contain lowercase letters, numbers, and underscores")
    return u


def validate_password(password: str) -> str:
    if not password or len(password) < 8:
        raise ApiError(400, "password must be at least 8 characters")
    if len(password) > 200:
        raise ApiError(400, "password too long")
    return password


def create_session(user_id) -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)).isoformat()
    sb_insert("sessions", {"token": token, "user_id": user_id, "expires_at": expires})
    return token


def get_user_by_session(token: str):
    if not token:
        return None
    rows = sb_select("sessions", token=f"eq.{token}", limit=1)
    if not rows:
        return None
    session = rows[0]
    if session["expires_at"] <= now_iso():
        return None
    users = sb_select("users", id=f"eq.{session['user_id']}", limit=1)
    return users[0] if users else None


# stateless admin sessions (HMAC-signed cookie, no DB row needed)


def make_admin_cookie_value() -> str:
    expires = int(time.time()) + ADMIN_SESSION_TTL_SECONDS
    sig = hmac.new(ADMIN_PASSWORD.encode("utf-8"), str(expires).encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{expires}.{sig}"


def verify_admin_cookie(value: str) -> bool:
    if not value or not ADMIN_PASSWORD:
        return False
    try:
        expires_str, sig = value.split(".", 1)
    except ValueError:
        return False
    expected = hmac.new(ADMIN_PASSWORD.encode("utf-8"), expires_str.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return False
    try:
        return int(expires_str) > time.time()
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    server_version = "PolymarketLookup/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ---- low-level send helpers ----

    def _send_json(self, obj, status=200, cookies=None):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for c in (cookies or []):
            self.send_header("Set-Cookie", c)
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status, message):
        self._send_json({"error": message}, status=status)

    def _is_https(self) -> bool:
        return self.headers.get("X-Forwarded-Proto", "") == "https"

    def _cookie_str(self, name, value, max_age=None) -> str:
        parts = [f"{name}={value}", "Path=/", "HttpOnly", "SameSite=Lax"]
        if max_age is not None:
            parts.append(f"Max-Age={max_age}")
        if self._is_https():
            parts.append("Secure")
        return "; ".join(parts)

    def _get_cookie(self, name):
        header = self.headers.get("Cookie")
        if not header:
            return None
        jar = http.cookies.SimpleCookie()
        try:
            jar.load(header)
        except Exception:
            return None
        return jar[name].value if name in jar else None

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > 1_000_000:
            raise ApiError(413, "request body too large")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            raise ApiError(400, "invalid JSON body")

    def _current_user(self):
        token = self._get_cookie("session")
        return get_user_by_session(token)

    def _require_user(self):
        user = self._current_user()
        if not user:
            raise ApiError(401, "not signed in")
        return user

    def _require_admin(self):
        cookie = self._get_cookie("admin_session")
        if not verify_admin_cookie(cookie):
            raise ApiError(401, "admin auth required")

    # ---- static files ----

    def _serve_static(self, path: str):
        if path == "/" or path == "/index.html":
            path = "/index.html"
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

    # ---- route tables ----

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
                self._send_json({"results": do_search(query, limit)})
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

            if parsed.path == "/api/price-history":
                token_id = (qs.get("token_id") or [""])[0].strip()
                interval = (qs.get("interval") or ["max"])[0].strip()
                if not token_id:
                    self._send_error_json(400, "missing token_id")
                    return
                self._send_json(do_price_history(token_id, interval=interval))
                return

            if parsed.path == "/api/browse":
                self._send_json({"categories": do_browse()})
                return

            if parsed.path == "/api/auth/me":
                user = self._current_user()
                self._send_json({"user": {"username": user["username"]} if user else None})
                return

            if parsed.path == "/api/queries":
                user = self._require_user()
                rows = sb_select("queries", user_id=f"eq.{user['id']}", order="updated_at.desc", limit=30)
                self._send_json({"queries": rows})
                return

            if parsed.path == "/api/admin/stats":
                self._require_admin()
                self._send_json(compute_admin_stats())
                return

            if parsed.path.startswith("/api/"):
                self._send_error_json(404, "unknown endpoint")
                return

            self._serve_static(parsed.path)

        except ApiError as e:
            self._send_error_json(e.status, e.message)
        except urllib.error.HTTPError as e:
            self._send_error_json(e.code, f"upstream error: {e.reason}")
        except urllib.error.URLError as e:
            self._send_error_json(502, f"upstream unreachable: {e.reason}")
        except Exception as e:  # noqa: BLE001
            self._send_error_json(500, f"server error: {e}")

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)

        try:
            if parsed.path == "/api/auth/signup":
                body = self._read_json_body()
                username = validate_username(body.get("username", ""))
                password = validate_password(body.get("password", ""))
                if sb_select("users", username=f"eq.{username}", limit=1):
                    raise ApiError(409, "that username is taken")
                salt_hex, hash_hex = hash_password(password)
                user = sb_insert("users", {
                    "username": username,
                    "password_hash": hash_hex,
                    "password_salt": salt_hex,
                })
                token = create_session(user["id"])
                cookie = self._cookie_str("session", token, max_age=SESSION_TTL_DAYS * 86400)
                self._send_json({"user": {"username": username}}, cookies=[cookie])
                return

            if parsed.path == "/api/auth/login":
                body = self._read_json_body()
                username = (body.get("username") or "").strip().lower()
                password = body.get("password") or ""
                rows = sb_select("users", username=f"eq.{username}", limit=1)
                if not rows or not verify_password(password, rows[0]["password_salt"], rows[0]["password_hash"]):
                    raise ApiError(401, "wrong username or password")
                user = rows[0]
                token = create_session(user["id"])
                cookie = self._cookie_str("session", token, max_age=SESSION_TTL_DAYS * 86400)
                self._send_json({"user": {"username": user["username"]}}, cookies=[cookie])
                return

            if parsed.path == "/api/auth/logout":
                token = self._get_cookie("session")
                if token and supabase_configured():
                    try:
                        sb_delete("sessions", {"token": f"eq.{token}"})
                    except ApiError:
                        pass
                cookie = self._cookie_str("session", "", max_age=0)
                self._send_json({"ok": True}, cookies=[cookie])
                return

            if parsed.path == "/api/queries":
                user = self._require_user()
                body = self._read_json_body()
                kind = body.get("kind")
                query_text = (body.get("query_text") or "").strip()
                market_id = body.get("market_id")
                market_question = body.get("market_question")
                if kind not in ("search", "market") or not query_text:
                    raise ApiError(400, "kind must be 'search' or 'market', query_text required")

                recent = sb_select("queries", user_id=f"eq.{user['id']}", order="updated_at.desc", limit=1)
                if (
                    recent
                    and recent[0]["kind"] == kind
                    and recent[0]["query_text"] == query_text
                    and recent[0].get("market_id") == market_id
                ):
                    updated = sb_update("queries", {"id": f"eq.{recent[0]['id']}"}, {"updated_at": now_iso()})
                    self._send_json({"query": updated[0] if updated else recent[0]})
                    return

                row = sb_insert("queries", {
                    "user_id": user["id"],
                    "kind": kind,
                    "query_text": query_text,
                    "market_id": market_id,
                    "market_question": market_question,
                    "updated_at": now_iso(),
                })
                self._send_json({"query": row})
                return

            if parsed.path == "/api/admin/login":
                if not ADMIN_PASSWORD:
                    raise ApiError(501, "admin panel not configured (missing ADMIN_PASSWORD)")
                body = self._read_json_body()
                if not hmac.compare_digest(body.get("password") or "", ADMIN_PASSWORD):
                    raise ApiError(401, "wrong password")
                cookie = self._cookie_str("admin_session", make_admin_cookie_value(), max_age=ADMIN_SESSION_TTL_SECONDS)
                self._send_json({"ok": True}, cookies=[cookie])
                return

            if parsed.path == "/api/admin/logout":
                cookie = self._cookie_str("admin_session", "", max_age=0)
                self._send_json({"ok": True}, cookies=[cookie])
                return

            self._send_error_json(404, "unknown endpoint")

        except ApiError as e:
            self._send_error_json(e.status, e.message)
        except Exception as e:  # noqa: BLE001
            self._send_error_json(500, f"server error: {e}")

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        try:
            if parsed.path == "/api/queries":
                user = self._require_user()
                query_id = (qs.get("id") or [""])[0].strip()
                if not query_id:
                    raise ApiError(400, "missing id")
                sb_delete("queries", {"id": f"eq.{query_id}", "user_id": f"eq.{user['id']}"})
                self._send_json({"ok": True})
                return

            self._send_error_json(404, "unknown endpoint")

        except ApiError as e:
            self._send_error_json(e.status, e.message)
        except Exception as e:  # noqa: BLE001
            self._send_error_json(500, f"server error: {e}")


def compute_admin_stats() -> dict:
    total_users = sb_count("users")
    total_queries = sb_count("queries")
    today_start = iso_today_start()
    signups_today = sb_count("users", created_at=f"gte.{today_start}")
    queries_today = sb_count("queries", created_at=f"gte.{today_start}")

    seven_days_ago = iso_days_ago(6)  # today + 6 previous days = 7 buckets
    recent_users = sb_select("users", select="created_at", created_at=f"gte.{seven_days_ago}")
    recent_queries = sb_select("queries", select="created_at", created_at=f"gte.{seven_days_ago}")

    def bucket_by_day(rows):
        counts = {}
        for r in rows:
            day = (r.get("created_at") or "")[:10]
            if day:
                counts[day] = counts.get(day, 0) + 1
        return counts

    signup_counts = bucket_by_day(recent_users)
    query_counts = bucket_by_day(recent_queries)

    days = []
    for i in range(6, -1, -1):
        d = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
        days.append({"date": d, "signups": signup_counts.get(d, 0), "queries": query_counts.get(d, 0)})

    recent_signups = sb_select("users", select="username,created_at", order="created_at.desc", limit=10)

    return {
        "total_users": total_users,
        "total_queries": total_queries,
        "signups_today": signups_today,
        "queries_today": queries_today,
        "last_7_days": days,
        "recent_signups": recent_signups,
    }


def main():
    # Render (and most PaaS hosts) inject the port to bind via $PORT.
    # Fall back to a CLI arg for local runs, then a default.
    port = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PORT))
    host = os.environ.get("HOST", "0.0.0.0")
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Probable — Polymarket contract lookup running on {host}:{port}")
    print(f"Accounts (Supabase): {'configured' if supabase_configured() else 'NOT configured — auth endpoints disabled'}")
    print(f"Admin panel: {'configured' if ADMIN_PASSWORD else 'NOT configured — set ADMIN_PASSWORD to enable /admin.html'}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
