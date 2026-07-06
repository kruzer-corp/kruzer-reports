// ============================================================================
// Kruzer Components — primitivos visuais reusáveis (string-based, sem framework).
// Origem: refactor Fase C (2026-06-25, HANDOFF_OPS_CONTROL.md).
//
// Filosofia: cada função recebe um objeto de opções e devolve uma string de HTML.
// O caller plugga no DOM via innerHTML (padrão dos dashboards atuais).
// Mantém a stack zero-build atual sem introduzir JSX/templates externos.
//
// Estilos vêm de /shared/tokens.css (paleta Kruzer) + classes locais .kpi, .risk-row etc
// que os dashboards já implementam. Pra novos dashboards, copiar o CSS base do /ops/.
// ============================================================================

window.KruzerComponents = (function () {
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  // ── KPI card ────────────────────────────────────────────────────────────
  // {label, value, hint?, accent?: 'primary'|'success'|'warning'|'error'|'navy'|string}
  // Quando accent é um dos nomes acima, mapeia pra var(--kruzer-*). Strings livres
  // viram cor literal (útil pra cores de projeto como var(--fst)).
  const ACCENT_MAP = {
    primary: 'var(--kruzer-primary)',
    success: 'var(--kruzer-success)',
    warning: 'var(--kruzer-warning)',
    error:   'var(--kruzer-error)',
    navy:    'var(--kruzer-navy-300)',
    neutral: 'var(--kruzer-neutral-500)',
  };
  function accentColor(a) {
    if (!a) return ACCENT_MAP.navy;
    return ACCENT_MAP[a] || a;
  }

  function kpiCard({ label, value, hint, accent }) {
    const color = accentColor(accent);
    return `
      <div class="kpi" style="border-top: 3px solid ${color}">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(value)}</div>
        ${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ''}
      </div>
    `;
  }

  // ── Alert banner ────────────────────────────────────────────────────────
  // {severity: 'crit'|'warn'|'info', title, body, chip?}
  // Renderiza um bloco com a estética dos avisos do /timeline/ e /ops/.
  function alertBanner({ severity = 'warn', title, body, chip }) {
    const chipLabel = chip || (severity === 'crit' ? 'Risco grave' : severity === 'info' ? 'Atenção' : 'Atenção');
    return `
      <div class="alert-item ${severity}">
        <div class="a-head">
          <span class="a-chip">${escapeHtml(chipLabel)}</span>
          <span class="a-title">${escapeHtml(title)}</span>
        </div>
        <div class="a-body">${body /* HTML permitido pelo caller */}</div>
      </div>
    `;
  }

  // ── Risk row (linha do /ops/) ───────────────────────────────────────────
  // {severity, type, project, title, meta, metric, url?}
  function riskRow({ severity, type, project, title, meta, metric, url }) {
    const projColor = `var(--${project.toLowerCase()})`;
    const titleHtml = url
      ? `<a href="${escapeHtml(url)}" ${url.startsWith('http') ? 'target="_blank"' : ''}>${escapeHtml(title)}</a>`
      : escapeHtml(title);
    return `
      <div class="risk-row ${severity}">
        <div class="chip">${escapeHtml(type)}</div>
        <div class="proj ${escapeHtml(project)}" style="background:${projColor}">${escapeHtml(project)}</div>
        <div class="body">
          <div class="title">${titleHtml}</div>
          ${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ''}
        </div>
        <div class="metric">${escapeHtml(metric)}</div>
      </div>
    `;
  }

  // ── Links pro JIRA ────────────────────────────────────────────────────────
  // Padrão único de "referência clicável": sempre que houver a key de um item
  // (ou uma lista delas), estes helpers viram o link pro browse do JIRA. Assim
  // não se re-inventa o <a target="_blank"> caso a caso em cada dashboard.

  // Uma key isolada → link HTML. Sem url, degrada pra texto escapado.
  function jiraKey(key, url) {
    if (!key) return '';
    return url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(key)}</a>`
      : escapeHtml(key);
  }

  // Lista de refs [{key, url}] → keys linkadas, separadas por vírgula, com "…"
  // quando truncada em `max`. Útil pras métricas de risco do /ops/.
  function jiraKeys(refs, max = 3) {
    if (!refs || !refs.length) return '';
    const shown = refs.slice(0, max).map(r => jiraKey(r.key, r.url)).join(', ');
    return shown + (refs.length > max ? '…' : '');
  }

  // Embrulha um fragmento SVG (texto, diamante, barra…) num <a> clicável.
  // SVG suporta <a href target> nativo — é assim que se linka marcos/labels de
  // gantt sem precisar de handler de clique em JS. Sem url, devolve o inner cru.
  function svgLink(url, innerSvg) {
    if (!url) return innerSvg;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${innerSvg}</a>`;
  }

  return { escapeHtml, kpiCard, alertBanner, riskRow, jiraKey, jiraKeys, svgLink };
})();
