-- Migration: structured ingest enhancements

ALTER TABLE `documents`
  ADD COLUMN `docType` ENUM('catalog', 'manual', 'other') NOT NULL DEFAULT 'other' AFTER `processingType`,
  ADD COLUMN `title` VARCHAR(512) NULL AFTER `docType`,
  ADD COLUMN `year` INT NULL AFTER `title`,
  ADD COLUMN `pages` INT NULL AFTER `year`,
  ADD COLUMN `tocJson` JSON NULL AFTER `documentMetadata`;

ALTER TABLE `document_chunks`
  ADD COLUMN `pageNumber` INT NULL AFTER `tokenCount`,
  ADD COLUMN `sectionPath` VARCHAR(512) NULL AFTER `pageNumber`,
  ADD COLUMN `elementType` ENUM('text', 'table', 'figure', 'list', 'header') NOT NULL DEFAULT 'text' AFTER `sectionPath`,
  ADD COLUMN `tableJson` JSON NULL AFTER `elementType`,
  ADD COLUMN `language` VARCHAR(8) NOT NULL DEFAULT 'ru' AFTER `tableJson`,
  ADD COLUMN `bm25Terms` LONGTEXT NULL AFTER `language`;

CREATE TABLE `sections` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `documentId` INT NOT NULL,
  `sectionPath` VARCHAR(512) NOT NULL,
  `title` VARCHAR(512) NOT NULL,
  `level` INT NOT NULL DEFAULT 1,
  `parentPath` VARCHAR(512) NULL,
  `pageStart` INT NULL,
  `pageEnd` INT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `sections_document_idx` (`documentId`),
  INDEX `sections_sectionPath_idx` (`sectionPath`)
);

CREATE TABLE `products` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `documentId` INT NOT NULL,
  `sectionId` INT NULL,
  `sku` VARCHAR(128) NOT NULL,
  `name` VARCHAR(512) NULL,
  `attributes` JSON NULL,
  `pageNumber` INT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `products_document_idx` (`documentId`),
  INDEX `products_sku_idx` (`sku`)
);

