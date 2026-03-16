// CREATE TABLE `cancellation_reason_categories` (
//   `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
//   `name` VARCHAR(255) NOT NULL UNIQUE,
//   `description` VARCHAR(255) DEFAULT NULL,
//   `status` ENUM('active', 'inactive') DEFAULT 'active',
//   `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
//   `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
//   PRIMARY KEY (`id`)
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

// -- Step 1️⃣: Drop the old ENUM column (choose one approach above)
// -- Using simple drop:
// ALTER TABLE `user_subscription_details`
// DROP COLUMN `cancellation_reason_category`;

// -- Step 2️⃣: Add the new FK column
// ALTER TABLE `user_subscription_details`
// ADD COLUMN `cancellation_reason_category_id` INT UNSIGNED NULL
//     COMMENT 'User-selected cancellation reason (FK)' AFTER `cancelled_by_user_id`;

// -- Step 3️⃣: Add the foreign key constraint
// ALTER TABLE `user_subscription_details`
// ADD CONSTRAINT `fk_user_subscription_details_cancellation_reason_category`
//     FOREIGN KEY (`cancellation_reason_category_id`)
//     REFERENCES `cancellation_reason_categories` (`id`)
//     ON DELETE SET NULL
//     ON UPDATE CASCADE;