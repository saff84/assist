--> statement-breakpoint
-- Expand enum to include editor while keeping existing admin/user values
ALTER TABLE `users` MODIFY COLUMN `role` ENUM('user','admin','editor') NOT NULL DEFAULT 'user';
--> statement-breakpoint
-- Demote legacy "user" to editor; never touch admin rows
UPDATE `users` SET `role` = 'editor' WHERE `role` = 'user';
--> statement-breakpoint
-- Finalize enum: only admin | editor (existing admin rows stay admin)
ALTER TABLE `users` MODIFY COLUMN `role` ENUM('admin','editor') NOT NULL DEFAULT 'editor';
