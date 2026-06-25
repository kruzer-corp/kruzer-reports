// ============================================================================
// Kruzer State — cliente de estado compartilhado (Camada 1, 2026-06-25).
//
// Modelo:
//   · Cache local (localStorage) é sempre leitura síncrona. Garante que dashboards
//     antigos com API síncrona não quebram.
//   · Servidor (D1 via /api/state) é a fonte de verdade. Sincroniza em background.
//   · Escritas vão pro local imediatamente E disparam pro servidor com
//     optimistic concurrency (expectedVersion).
//   · Conflito (409) emite evento 'kruzer:state:conflict' — o caller decide
//     (mostra toast, força reload, mostra diff).
//   · Mudança do servidor confirmada emite 'kruzer:state:synced' pra dashboards
//     re-renderizarem.
//
// API (window.KruzerState):
//   read(scope, key)              → {value, version, source} síncrono (cache)
//   write(scope, key, value, opts) → Promise<{version}> async; opts.expectedVersion p/ concurrency
//   sync(scope, key)              → Promise pulled-from-server, atualiza cache se mais novo
//   syncAll(scope)                → todas as keys do escopo
//   subscribe(scope, key, fn)     → escuta mudanças (chamado quando cache atualiza)
//   delete(scope, key)            → Promise
//   audit(scope?, limit?)         → Promise<[entries]>
// ============================================================================

window.KruzerState = (function () {
  const LS_PREFIX = 'kruzer:state:'; // chave local: 'kruzer:state:<scope>/<key>' → JSON {value, version, updated_at}
  const subscribers = {};            // scope/key → [fn,fn]

  function lsKey(scope, key) { return LS_PREFIX + scope + '/' + key; }

  function readLocal(scope, key) {
    try {
      const raw = localStorage.getItem(lsKey(scope, key));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  function writeLocal(scope, key, payload) {
    try {
      localStorage.setItem(lsKey(scope, key), JSON.stringify(payload));
    } catch {}
  }

  function notify(scope, key, payload) {
    const k = scope + '/' + key;
    (subscribers[k] || []).forEach(fn => { try { fn(payload); } catch {} });
    window.dispatchEvent(new CustomEvent('kruzer:state:synced', { detail: { scope, key, ...payload } }));
  }

  // ── API pública ────────────────────────────────────────────────────────
  function read(scope, key) {
    const p = readLocal(scope, key);
    if (p) return { value: p.value, version: p.version || 0, source: 'local', updated_at: p.updated_at };
    return { value: null, version: 0, source: 'empty' };
  }

  async function sync(scope, key) {
    try {
      const res = await fetch(`/api/state/${encodeURIComponent(scope)}/${encodeURIComponent(key)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      const data = await res.json();
      const cur = readLocal(scope, key);
      if (!cur || (data.version || 0) > (cur.version || 0)) {
        writeLocal(scope, key, { value: data.value, version: data.version, updated_at: data.updated_at, updated_by: data.updated_by });
        notify(scope, key, { value: data.value, version: data.version, source: 'server' });
      }
      return data;
    } catch (e) {
      // Servidor indisponível: cache local segue valendo. Não loga erro hard.
      return null;
    }
  }

  async function syncAll(scope) {
    try {
      const res = await fetch(`/api/state/${encodeURIComponent(scope)}`);
      if (!res.ok) return null;
      const { items } = await res.json();
      // Sincroniza só as chaves que estão desatualizadas localmente.
      await Promise.all((items || []).map(async (it) => {
        const cur = readLocal(scope, it.key);
        if (!cur || (it.version || 0) > (cur.version || 0)) {
          await sync(scope, it.key);
        }
      }));
      return items;
    } catch { return null; }
  }

  async function write(scope, key, value, opts) {
    opts = opts || {};
    const cur = readLocal(scope, key);
    const expectedVersion = (opts.expectedVersion != null)
      ? opts.expectedVersion
      : (cur ? cur.version : undefined);
    // Otimismo local: escreve imediatamente o cache local com versão tentativa.
    // Se servidor confirmar, ajusta. Se falhar (409), reverte e dispara conflict.
    const tentativeVersion = (cur ? (cur.version || 0) : 0) + 1;
    writeLocal(scope, key, { value, version: tentativeVersion, updated_at: new Date().toISOString(), pending: true });
    try {
      const res = await fetch(`/api/state/${encodeURIComponent(scope)}/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, expectedVersion }),
      });
      if (res.status === 409) {
        const conflict = await res.json();
        // Reverte cache pra estado do servidor.
        if (conflict && conflict.current) {
          writeLocal(scope, key, { value: conflict.current.value, version: conflict.current.version, updated_at: new Date().toISOString() });
          notify(scope, key, { value: conflict.current.value, version: conflict.current.version, source: 'server' });
        }
        window.dispatchEvent(new CustomEvent('kruzer:state:conflict', { detail: { scope, key, server: conflict && conflict.current } }));
        throw new Error('version conflict');
      }
      if (!res.ok) {
        // Mantém o cache local (versão otimista). Servidor pode estar offline.
        // App segue funcionando degradado. Background retry pode ser adicionado depois.
        const t = await res.text().catch(() => '');
        throw new Error(`${res.status}: ${t || res.statusText}`);
      }
      const data = await res.json();
      writeLocal(scope, key, { value, version: data.version, updated_at: data.updated_at, updated_by: data.updated_by });
      return data;
    } catch (e) {
      // Não silencia: o caller decide. Mas o cache local já tem o valor otimista.
      throw e;
    }
  }

  async function del(scope, key) {
    try {
      localStorage.removeItem(lsKey(scope, key));
    } catch {}
    try {
      await fetch(`/api/state/${encodeURIComponent(scope)}/${encodeURIComponent(key)}`, { method: 'DELETE' });
    } catch {}
  }

  function subscribe(scope, key, fn) {
    const k = scope + '/' + key;
    (subscribers[k] = subscribers[k] || []).push(fn);
    return () => {
      subscribers[k] = (subscribers[k] || []).filter(f => f !== fn);
    };
  }

  async function audit(scope, limit) {
    const qs = new URLSearchParams();
    if (scope) qs.set('scope', scope);
    if (limit) qs.set('limit', String(limit));
    try {
      const res = await fetch('/api/audit' + (qs.toString() ? '?' + qs : ''));
      if (!res.ok) return null;
      return (await res.json()).items || [];
    } catch { return null; }
  }

  // ── Migração one-shot: importa chaves localStorage antigas pro novo formato.
  // Chamar uma vez no boot de cada dashboard que usa state. Idempotente.
  function importLegacyKey(legacyKey, scope, newKey) {
    try {
      const raw = localStorage.getItem(legacyKey);
      if (!raw) return false;
      // só importa se a chave nova ainda não existe (não sobrescreve)
      if (readLocal(scope, newKey)) return false;
      let value;
      try { value = JSON.parse(raw); } catch { value = raw; }
      writeLocal(scope, newKey, { value, version: 0, updated_at: new Date().toISOString(), imported: true });
      return true;
    } catch { return false; }
  }

  return { read, write, sync, syncAll, delete: del, subscribe, audit, importLegacyKey };
})();
