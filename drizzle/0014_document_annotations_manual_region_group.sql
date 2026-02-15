-- Allow annotationType used by manual chunk generation

ALTER TABLE document_annotations
  MODIFY COLUMN annotationType ENUM(
    'table',
    'table_with_articles',
    'text',
    'figure',
    'list',
    'manual_region_group'
  ) NOT NULL;

