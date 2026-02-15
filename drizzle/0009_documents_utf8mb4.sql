ALTER TABLE documents
  MODIFY COLUMN filename VARCHAR(255)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci NOT NULL;

