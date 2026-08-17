(() => {
  const loginSection = document.getElementById("admin-login");
  const loginForm = document.getElementById("admin-login-form");
  const passwordInput = document.getElementById("admin-password");
  const loginError = document.getElementById("admin-login-error");
  const dashboard = document.getElementById("admin-dashboard");
  const tiles = document.getElementById("admin-tiles");
  const tiles2 = document.getElementById("admin-tiles-2");
  const chartEl = document.getElementById("admin-chart");
  const signupsEl = document.getElementById("admin-signups");

  init();

  async function init() {
    const ok = await tryLoadStats();
    if (!ok) {
      loginSection.classList.remove("hidden");
      dashboard.classList.add("hidden");
      passwordInput.focus();
    }
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.textContent = "";
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput.value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "wrong password");
      passwordInput.value = "";
      // tryLoadStats() already writes its own message into loginError if it fails
      await tryLoadStats();
    } catch (err) {
      loginError.textContent = err.message;
    }
  });

  async function tryLoadStats() {
    try {
      const res = await fetch("/api/admin/stats");
      if (res.status === 401) return false;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed to load stats");
      renderDashboard(data);
      loginSection.classList.add("hidden");
      dashboard.classList.remove("hidden");
      return true;
    } catch (err) {
      loginError.textContent = err.message;
      return false;
    }
  }

  function renderDashboard(d) {
    tiles.innerHTML = `
      <div class="volume-summary-item">
        <span class="volume-summary-label">Total users</span>
        <span class="volume-summary-value">${d.total_users.toLocaleString()}</span>
      </div>
      <div class="volume-summary-item">
        <span class="volume-summary-label">Total queries logged</span>
        <span class="volume-summary-value">${d.total_queries.toLocaleString()}</span>
      </div>
    `;

    tiles2.innerHTML = `
      <div class="stat"><div class="stat-label">Signups today</div><div class="stat-value">${d.signups_today}</div></div>
      <div class="stat"><div class="stat-label">Queries today</div><div class="stat-value">${d.queries_today}</div></div>
    `;

    const maxVal = Math.max(1, ...d.last_7_days.map((r) => Math.max(r.signups, r.queries)));
    chartEl.innerHTML = d.last_7_days
      .map((r) => {
        const sH = Math.round((r.signups / maxVal) * 100);
        const qH = Math.round((r.queries / maxVal) * 100);
        const label = new Date(r.date + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "short" });
        return `
          <div class="admin-chart-col">
            <div class="admin-chart-bars">
              <div class="admin-chart-bar admin-chart-bar-queries" style="height:${qH}%" title="${r.queries} queries"></div>
              <div class="admin-chart-bar admin-chart-bar-signups" style="height:${sH}%" title="${r.signups} signups"></div>
            </div>
            <div class="admin-chart-label">${label}</div>
          </div>`;
      })
      .join("");

    if (d.recent_signups.length === 0) {
      signupsEl.innerHTML = `<div class="empty">no signups yet</div>`;
    } else {
      signupsEl.innerHTML = d.recent_signups
        .map(
          (u) => `
        <div class="recents-item" style="cursor:default;">
          <span class="recents-text">${escapeHtml(u.username)}</span>
          <span class="recents-time">${new Date(u.created_at).toLocaleString()}</span>
        </div>`
        )
        .join("");
    }
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
