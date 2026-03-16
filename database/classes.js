ALTER TABLE `classes`
ADD COLUMN `recording_status` ENUM('pending','processing','completed','failed') 
    NOT NULL DEFAULT 'pending' 
    AFTER `batch_id`,
ADD COLUMN `recording_url` TEXT 
    NULL 
    AFTER `recording_status`;
