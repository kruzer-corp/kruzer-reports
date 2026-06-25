// ============================================================================
// Kruzer Capacity — helpers compartilhados de cronograma e persistência.
// Origem: refactor Fase B (2026-06-25, HANDOFF_OPS_CONTROL.md).
//
// Escopo deliberadamente conservador: NÃO move a engine `computeSchedule()`
// (ela referencia estado escopado e variantes específicas por projeto). Move
// apenas o que é seguramente compartilhado:
//   · Helpers de tempo/string (MS_DAY, startOfDay, addDays, cleanName)
//   · Cores de bloco por status (BLK_HEX)
//   · IO de persistência (readPublishedSchedule / publishSchedule)
//
// Por que importa: quando subir D1 (Camada 1 do roadmap), basta trocar a
// implementação de read/publish aqui pra apontar pro Worker. Os 4 callers
// (vena/capacity, fst/capacity, vena/roadmap, fst/index) não mudam.
//
// Dívida conhecida: `computeSchedule` ainda é duplicado entre planner e report.
// Consolidar exige refatorar dependências de closure — deferido pra quando
// houver suite de teste runtime.
// ============================================================================

window.KruzerCapacity = (function () {
  const MS_DAY = 86400000;

  function startOfDay(d) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
  }

  function addDays(d, n) {
    return new Date(d.getTime() + n * MS_DAY);
  }

  // Remove prefixos DMND0000 |, P0 |, Onda 1 |, Done | etc.
  function cleanName(s) {
    return String(s || '').replace(/^(DMND\d+|P\d|Onda\s*\d+|Done)\s*\|\s*/i, '').trim();
  }

  // Paleta de blocos por status (alinhada à paleta Kruzer em /shared/tokens.css).
  const BLK_HEX = {
    's-dev':     '#12B76A', // success — em desenvolvimento
    's-refin':   '#3151CE', // primary — refinamento
    's-warn':    '#F79009', // warning — atenção
    's-neutral': '#C6C9D9', // neutral — sem ação
    's-backlog': '#48507D', // navy-300 — backlog
    's-block':   '#F04438', // error   — bloqueado
  };

  // ── Persistência (Camada 1: D1 via /api/state, cache local).
  // Scope canônico: '<projeto>-capacity', key fixa 'schedule'.
  // KruzerState garante leitura síncrona (cache) + sync em background + escrita async.
  function legacyKey(scope) { return `kruzer:${scope}-capacity:schedule`; }
  function stateScope(scope) { return `${scope}-capacity`; }

  // Migração one-shot: se houver schedule na chave antiga, importa pra nova
  // estrutura sem sobrescrever. Idempotente.
  function ensureMigrated(scope) {
    if (typeof window === 'undefined' || !window.KruzerState) return;
    window.KruzerState.importLegacyKey(legacyKey(scope), stateScope(scope), 'schedule');
  }

  function readPublishedSchedule(scope) {
    ensureMigrated(scope);
    // Primeiro tenta state.js (cache local + sync server em background).
    if (typeof window !== 'undefined' && window.KruzerState) {
      const r = window.KruzerState.read(stateScope(scope), 'schedule');
      if (r && r.value && r.value.v === 1 && Array.isArray(r.value.lanes)) return r.value;
    }
    // Fallback duro: chave legacy direto no localStorage.
    try {
      const raw = localStorage.getItem(legacyKey(scope));
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.v !== 1 || !Array.isArray(s.lanes)) return null;
      return s;
    } catch { return null; }
  }

  function publishSchedule(scope, payload) {
    ensureMigrated(scope);
    // Mantém a chave legacy escrita também — durante a migração, outros tabs/dashboards
    // que ainda lêem direto continuam funcionando. Remover depois que todos migrarem.
    try { localStorage.setItem(legacyKey(scope), JSON.stringify(payload)); } catch {}
    // Escreve via state.js (otimista local + PUT pro D1).
    if (typeof window !== 'undefined' && window.KruzerState) {
      // Pega versão atual pra optimistic concurrency.
      const cur = window.KruzerState.read(stateScope(scope), 'schedule');
      window.KruzerState.write(stateScope(scope), 'schedule', payload, {
        expectedVersion: cur ? cur.version : undefined,
      }).catch(() => { /* mantém cache local; servidor pode estar offline */ });
    }
    return true;
  }

  // Sincronização proativa: chamar no boot da página pra puxar mudanças
  // feitas em outro navegador desde a última visita.
  async function syncSchedule(scope) {
    if (typeof window === 'undefined' || !window.KruzerState) return null;
    return window.KruzerState.sync(stateScope(scope), 'schedule');
  }

  return { MS_DAY, startOfDay, addDays, cleanName, BLK_HEX, readPublishedSchedule, publishSchedule, syncSchedule };
})();
