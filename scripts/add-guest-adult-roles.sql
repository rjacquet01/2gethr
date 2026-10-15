-- Adds the GUEST and ADULT member roles to the family_role enum.
-- ALTER TYPE ... ADD VALUE cannot be used inside the same transaction that
-- then uses the new value, so each statement runs on its own (the runner
-- sends them one at a time over Neon's HTTP driver, which is autocommit).
ALTER TYPE family_role ADD VALUE IF NOT EXISTS 'GUEST';
ALTER TYPE family_role ADD VALUE IF NOT EXISTS 'ADULT';
