-- Kruzer Dashboards — D1 schema inicial (Camada 1 do roadmap "controle de operação").
-- Cria a fonte única de verdade pra estado vivo dos dashboards.
--
-- Como aplicar:
--   wrangler d1 execute kruzer-state --file=migrations/0001_init.sql           (local)
--   wrangler d1 execute kruzer-state --file=migrations/0001_init.sql --remote  (prod)
--
-- Versionamento: cada nova migration vira 000N_descricao.sql; nunca edite uma
-- migration já aplicada — sempre crie a próxima.

-- ── Estado vivo (chave-valor por escopo, com optimistic concurrency) ────────
CREATE TABLE IF NOT EXISTS state (
  scope       TEXT NOT NULL,           -- 'vena-roadmap', 'fst-report', 'vena-capacity', 'ops', ...
  key         TEXT NOT NULL,           -- 'remarks', 'followups', 'schedule', 'scenario:current', ...
  value       TEXT NOT NULL,           -- payload JSON
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,           -- ISO8601
  updated_by  TEXT,                    -- email/usuário do Basic Auth (Camada 3 substitui)
  PRIMARY KEY (scope, key)
);

CREATE INDEX IF NOT EXISTS idx_state_scope ON state(scope);
CREATE INDEX IF NOT EXISTS idx_state_updated_at ON state(updated_at DESC);

-- ── Histórico de escritas (audit trail + "o que mudou") ─────────────────────
-- Cada PUT/DELETE em /api/state grava 1 linha. Custo: ~1 row pequena por escrita.
-- Retenção: vamos manter indefinidamente por enquanto; caso cresça muito, criar
-- migration de cleanup com window de 6m.
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope       TEXT NOT NULL,
  key         TEXT NOT NULL,
  action      TEXT NOT NULL,           -- 'set' | 'delete'
  old_value   TEXT,                    -- JSON anterior (null no primeiro)
  new_value   TEXT,                    -- JSON novo (null no delete)
  old_version INTEGER,
  new_version INTEGER,
  updated_by  TEXT,
  ts          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_scope_ts ON audit_log(scope, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
