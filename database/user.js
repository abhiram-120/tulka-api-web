ALTER TABLE `users` 
ADD COLUMN `gender` VARCHAR(20) NULL DEFAULT NULL 
COMMENT 'Gender of the user (for kid accounts)' 
AFTER `date_of_birth`;

ALTER TABLE `users`
ADD COLUMN `native_language` VARCHAR(255) NULL DEFAULT NULL
COMMENT 'Native language of the user'
AFTER `language`;

