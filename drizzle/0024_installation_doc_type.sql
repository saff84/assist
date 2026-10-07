-- Topic: installation and equipment-line compatibility knowledge (Markdown)
ALTER TABLE `documents` MODIFY COLUMN `processingType` ENUM('general','instruction','catalog','certificate','passport','warranty_faq','installation','company') NOT NULL DEFAULT 'general';
--> statement-breakpoint
ALTER TABLE `documents` MODIFY COLUMN `docType` ENUM('catalog','instruction','general','certificate','passport','warranty_faq','installation','company') NOT NULL DEFAULT 'general';
