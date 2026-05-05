CREATE TABLE IF NOT EXISTS product_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  documentId INT NOT NULL,
  groupId INT NOT NULL,
  name VARCHAR(512) NOT NULL,
  description TEXT,
  sortOrder INT NOT NULL DEFAULT 0,
  createdBy INT NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX product_items_document_idx (documentId),
  INDEX product_items_group_idx (groupId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

ALTER TABLE manual_regions ADD COLUMN productItemId INT;

