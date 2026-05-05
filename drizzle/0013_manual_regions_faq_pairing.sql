-- Add region types and pairing for warranty FAQ + certificate annotation

ALTER TABLE manual_regions
  MODIFY COLUMN regionType ENUM(
    'text',
    'table',
    'table_with_articles',
    'figure',
    'list',
    'faq_question',
    'faq_answer',
    'certificate_answer'
  ) NOT NULL;
--> statement-breakpoint

ALTER TABLE manual_regions
  ADD COLUMN qaPairId INT NULL;

