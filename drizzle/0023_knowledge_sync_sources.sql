-- Safe / idempotent: create sync sources table if missing.
CREATE TABLE IF NOT EXISTS `knowledge_sync_sources` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `pageUrl` VARCHAR(1024) NOT NULL,
  `docType` ENUM('certificate','passport') NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `hrefMustContain` VARCHAR(255) NOT NULL DEFAULT '/upload/',
  `fileExtension` VARCHAR(32) NOT NULL DEFAULT '.pdf',
  `titleSource` ENUM('link_text','filename') NOT NULL DEFAULT 'link_text',
  `titleStripPrefix` VARCHAR(64) DEFAULT 'pdf',
  `linkTextMustContain` VARCHAR(255),
  `lastSyncedAt` TIMESTAMP NULL,
  `lastSyncMessage` VARCHAR(512),
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `knowledge_sync_sources_docType_idx` (`docType`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
-- Add syncSourceId only when missing (avoids Duplicate column after initDatabase).
SET @dbname = DATABASE();
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = 'documents'
      AND COLUMN_NAME = 'syncSourceId'
  ) > 0,
  'SELECT 1',
  'ALTER TABLE `documents` ADD COLUMN `syncSourceId` INT'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
--> statement-breakpoint
SET @dbname = DATABASE();
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = 'documents'
      AND INDEX_NAME = 'documents_syncSource_idx'
  ) > 0,
  'SELECT 1',
  'CREATE INDEX `documents_syncSource_idx` ON `documents` (`syncSourceId`)'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
