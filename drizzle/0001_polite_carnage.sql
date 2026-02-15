CREATE TABLE `chat_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`sessionId` varchar(128),
	`query` longtext NOT NULL,
	`response` longtext NOT NULL,
	`source` enum('website','bitrix24','test') NOT NULL,
	`responseTime` int NOT NULL DEFAULT 0,
	`tokensUsed` int NOT NULL DEFAULT 0,
	`documentsUsed` int NOT NULL DEFAULT 0,
	`rating` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `document_chunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`documentId` int NOT NULL,
	`chunkIndex` int NOT NULL,
	`content` longtext NOT NULL,
	`embedding` longtext,
	`tokenCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `document_chunks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`filename` varchar(255) NOT NULL,
	`fileType` varchar(20) NOT NULL,
	`fileSize` int NOT NULL,
	`uploadedBy` int NOT NULL,
	`uploadedAt` timestamp NOT NULL DEFAULT (now()),
	`status` enum('processing','indexed','failed') NOT NULL DEFAULT 'processing',
	`errorMessage` text,
	`chunksCount` int NOT NULL DEFAULT 0,
	`s3Key` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `query_stats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` varchar(10) NOT NULL,
	`totalQueries` int NOT NULL DEFAULT 0,
	`avgResponseTime` decimal(10,2) NOT NULL DEFAULT '0',
	`websiteQueries` int NOT NULL DEFAULT 0,
	`bitrix24Queries` int NOT NULL DEFAULT 0,
	`avgTokensUsed` decimal(10,2) NOT NULL DEFAULT '0',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `query_stats_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `system_prompts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`prompt` longtext NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`isActive` boolean NOT NULL DEFAULT true,
	CONSTRAINT `system_prompts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `userId_idx` ON `chat_history` (`userId`);--> statement-breakpoint
CREATE INDEX `source_idx` ON `chat_history` (`source`);--> statement-breakpoint
CREATE INDEX `createdAt_idx` ON `chat_history` (`createdAt`);--> statement-breakpoint
CREATE INDEX `sessionId_idx` ON `chat_history` (`sessionId`);--> statement-breakpoint
CREATE INDEX `documentId_idx` ON `document_chunks` (`documentId`);--> statement-breakpoint
CREATE INDEX `uploadedBy_idx` ON `documents` (`uploadedBy`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `documents` (`status`);--> statement-breakpoint
CREATE INDEX `date_idx` ON `query_stats` (`date`);--> statement-breakpoint
CREATE INDEX `isActive_idx` ON `system_prompts` (`isActive`);