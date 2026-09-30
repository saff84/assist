-- Configurable scrape sources for certificates / passports
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
ALTER TABLE `documents` ADD COLUMN `syncSourceId` INT;
--> statement-breakpoint
CREATE INDEX `documents_syncSource_idx` ON `documents` (`syncSourceId`);
