-- Additive indexes only — safe for existing knowledge base (no DROP/TRUNCATE).
-- Note: document_chunks(documentId) already exists as documentId_idx (0001).
CREATE INDEX `document_chunks_documentId_chunkIndex_idx` ON `document_chunks` (`documentId`,`chunkIndex`);
--> statement-breakpoint
CREATE INDEX `documents_status_updated_idx` ON `documents` (`status`,`updatedAt`);
