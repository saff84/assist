-- Fields for syncing certificates/passports from sanext.ru knowledge base pages
ALTER TABLE `documents` ADD COLUMN `sourceUrl` VARCHAR(1024);
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `contentHash` VARCHAR(64);
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `sourceSyncedAt` TIMESTAMP NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_sourceUrl_uidx` ON `documents` (`sourceUrl`);
