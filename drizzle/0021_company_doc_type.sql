-- Add company doc type for "About company" knowledge base (safe, no wipe)
ALTER TABLE `documents` MODIFY COLUMN `processingType` ENUM('general','instruction','catalog','certificate','passport','warranty_faq','company') NOT NULL DEFAULT 'general';
--> statement-breakpoint
ALTER TABLE `documents` MODIFY COLUMN `docType` ENUM('catalog','instruction','general','certificate','passport','warranty_faq','company') NOT NULL DEFAULT 'general';
