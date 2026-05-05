-- Forgot the column-level GRANT in 20260505_trust_levels.sql.
-- Without this, /scouts/:id and /creators/:id silently 401 with
-- "permission denied for table members" on logged-in clients
-- because PUBLIC_MEMBER_COLUMNS now includes trust_level + trust_level_at
-- but the column-level grant pattern (set up in 20260425140000_email
-- _column_grants.sql) blocks every column not explicitly granted.
--
-- Recurring memory: "컬럼 추가 시 GRANT SELECT 같이". members + projects
-- are on the column-level grant pattern, so every new column needs
-- this follow-up — silent 42501 fail otherwise.

GRANT SELECT (trust_level, trust_level_at) ON public.members TO anon, authenticated;
