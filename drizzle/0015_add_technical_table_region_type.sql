ALTER TABLE manual_regions
  MODIFY COLUMN regionType ENUM(
    'text',
    'table',
    'technical_table',
    'table_with_articles',
    'figure',
    'list',
    'faq_question',
    'faq_answer',
    'certificate_answer'
  ) NOT NULL;
