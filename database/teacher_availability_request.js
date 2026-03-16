// CREATE TABLE `teacher_availability_change_requests` (
//   `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
//   `user_id` BIGINT UNSIGNED NOT NULL,

//   `admin_approval` ENUM('pending','accepted','rejected') 
//         NOT NULL DEFAULT 'pending',

//   `added` JSON DEFAULT (JSON_ARRAY()),
//   `dropped` JSON DEFAULT (JSON_ARRAY()),

//   `changes_summary` JSON DEFAULT (JSON_OBJECT()),

//   `teacher_note` TEXT NULL,
//   `admin_feedback_note` TEXT NULL,

//   `effective_from` DATETIME NOT NULL,

//   `has_conflicts` TINYINT(1) NOT NULL DEFAULT 0,
//   `conflict_details` JSON DEFAULT (JSON_ARRAY()),

//   `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
//   `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

//   PRIMARY KEY (`id`),
//   INDEX (`user_id`)
// ) 
// ENGINE=InnoDB 
// DEFAULT CHARSET=utf8mb4 
// COLLATE=utf8mb4_bin;
