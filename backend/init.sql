-- ============================================================
-- Fahrtenbuch – Datenbankinitialisierung
-- PostgreSQL
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Erweiterungen
-- ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- für gen_random_bytes()

-- ────────────────────────────────────────────────────────────
-- Tabelle: users
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(100) UNIQUE NOT NULL,
    password    VARCHAR(255)        NOT NULL,   -- bcrypt-Hash
    role        VARCHAR(20)         NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user', 'admin')),
    created_at  TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- Tabelle: vehicles
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- Tabelle: api_tokens
-- Unterstützt einen Default-Token + beliebig viele weitere
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_tokens (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       VARCHAR(255) UNIQUE NOT NULL,
    label       VARCHAR(100)        NOT NULL DEFAULT 'Default',
    is_default  BOOLEAN             NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

-- Pro User darf es nur einen Default-Token geben
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_tokens_one_default
    ON api_tokens (user_id)
    WHERE is_default = TRUE;

-- ────────────────────────────────────────────────────────────
-- Tabelle: fahrten
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fahrten (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER      NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    vehicle_id  INTEGER               REFERENCES vehicles(id) ON DELETE SET NULL,
    kmstand     INTEGER      NOT NULL,
    ziel        TEXT         NOT NULL,
    fahrtart    VARCHAR(20)  NOT NULL
                    CHECK (fahrtart IN ('privat', 'geschäftlich')),
    timestamp   TIMESTAMPTZ  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Index für die häufigste Abfrage: User + Timestamp
-- (DATE_TRUNC ist nicht IMMUTABLE und kann nicht direkt indiziert werden;
--  ein Index auf user_id + timestamp wird von PostgreSQL für Monatsabfragen
--  automatisch per Index-Scan genutzt)
CREATE INDEX IF NOT EXISTS idx_fahrten_user_timestamp
    ON fahrten (user_id, timestamp);

-- Index für Fahrzeug-Abfragen
CREATE INDEX IF NOT EXISTS idx_fahrten_vehicle
    ON fahrten (vehicle_id);

-- ────────────────────────────────────────────────────────────
-- Seed: Standard-Admin-User
-- Passwort: "admin" (bcrypt, bitte nach dem ersten Login ändern!)
-- ────────────────────────────────────────────────────────────
INSERT INTO users (username, password, role)
VALUES (
    'admin',
    '$2b$12$5PNQj18UvvTwQ6BMcrhJE.GhznZ91vgVU1oNC1fzJX25uDXFSDyDe',
    'admin'
)
ON CONFLICT (username) DO NOTHING;

-- Default API-Token für den Admin-User (nach dem Insert der User-ID)
INSERT INTO api_tokens (user_id, token, label, is_default)
SELECT id,
       'fahrtenbuch-default-token-CHANGE-ME-' || id,
       'Default',
       TRUE
FROM   users
WHERE  username = 'admin'
ON CONFLICT DO NOTHING;

-- Standard-Fahrzeug für Admin
INSERT INTO vehicles (user_id, name)
SELECT id, 'Fahrzeug 1'
FROM   users
WHERE  username = 'admin'
ON CONFLICT DO NOTHING;
