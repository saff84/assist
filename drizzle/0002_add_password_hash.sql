-- Add passwordHash column to users table
ALTER TABLE `users` ADD COLUMN `passwordHash` VARCHAR(255);

-- Make email unique if it isn't already
ALTER TABLE `users` MODIFY COLUMN `email` VARCHAR(320) UNIQUE;

