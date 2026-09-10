-- Expand enum to include editor while keeping existing admin/user values
ALTER TABLE `users` MODIFY COLUMN `role` ENUM('user','admin','editor') NOT NULL DEFAULT 'user';
--> statement-breakpoint
UPDATE `users` SET `role` = 'editor' WHERE `role` = 'user';
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` ENUM('admin','editor') NOT NULL DEFAULT 'editor';
