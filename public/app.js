(() => {
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");
  const statusEl = document.getElementById("search-status");
  const resultsEl = document.getElementById("results");
  const detailEl = document.getElementById("detail");
  const homeBtn = document.getElementById("home-btn");
  const brandHome = document.getElementById("brand-home");

  const authArea = document.getElementById("auth-area");
  const authModal = document.getElementById("auth-modal");
  const authModalClose = document.getElementById("auth-modal-close");
  const tabLogin = document.getElementById("tab-login");
  const tabSignup = document.getElementById("tab-signup");
  const authForm = document.getElementById("auth-form");
  const authUsername = document.getElementById("auth-username");
  const authPassword = document.getElementById("auth-password");
  const authError = document.getElementById("auth-error");
  const authSubmit = document.getElementById("auth-submit");

  const recentsPanel = document.getElementById("recents-panel");
  const recentsList = document.getElementById("recents-list");
  const recentsClose = document.getElementById("recents-close");

  const browseSection = document.getElementById("browse");
  const browseBody = document.getElementById("browse-body");
  const eli5Toggle = document.getElementById("eli5-toggle");

  let currentRequestId = 0;
  let currentUser = null;
  let authMode = "login";
  let eli5Mode = localStorage.getItem("eli5Mode") === "1";
  let lastDetailMarket = null;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch(input.value.trim());
  });

  homeBtn.addEventListener("click", goHome);
  brandHome.addEventListener("click", goHome);

  // ---------------- eli5 mode ----------------

  updateEli5Toggle();
  eli5Toggle.addEventListener("click", () => {
    eli5Mode = !eli5Mode;
    localStorage.setItem("eli5Mode", eli5Mode ? "1" : "0");
    updateEli5Toggle();
    if (!detailEl.classList.contains("hidden") && lastDetailMarket) {
      renderDetail(lastDetailMarket);
    }
  });

  function updateEli5Toggle() {
    eli5Toggle.classList.toggle("on", eli5Mode);
    eli5Toggle.setAttribute("aria-pressed", String(eli5Mode));
    eli5Toggle.textContent = eli5Mode ? "ELI5: On" : "ELI5: Off";
  }

  // ---------------- auth ----------------

  init();

  async function init() {
    fetchBrowse();
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      currentUser = (res.ok && data.user) || null;
    } catch (_) {
      currentUser = null;
    }
    renderAuthArea();
  }

  function renderAuthArea() {
    if (currentUser) {
      authArea.innerHTML = `
        <button type="button" id="recents-toggle" class="auth-link">Recents</button>
        <span class="auth-user">Hi, <strong>${escapeHtml(currentUser.username)}</strong></span>
        <button type="button" id="logout-btn" class="auth-link">Log out</button>
      `;
      document.getElementById("recents-toggle").addEventListener("click", toggleRecents);
      document.getElementById("logout-btn").addEventListener("click", doLogout);
    } else {
      authArea.innerHTML = `
        <button type="button" id="login-btn" class="auth-link">Log in</button>
        <button type="button" id="signup-btn" class="auth-link btn-primary-link">Sign up</button>
      `;
      document.getElementById("login-btn").addEventListener("click", () => openAuthModal("login"));
      document.getElementById("signup-btn").addEventListener("click", () => openAuthModal("signup"));
      closeRecents();
    }
  }

  function openAuthModal(mode) {
    setAuthMode(mode);
    authForm.reset();
    authError.textContent = "";
    authModal.classList.remove("hidden");
    authUsername.focus();
  }

  function closeAuthModal() {
    authModal.classList.add("hidden");
  }

  function setAuthMode(mode) {
    authMode = mode;
    tabLogin.classList.toggle("active", mode === "login");
    tabSignup.classList.toggle("active", mode === "signup");
    authPassword.autocomplete = mode === "login" ? "current-password" : "new-password";
    authSubmit.textContent = mode === "login" ? "Log in" : "Create account";
    authError.textContent = "";
  }

  tabLogin.addEventListener("click", () => setAuthMode("login"));
  tabSignup.addEventListener("click", () => setAuthMode("signup"));
  authModalClose.addEventListener("click", closeAuthModal);
  authModal.addEventListener("click", (e) => {
    if (e.target === authModal) closeAuthModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!authModal.classList.contains("hidden")) closeAuthModal();
    else if (!recentsPanel.classList.contains("hidden")) closeRecents();
  });

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = authUsername.value.trim();
    const password = authPassword.value;
    authError.textContent = "";
    authSubmit.disabled = true;
    const busyLabel = authMode === "login" ? "Logging in…" : "Creating…";
    const idleLabel = authMode === "login" ? "Log in" : "Create account";
    authSubmit.textContent = busyLabel;

    try {
      const res = await fetch(`/api/auth/${authMode === "login" ? "login" : "signup"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "something went wrong");
      currentUser = data.user;
      closeAuthModal();
      renderAuthArea();
    } catch (err) {
      authError.textContent = err.message;
    } finally {
      authSubmit.disabled = false;
      authSubmit.textContent = idleLabel;
    }
  });

  async function doLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (_) {
      // ignore — clear client state regardless
    }
    currentUser = null;
    renderAuthArea();
  }

  // ---------------- recents ----------------

  recentsClose.addEventListener("click", closeRecents);

  function toggleRecents() {
    if (recentsPanel.classList.contains("hidden")) openRecents();
    else closeRecents();
  }

  async function openRecents() {
    recentsPanel.classList.remove("hidden");
    recentsList.innerHTML = `<div class="recents-empty"><span class="spinner"></span>loading…</div>`;
    await loadRecents();
  }

  function closeRecents() {
    recentsPanel.classList.add("hidden");
  }

  async function loadRecents() {
    try {
      const res = await fetch("/api/queries");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed to load recents");
      renderRecentsList(data.queries || []);
    } catch (err) {
      recentsList.innerHTML = `<div class="recents-empty">couldn't load recents: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderRecentsList(items) {
    if (items.length === 0) {
      recentsList.innerHTML = `<div class="recents-empty">no recent queries yet — searches and contracts you open will show up here.</div>`;
      return;
    }
    recentsList.innerHTML = "";
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "recents-item";
      const kindLabel = item.kind === "market" ? "Market" : "Search";
      row.innerHTML = `
        <span class="recents-kind">${kindLabel}</span>
        <span class="recents-text">${escapeHtml(item.query_text)}</span>
        <span class="recents-time">${relativeTime(item.updated_at || item.created_at)}</span>
        <button type="button" class="recents-remove" title="Remove">&times;</button>
      `;
      row.addEventListener("click", (e) => {
        if (e.target.closest(".recents-remove")) return;
        reopenRecent(item);
      });
      row.querySelector(".recents-remove").addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await fetch(`/api/queries?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
        } catch (_) {
          // ignore
        }
        row.remove();
        if (!recentsList.children.length) {
          recentsList.innerHTML = `<div class="recents-empty">no recent queries yet — searches and contracts you open will show up here.</div>`;
        }
      });
      recentsList.appendChild(row);
    }
  }

  function reopenRecent(item) {
    closeRecents();
    if (item.kind === "market" && item.market_id) {
      showDetail({ id: item.market_id, question: item.market_question || item.query_text });
    } else {
      input.value = item.query_text;
      runSearch(item.query_text);
    }
  }

  function logQuery(payload) {
    if (!currentUser) return;
    fetch("/api/queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(() => {
        if (!recentsPanel.classList.contains("hidden")) loadRecents();
      })
      .catch(() => {});
  }

  function relativeTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function goHome() {
    currentRequestId++; // invalidate any in-flight search so it can't repopulate the page
    input.value = "";
    resultsEl.innerHTML = "";
    resultsEl.classList.add("hidden");
    browseSection.classList.remove("hidden");
    statusEl.textContent = "";
    statusEl.classList.remove("error");
    hideDetail();
    window.scrollTo({ top: 0, behavior: "smooth" });
    input.focus();
  }

  async function runSearch(query) {
    hideDetail();
    if (!query) {
      resultsEl.innerHTML = "";
      resultsEl.classList.add("hidden");
      browseSection.classList.remove("hidden");
      statusEl.textContent = "";
      return;
    }

    browseSection.classList.add("hidden");
    resultsEl.classList.remove("hidden");
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
      logQuery({ kind: "search", query_text: query });
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
    browseSection.classList.add("hidden");
    statusEl.textContent = "";
    detailEl.classList.remove("hidden");
    detailEl.innerHTML = `<button class="detail-back">&larr; Back to results</button><div class="empty"><span class="spinner"></span>Loading contract…</div>`;
    detailEl.querySelector(".detail-back").addEventListener("click", hideDetail);
    window.scrollTo({ top: 0, behavior: "smooth" });

    let full = market;
    try {
      const res = await fetch(`/api/market?id=${encodeURIComponent(market.id)}`);
      const data = await res.json();
      if (res.ok && data.market) {
        full = data.market;
        logQuery({
          kind: "market",
          query_text: full.question || String(full.id),
          market_id: String(full.id),
          market_question: full.question || null,
        });
      }
    } catch (_) {
      // fall back to the summary we already have
    }

    renderDetail(full);
  }

  function renderDetail(m) {
    lastDetailMarket = m;
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
      ["Status", m.closed ? "Closed" : m.active ? "Active" : "Inactive", null, null],
      ["Total volume", formatMoney(m.volume), formatMoneyExact(m.volume), "volume"],
      ["24h volume", formatMoney(m.volume24hr), formatMoneyExact(m.volume24hr), "volume"],
      ["Liquidity", formatMoney(m.liquidity), formatMoneyExact(m.liquidity), "liquidity"],
      ["Best bid", formatCents(m.bestBid), null, "bid-ask"],
      ["Best ask", formatCents(m.bestAsk), null, "bid-ask"],
      ["Last trade", formatCents(m.lastTradePrice), null, null],
      ["Spread", formatCents(m.spread), null, "spread"],
      ["24h change", formatPctChange(m.oneDayPriceChange), null, "price-change"],
      ["Ends", formatDate(m.endDate), null, null],
    ];

    const statHtml = stats.map(([label, value, exact, glossaryId]) => {
      let cls = "stat-value";
      if (label === "24h change" && typeof value === "string") {
        if (value.startsWith("+")) cls += " up";
        else if (value.startsWith("-")) cls += " down";
      }
      const title = exact ? ` title="${exact}"` : "";
      return `<div class="stat"><div class="stat-label">${eli5Label(label, glossaryId)}</div><div class="${cls}"${title}>${value ?? "—"}</div></div>`;
    }).join("");

    const volumeSummary = `
      <div class="volume-summary">
        <div class="volume-summary-item">
          <span class="volume-summary-label">${eli5Label("Total volume", "volume")}</span>
          <span class="volume-summary-value">${formatMoneyExact(m.volume)}</span>
        </div>
        <div class="volume-summary-item">
          <span class="volume-summary-label">${eli5Label("Liquidity", "liquidity")}</span>
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
      ${eli5Mode ? buildEli5Callout(m) : ""}
      ${m.description ? `<div class="description">${escapeHtml(m.description)}</div>` : ""}
      <div id="price-chart-container" class="price-chart-wrap"></div>
      ${buildStarterQuestions(m)}
      <div class="detail-footer">
        <a class="ext-link" href="${m.url}" target="_blank" rel="noopener noreferrer">View on Polymarket ↗</a>
      </div>
    `;
    detailEl.querySelector(".detail-back").addEventListener("click", hideDetail);
    loadAndRenderPriceChart(m);
  }

  // ---------------- eli5 mode: inline term explanations + concept callout ----------------

  function glossaryEntry(id) {
    return (window.GLOSSARY || []).find(g => g.id === id) || null;
  }

  function eli5Label(labelText, glossaryId) {
    if (!eli5Mode || !glossaryId) return escapeHtml(labelText);
    const g = glossaryEntry(glossaryId);
    if (!g) return escapeHtml(labelText);
    const title = `${g.term}: ${g.definition} Think of it like: ${g.analogy}`;
    return `<span class="eli5-term" title="${escapeHtml(title)}">${escapeHtml(labelText)}</span>`;
  }

  function buildEli5Callout(m) {
    const top = topOutcome(m);
    const pct = top && top.price != null ? Math.round(top.price * 100) : null;
    const change = m.oneDayPriceChange;
    let conceptKey, specific;

    if (change != null && Math.abs(change) >= 0.05) {
      conceptKey = "info-aggregation";
      specific = `This price moved ${formatPctChange(change)} in the last 24 hours — probably because new information reached traders, and they collectively repriced how likely "${escapeHtml(top ? top.name : "Yes")}" is.`;
    } else if (m.liquidity != null && m.liquidity < 10000) {
      conceptKey = "supply-demand";
      specific = `This market only has ${formatMoneyExact(m.liquidity)} in liquidity — with fewer people trading it, a single large order could swing the price a lot more than it would on a bigger market.`;
    } else if (pct != null && (pct <= 15 || pct >= 85)) {
      conceptKey = "risk-reward";
      const payout = pct > 0 ? (100 / pct).toFixed(1) : "—";
      specific = `"${escapeHtml(top ? top.name : "")}" is priced at ${pct}¢ — the market thinks it's ${pct >= 85 ? "very likely" : "very unlikely"}, which is exactly why a correct bet here would pay out about ${payout}x your money.`;
    } else {
      conceptKey = "opportunity-cost";
      specific = `Every dollar someone puts into "${escapeHtml(m.question || "this market")}" is a dollar they aren't investing, saving, or spending somewhere else — that trade-off is part of why prices reflect real conviction, not just curiosity.`;
    }

    const concept = window.CONCEPTS[conceptKey];
    return `
      <div class="eli5-callout">
        <div class="eli5-callout-label">Concept — ${escapeHtml(concept.label)}</div>
        <div class="eli5-callout-body">${specific} <a href="/glossary.html#concept-${conceptKey}" target="_blank" rel="noopener noreferrer">learn more →</a></div>
      </div>`;
  }

  // ---------------- starter questions ----------------

  function buildStarterQuestions(m) {
    const top = topOutcome(m);
    const topName = top ? top.name : "Yes";
    const pct = top && top.price != null ? Math.round(top.price * 100) : null;
    const other = (m.outcomes || []).find(o => o.name !== topName);
    const otherName = other ? other.name : "the other outcome";

    const questions = [
      `What would have to happen for this to flip from "${topName}" to "${otherName}"?`,
      pct != null
        ? `Why is this priced at ${pct}¢ instead of 50¢? What might the market know that you don't?`
        : `Why might this be priced differently than you'd expect?`,
      `If major news about this broke right now, which way would you expect the price to move — and why?`,
      `Would you rather put $100 into this contract, or into a savings account paying a guaranteed 4%? What are you giving up either way?`,
    ];

    return `
      <div class="starter-questions">
        <div class="starter-questions-label">Things to think about</div>
        ${questions.map(q => `<div class="starter-question-chip">${escapeHtml(q)}</div>`).join("")}
      </div>`;
  }

  function hideDetail() {
    detailEl.classList.add("hidden");
    detailEl.innerHTML = "";
    lastDetailMarket = null;
    if (input.value.trim()) {
      resultsEl.classList.remove("hidden");
      browseSection.classList.add("hidden");
    } else {
      browseSection.classList.remove("hidden");
      resultsEl.classList.add("hidden");
    }
  }

  // ---------------- market browser ----------------

  async function fetchBrowse() {
    browseBody.innerHTML = `<div class="empty"><span class="spinner"></span>loading markets…</div>`;
    try {
      const res = await fetch("/api/browse");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed to load");
      renderBrowse(data.categories || []);
    } catch (err) {
      browseBody.innerHTML = `<div class="empty">couldn't load markets: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderBrowse(categories) {
    if (categories.length === 0) {
      browseBody.innerHTML = `<div class="empty">no markets available right now — try searching instead.</div>`;
      return;
    }
    browseBody.innerHTML = "";
    for (const cat of categories) {
      const section = document.createElement("div");
      section.className = "browse-category";

      const label = document.createElement("div");
      label.className = "browse-category-label";
      label.textContent = cat.label;

      const grid = document.createElement("div");
      grid.className = "browse-grid";
      for (const market of cat.markets) {
        grid.appendChild(buildBrowseCard(market));
      }

      section.appendChild(label);
      section.appendChild(grid);
      browseBody.appendChild(section);
    }
  }

  function buildBrowseCard(market) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "browse-card";

    const title = document.createElement("div");
    title.className = "browse-card-title";
    title.textContent = market.question || market.eventTitle || "Untitled market";

    const foot = document.createElement("div");
    foot.className = "browse-card-foot";

    const vol = document.createElement("span");
    vol.className = "card-sub";
    vol.innerHTML = `<span title="${formatMoneyExact(market.volume)}">Vol ${formatMoney(market.volume)}</span>`;

    const badge = document.createElement("span");
    badge.className = "badge " + badgeClass(market);
    badge.textContent = badgeText(market);

    foot.appendChild(vol);
    foot.appendChild(badge);
    card.appendChild(title);
    card.appendChild(foot);

    card.addEventListener("click", () => showDetail(market));
    return card;
  }

  // ---------------- price history chart ----------------

  async function loadAndRenderPriceChart(m) {
    const container = document.getElementById("price-chart-container");
    if (!container) return;

    const outcomes = m.outcomes || [];
    const tokenIds = m.clobTokenIds || [];
    if (outcomes.length === 0 || tokenIds.length === 0) {
      container.innerHTML = `<div class="price-chart-title">Price history</div><div class="price-chart-empty">no chart data available for this contract.</div>`;
      return;
    }

    let bestIdx = 0, bestPrice = -1;
    outcomes.forEach((o, i) => {
      if (o.price != null && o.price > bestPrice) { bestPrice = o.price; bestIdx = i; }
    });
    const tokenId = tokenIds[bestIdx];
    const outcomeName = outcomes[bestIdx] ? outcomes[bestIdx].name : "Yes";
    const titleHtml = `<div class="price-chart-title">Price history — ${escapeHtml(outcomeName)}</div>`;

    if (!tokenId) {
      container.innerHTML = `${titleHtml}<div class="price-chart-empty">no chart data available for this contract.</div>`;
      return;
    }

    container.innerHTML = `${titleHtml}<div class="price-chart-empty"><span class="spinner"></span>loading chart…</div>`;

    try {
      const res = await fetch(`/api/price-history?token_id=${encodeURIComponent(tokenId)}&interval=max`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed to load price history");
      const points = (data.points || []).filter(p => p.t != null && p.p != null);

      if (points.length < 2) {
        container.innerHTML = `${titleHtml}<div class="price-chart-empty">not enough trading history yet to chart.</div>`;
        return;
      }

      container.innerHTML = titleHtml;
      const host = document.createElement("div");
      host.style.position = "relative";
      container.appendChild(host);
      renderPriceChartSVG(host, points);
    } catch (err) {
      container.innerHTML = `${titleHtml}<div class="price-chart-empty">couldn't load chart: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderPriceChartSVG(host, rawPoints) {
    const MAX_POINTS = 140;
    let points = rawPoints;
    if (points.length > MAX_POINTS) {
      const stride = Math.ceil(points.length / MAX_POINTS);
      points = points.filter((_, i) => i % stride === 0 || i === rawPoints.length - 1);
    }

    const W = 640, H = 160, PAD_L = 42, PAD_R = 8, PAD_T = 10, PAD_B = 22;
    const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;

    const tMin = points[0].t, tMax = points[points.length - 1].t;
    let pMin = Math.min(...points.map(p => p.p));
    let pMax = Math.max(...points.map(p => p.p));
    if (pMin === pMax) { pMin -= 0.05; pMax += 0.05; }
    const pad = (pMax - pMin) * 0.08;
    pMin = Math.max(0, pMin - pad);
    pMax = Math.min(1, pMax + pad);

    const xAt = (t) => PAD_L + ((t - tMin) / Math.max(1, tMax - tMin)) * plotW;
    const yAt = (p) => PAD_T + (1 - (p - pMin) / Math.max(0.0001, pMax - pMin)) * plotH;

    const xs = points.map(p => xAt(p.t));
    const ys = points.map(p => yAt(p.p));
    const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
    const areaD = `${pathD} L${xs[xs.length - 1].toFixed(1)},${(H - PAD_B).toFixed(1)} L${xs[0].toFixed(1)},${(H - PAD_B).toFixed(1)} Z`;

    const gridVals = [pMin, (pMin + pMax) / 2, pMax];
    const gridLines = gridVals.map((val) => {
      const y = yAt(val);
      return `<line class="price-chart-grid" x1="${PAD_L}" x2="${W - PAD_R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" />
              <text class="price-chart-axis-label" x="${PAD_L - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${Math.round(val * 100)}¢</text>`;
    }).join("");

    const firstDate = new Date(tMin * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const lastDate = new Date(tMax * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const gradId = "priceChartGradient" + Math.random().toString(36).slice(2, 8);

    host.innerHTML = `
      <svg class="price-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style="stop-color:var(--brass); stop-opacity:0.22" />
            <stop offset="100%" style="stop-color:var(--brass); stop-opacity:0" />
          </linearGradient>
        </defs>
        ${gridLines}
        <path class="price-chart-area" style="fill:url(#${gradId})" d="${areaD}" />
        <path class="price-chart-line" d="${pathD}" />
        <text class="price-chart-axis-label" x="${PAD_L}" y="${H - 4}" text-anchor="start">${firstDate}</text>
        <text class="price-chart-axis-label" x="${W - PAD_R}" y="${H - 4}" text-anchor="end">${lastDate}</text>
        <line class="price-chart-crosshair" id="chart-crosshair" x1="0" x2="0" y1="${PAD_T}" y2="${H - PAD_B}"></line>
        <circle class="price-chart-dot" id="chart-dot" r="3.5"></circle>
      </svg>
      <div class="price-chart-tooltip" id="chart-tooltip"></div>
    `;

    const svgEl = host.querySelector(".price-chart-svg");
    const crosshair = host.querySelector("#chart-crosshair");
    const dot = host.querySelector("#chart-dot");
    const tooltip = host.querySelector("#chart-tooltip");

    function findNearestIndex(userX) {
      let lo = 0, hi = xs.length - 1;
      if (userX <= xs[0]) return 0;
      if (userX >= xs[hi]) return hi;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] < userX) lo = mid + 1; else hi = mid;
      }
      if (lo > 0 && Math.abs(xs[lo - 1] - userX) < Math.abs(xs[lo] - userX)) return lo - 1;
      return lo;
    }

    function onMove(evt) {
      const rect = svgEl.getBoundingClientRect();
      const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      const fracX = (clientX - rect.left) / rect.width;
      const userX = fracX * W;
      const idx = findNearestIndex(userX);
      const px = xs[idx], py = ys[idx];

      crosshair.setAttribute("x1", px.toFixed(1));
      crosshair.setAttribute("x2", px.toFixed(1));
      crosshair.style.display = "block";
      dot.setAttribute("cx", px.toFixed(1));
      dot.setAttribute("cy", py.toFixed(1));
      dot.style.display = "block";

      const d = new Date(points[idx].t * 1000);
      tooltip.textContent = `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} — ${(points[idx].p * 100).toFixed(1)}¢`;
      tooltip.style.display = "block";
      tooltip.style.left = `${(px / W) * rect.width}px`;
      tooltip.style.top = `${(py / H) * rect.height}px`;
    }

    function onLeave() {
      crosshair.style.display = "none";
      dot.style.display = "none";
      tooltip.style.display = "none";
    }

    svgEl.addEventListener("mousemove", onMove);
    svgEl.addEventListener("mouseleave", onLeave);
    svgEl.addEventListener("touchmove", onMove, { passive: true });
    svgEl.addEventListener("touchend", onLeave);
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
