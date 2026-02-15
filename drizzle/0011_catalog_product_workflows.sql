-- Migration: catalog product workflows (product groups, annotations, manual regions)

ALTER TABLE `products`
  ADD COLUMN `groupId` INT NULL AFTER `sectionId`;

CREATE INDEX `products_group_idx` ON `products` (`groupId`);

CREATE TABLE `product_groups` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `documentId` INT NOT NULL,
  `name` VARCHAR(512) NOT NULL,
  `description` TEXT NULL,
  `sectionPath` VARCHAR(512) NULL,
  `pageStart` INT NULL,
  `pageEnd` INT NULL,
  `createdBy` INT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `product_groups_document_idx` (`documentId`)
);

CREATE TABLE `document_annotations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `documentId` INT NOT NULL,
  `chunkIndex` INT NOT NULL,
  `annotationType` ENUM('table','table_with_articles','text','figure','list') NOT NULL,
  `isNomenclatureTable` BOOLEAN NOT NULL DEFAULT 0,
  `productGroupId` INT NULL,
  `notes` TEXT NULL,
  `annotatedBy` INT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `annotations_document_idx` (`documentId`),
  INDEX `annotations_chunk_idx` (`documentId`, `chunkIndex`),
  INDEX `annotations_group_idx` (`productGroupId`)
);

CREATE TABLE `manual_regions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `documentId` INT NOT NULL,
  `pageNumber` INT NOT NULL,
  `regionType` ENUM('text','table','table_with_articles','figure','list') NOT NULL,
  `coordinates` JSON NOT NULL,
  `extractedText` TEXT NULL,
  `isNomenclatureTable` BOOLEAN NOT NULL DEFAULT 0,
  `productGroupId` INT NULL,
  `notes` TEXT NULL,
  `createdBy` INT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `manual_regions_document_idx` (`documentId`),
  INDEX `manual_regions_page_idx` (`documentId`, `pageNumber`)
);

