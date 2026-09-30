-- knowledge_sync_sources + documents.syncSourceId may already exist via initDatabase.
-- Keep this migration as a no-op so drizzle journal advances without ER_DUP_FIELDNAME.
SELECT 1 AS `migration_0023_knowledge_sync_sources_applied`;
