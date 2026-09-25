-- ============================================================
-- 005 – Benutzernamen nur noch in Kleinbuchstaben
-- Login und Anlage schreiben den Namen ab jetzt immer klein.
-- Bestehende Namen werden umgestellt, sofern dadurch kein
-- Duplikat entsteht (z. B. "Max" und "max").
-- ============================================================

UPDATE users u SET username = LOWER(u.username)
WHERE  u.username <> LOWER(u.username)
  AND  NOT EXISTS (
         SELECT 1 FROM users o
         WHERE  o.id <> u.id AND LOWER(o.username) = LOWER(u.username)
       );
