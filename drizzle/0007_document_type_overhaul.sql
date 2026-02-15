UPDATE `documents`
SET `docType` = CASE
  WHEN `docType` = 'manual' THEN 'instruction'
  WHEN `docType` IS NULL OR `docType` = '' OR `docType` = 'other' THEN 'general'
  ELSE `docType`
END;

ALTER TABLE `documents`
  MODIFY COLUMN `docType` ENUM('catalog','instruction','general') NOT NULL DEFAULT 'general';

