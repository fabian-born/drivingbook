-- ============================================================
-- 003 – Änderungsprotokoll für Fahrten
-- Jede Anlage, Änderung und Löschung einer Fahrt wird mit altem
-- und neuem Stand festgehalten. fahrt_id hat bewusst keinen
-- Fremdschlüssel, damit Einträge gelöschter Fahrten erhalten bleiben.
-- ============================================================

CREATE TABLE IF NOT EXISTS fahrten_audit (
    id          BIGSERIAL PRIMARY KEY,
    fahrt_id    INTEGER      NOT NULL,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action      VARCHAR(10)  NOT NULL
                    CHECK (action IN ('create', 'update', 'delete')),
    old_data    JSONB,
    new_data    JSONB,
    source      VARCHAR(20)  NOT NULL,   -- 'web' (Login) oder 'api_token'
    changed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fahrten_audit_fahrt
    ON fahrten_audit (fahrt_id);

CREATE INDEX IF NOT EXISTS idx_fahrten_audit_user_changed
    ON fahrten_audit (user_id, changed_at);
