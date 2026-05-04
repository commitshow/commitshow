-- Add b-tree indexes for the 6 FK columns that were unindexed.
-- Caught by `npx commitshow audit` (audit_engine `database_indexes`
-- frame). Without these the planner does a seq scan on the parent
-- table any time we cascade or look up children.
--
-- Diagnostic SQL used to find these (re-runnable):
--   SELECT cls.relname, a.attname
--   FROM pg_constraint c
--   JOIN pg_class cls ON cls.oid = c.conrelid
--   JOIN pg_namespace n ON n.oid = cls.relnamespace
--   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
--   WHERE c.contype = 'f' AND n.nspname = 'public' AND array_length(c.conkey,1) = 1
--     AND NOT EXISTS (
--       SELECT 1 FROM pg_index i, unnest(i.indkey::int[]) WITH ORDINALITY u(k, ord)
--       WHERE i.indrelid = c.conrelid AND k = a.attnum AND u.ord = 1
--     );

CREATE INDEX IF NOT EXISTS idx_app_settings_updated_by      ON app_settings(updated_by);
CREATE INDEX IF NOT EXISTS idx_cli_audit_calls_snapshot_id  ON cli_audit_calls(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_cli_link_codes_approved_by   ON cli_link_codes(approved_by);
CREATE INDEX IF NOT EXISTS idx_cmo_drafts_created_by        ON cmo_drafts(created_by);
CREATE INDEX IF NOT EXISTS idx_cmo_templates_updated_by     ON cmo_templates(updated_by);
CREATE INDEX IF NOT EXISTS idx_cmo_workspace_updated_by     ON cmo_workspace(updated_by);
