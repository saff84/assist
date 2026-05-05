UPDATE `documents`
SET `processingType` = 'general'
WHERE `processingType` IS NULL
   OR `processingType` IN ('simple', 'structured', 'manual', '');
--> statement-breakpoint

ALTER TABLE `documents`
  MODIFY COLUMN `processingType` ENUM('general','instruction','catalog') NOT NULL DEFAULT 'general';

