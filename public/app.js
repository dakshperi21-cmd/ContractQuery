(() => {
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");
  const statusEl = document.getElementById("search-status");
  const resultsEl = document.getElementById("results");
  const detailEl = document.getElementById("detail");

  let currentRequestId = 0;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch(input.value.trim());
  });

  async function runSearch(query) {
    hideDetail();
    if (!query) {
      resultsEl.innerHTML = "";
      statusEl.textContent = "";
      return;
    }

    const requestId = ++currentRequestId;
    statusEl.innerHTML = `<span class="spinner"></span>Searching…`;
    statusEl.classList.remove("error");
    resultsEl.innerHTML = "";

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=12`);
      const data = await res.json();
      if (requestId !== currentRequestId) return; // stale response

      if (!res.ok) throw new Error(data.error || "search failed");

      const results = data.results || [];
      if (results.length === 0) {
        statusEl.textContent = "";
        resultsEl.innerHTML = `<div class="empty">No contracts found for “${escapeHtml(query)}”. Try a different term.</div>`;
        return;
      }

      statusEl.textContent = `${results.length} contract${results.length === 1 ? "" : "s"} found`;
      renderResults(results);
    } catch (err) {
      if (requestId !== currentRequestId) return;
      statusEl.textContent = `Couldn't load results: ${err.message}`;
      statusEl.classList.add("error");
    }
  }

  function renderResults(results) {
    resultsEl.innerHTML = "";
    for (const market of results) {
      resultsEl.appendChild(buildCard(market));
    }
  }

  function buildCard(market) {
    const card = document.createElement("button");
    card.className = "card";
    card.type = "button";

    const img = document.createElement("img");
    img.className = "card-img";
    img.loading = "lazy";
    img.alt = "";
    img.src = market.image || "";
    img.onerror = () => { img.style.visibility = "hidden"; };

    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = market.question || market.eventTitle || "Untitled market";

    const sub = document.createElement("div");
    sub.className = "card-sub";
    sub.innerHTML = [
      market.eventTitle && market.eventTitle !== market.question ? escapeHtml(market.eventTitle) : null,
      `<span title="${formatMoneyExact(market.volume)}">Vol ${formatMoney(market.volume)}</span>`,
      market.liquidity != null ? `<span title="${formatMoneyExact(market.liquidity)}">Liq ${formatMoney(market.liquidity)}</span>` : null,
      market.endDate ? `Ends ${formatDate(market.endDate)}` : null,
    ].filter(Boolean).map(t => (t.startsWith("<span") ? t : `<span>${t}</span>`)).join("");

    body.appendChild(title);
    body.appendChild(sub);

    const badge = document.createElement("span");
    badge.className = "badge " + badgeClass(market);
    badge.textContent = badgeText(market);

    card.appendChild(img);
    card.appendChild(body);
    card.appendChild(badge);

    card.addEventListener("click", () => showDetail(market));
    return card;
  }

  function badgeClass(market) {
    if (market.closed) return "closed";
    const top = topOutcome(market);
    if (!top) return "closed";
    return top.name && top.name.toLowerCase() === "no" && top.price > 0.5 ? "no-lean" : "yes-lean";
  }

  function badgeText(market) {
    if (market.closed) return "Closed";
    const top = topOutcome(market);
    if (!top || top.price == null) return "—";
    return `${top.name} ${Math.round(top.price * 100)}%`;
  }

  function topOutcome(market) {
    const outcomes = (market.outcomes || []).filter(o => o.price != null);
    if (outcomes.length === 0) return null;
    return outcomes.reduce((a, b) => (b.price > a.price ? b : a));
  }

  async function showDetail(market) {
    resultsEl.classList.add("hidden");
    statusEl.textContent = "";
    detailEl.classList.remove("hidden");
    detailEl.innerHTML = `<button class="detail-back">&larr; Back to results</button><div class="empty"><span class="spinner"></span>Loading contract…</div>`;
    detailEl.querySelector(".detail-back").addEventListener("click", hideDetail);
    window.scrollTo({ top: 0, behavior: "smooth" });

    let full = market;
    try {
      const res = await fetch(`/api/market?id=${encodeURIComponent(market.id)}`);
      const data = await res.json();
      if (res.ok && data.market) full = data.market;
    } catch (_) {
      // fall back to the summary we already have
    }

    renderDetail(full);
  }

  function renderDetail(m) {
    const outcomes = [...(m.outcomes || [])].sort((a, b) => (b.price ?? 0) - (a.price ?? 0));

    const outcomeRows = outcomes.map(o => {
      const pct = o.price != null ? Math.round(o.price * 100) : null;
      return `
        <div class="outcome-row">
          <div class="outcome-name" title="${escapeHtml(o.name)}">${escapeHtml(o.name)}</div>
          <div class="outcome-bar-track"><div class="outcome-bar-fill" style="width:${pct ?? 0}%"></div></div>
          <div class="outcome-pct">${pct != null ? pct + "%" : "—"}</div>
        </div>`;
    }).join("");

    const stats = [
      ["Status", m.closed ? "Closed" : m.active ? "Active" : "Inactive", null],
      ["Total volume", formatMoney(m.volume), formatMoneyExact(m.volume)],
      ["24h volume", formatMoney(m.volume24hr), formatMoneyExact(m.volume24hr)],
      ["Liquidity", formatMoney(m.liquidity), formatMoneyExact(m.liquidity)],
      ["Best bid", formatCents(m.bestBid), null],
      ["Best ask", formatCents(m.bestAsk), null],
      ["Last trade", formatCents(m.lastTradePrice), null],
      ["Spread", formatCents(m.spread), null],
      ["24h change", formatPctChange(m.oneDayPriceChange), null],
      ["Ends", formatDate(m.endDate), null],
    ];

    const statHtml = stats.map(([label, value, exact]) => {
      let cls = "stat-value";
      if (label === "24h change" && typeof value === "string") {
        if (value.startsWith("+")) cls += " up";
        else if (value.startsWith("-")) cls += " down";
      }
      const title = exact ? ` title="${exact}"` : "";
      return `<div class="stat"><div class="stat-label">${label}</div><div class="${cls}"${title}>${value ?? "—"}</div></div>`;
    }).join("");

    const volumeSummary = `
      <div class="volume-summary">
        <div class="volume-summary-item">
          <span class="volume-summary-label">Total volume</span>
          <span class="volume-summary-value">${formatMoneyExact(m.volume)}</span>
        </div>
        <div class="volume-summary-item">
          <span class="volume-summary-label">Liquidity</span>
          <span class="volume-summary-value">${formatMoneyExact(m.liquidity)}</span>
        </div>
      </div>`;

    detailEl.innerHTML = `
      <button class="detail-back">&larr; Back to results</button>
      <div class="detail-header">
        <img class="detail-img" src="${m.image || ""}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <div>
          <div class="detail-title">${escapeHtml(m.question || "Untitled market")}</div>
          ${m.eventTitle && m.eventTitle !== m.question ? `<div class="detail-event">${escapeHtml(m.eventTitle)}</div>` : ""}
        </div>
      </div>
      <div class="outcomes">${outcomeRows}</div>
      ${volumeSummary}
      <div class="stat-grid">${statHtml}</div>
      ${m.description ? `<div class="description">${escapeHtml(m.description)}</div>` : ""}
      <div class="detail-footer">
        <a class="ext-link" href="${m.url}" target="_blank" rel="noopener noreferrer">View on Polymarket ↗</a>
      </div>
    `;
    detailEl.querySelector(".detail-back").addEventListener("click", hideDetail);
  }

  function hideDetail() {
    detailEl.classList.add("hidden");
    detailEl.innerHTML = "";
    resultsEl.classList.remove("hidden");
  }

  function formatMoney(n) {
    if (n == null || Number.isNaN(n)) return "—";
    if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000) return "$" + (n / 1_000).toFixed(1) + "K";
    return "$" + n.toFixed(0);
  }

  // Full, unabbreviated dollar figure — e.g. "$2,734,521" — used for tooltips
  // and the volume-summary line so the exact number is always available.
  function formatMoneyExact(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  function formatCents(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return "$" + n.toFixed(3);
  }

  function formatPctChange(n) {
    if (n == null || Number.isNaN(n)) return "—";
    const pct = (n * 100).toFixed(1);
    return (n >= 0 ? "+" : "") + pct + "%";
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
