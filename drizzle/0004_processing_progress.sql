ALTER TABLE `documents`
  ADD COLUMN `processingStage` ENUM('queued','parsing','chunking','embedding','saving','completed','failed') NOT NULL DEFAULT 'queued' AFTER `pages`,
  ADD COLUMN `processingProgress` INT NOT NULL DEFAULT 0 AFTER `processingStage`,
  ADD COLUMN `processingMessage` VARCHAR(512) NULL AFTER `processingProgress`;

