(() => {
  const conceptsGrid = document.getElementById("concepts-grid");
  const glossaryList = document.getElementById("glossary-list");

  const CONCEPT_ORDER = ["supply-demand", "risk-reward", "opportunity-cost", "info-aggregation"];

  conceptsGrid.innerHTML = CONCEPT_ORDER.map((key) => {
    const c = window.CONCEPTS[key];
    return `
      <div class="concept-card" id="concept-${key}">
        <div class="concept-card-label">${escapeHtml(c.label)}</div>
        <div class="concept-card-blurb">${escapeHtml(c.blurb)}</div>
      </div>`;
  }).join("");

  glossaryList.innerHTML = window.GLOSSARY.map((g) => {
    const concept = g.concept ? window.CONCEPTS[g.concept] : null;
    return `
      <div class="glossary-entry" id="term-${g.id}">
        <div class="glossary-term">${escapeHtml(g.term)}</div>
        <div class="glossary-def">${escapeHtml(g.definition)}</div>
        <div class="glossary-analogy"><span class="glossary-analogy-label">think of it like:</span> ${escapeHtml(g.analogy)}</div>
        ${concept ? `<a class="glossary-tag" href="#concept-${g.concept}">${escapeHtml(concept.label)}</a>` : ""}
      </div>`;
  }).join("");

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
