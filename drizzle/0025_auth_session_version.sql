ALTER TABLE `users` ADD COLUMN `sessionVersion` int NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `users` SET `mustChangePassword` = TRUE WHERE `passwordHash` = SHA2('admin123', 256);
