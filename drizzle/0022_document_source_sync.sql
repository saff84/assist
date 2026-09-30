-- Columns may already exist via initDatabase always-on ALTER (production).
-- Keep this migration as a no-op so drizzle journal advances without ER_DUP_FIELDNAME.
SELECT 1 AS `migration_0022_document_source_sync_applied`;
