CREATE TABLE IF NOT EXISTS `widget_sites` (
  `id` int AUTO_INCREMENT NOT NULL,
  `origin` varchar(512) NOT NULL,
  `requestCount` int NOT NULL DEFAULT 0,
  `chatCount` int NOT NULL DEFAULT 0,
  `firstSeenAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastSeenAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `widget_sites_id` PRIMARY KEY(`id`),
  CONSTRAINT `widget_sites_origin_unique` UNIQUE(`origin`)
);
