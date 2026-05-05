-- Extend documents.processingType and documents.docType enums with new stub types
-- New types:
-- - certificate: Сертификаты на продукцию
-- - passport: Паспорта
-- - warranty_faq: Частые вопросы по гарантийным обращениям

ALTER TABLE `documents`
  MODIFY COLUMN `processingType` ENUM(
    'general',
    'instruction',
    'catalog',
    'certificate',
    'passport',
    'warranty_faq'
  ) NOT NULL DEFAULT 'general';
--> statement-breakpoint

ALTER TABLE `documents`
  MODIFY COLUMN `docType` ENUM(
    'catalog',
    'instruction',
    'general',
    'certificate',
    'passport',
    'warranty_faq'
  ) NOT NULL DEFAULT 'general';

