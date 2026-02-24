CREATE TABLE IF NOT EXISTS `llm_settings` (
  `id` int AUTO_INCREMENT NOT NULL PRIMARY KEY,
  `provider` enum('local','external') NOT NULL DEFAULT 'local',
  `externalApiUrl` varchar(512) DEFAULT 'https://openrouter.ai/api/v1',
  `externalApiKey` text,
  `externalModel` varchar(128) DEFAULT 'anthropic/claude-sonnet-4',
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
