// CREATE TABLE `cancel_reasons` (
//   `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
//   `user_id` int(10) unsigned NOT NULL,
//   `cancellation_type` varchar(100) NOT NULL,
//   `reason` varchar(255) NOT NULL,
//   `note` text DEFAULT NULL,
//   `created_at` datetime DEFAULT current_timestamp(),
//   `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
//   PRIMARY KEY (`id`)
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


// CREATE TABLE `risk_rules` (
//   `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
//   `event_type` varchar(255) NOT NULL,
//   `display_name` varchar(255) NOT NULL,
//   `default_points` int(11) NOT NULL,
//   `default_valid_days` int(11) NOT NULL,
//   `description` text DEFAULT NULL,
//   `impact_level` enum('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'low',
//   `conditions` longtext DEFAULT NULL,
//   `is_auto` tinyint(1) NOT NULL DEFAULT 1,
//   `is_active` tinyint(1) NOT NULL DEFAULT 0,
//   `created_at` datetime DEFAULT current_timestamp(),
//   `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
//   PRIMARY KEY (`id`),
//   KEY `idx_event_type` (`event_type`),
//   KEY `idx_is_active` (`is_active`)
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

// CREATE TABLE `daily_risk_calc_logs` (
//   `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
//   `run_date` date NOT NULL,
//   `start_time` datetime NOT NULL DEFAULT current_timestamp(),
//   `end_time` datetime DEFAULT NULL,
//   `total_students` int(11) NOT NULL DEFAULT 0,
//   `affected_students` int(11) NOT NULL DEFAULT 0,
//   `created_events` int(11) NOT NULL DEFAULT 0,
//   `job_status` enum('completed','failed') NOT NULL DEFAULT 'completed',
//   `notes` text DEFAULT NULL,
//   `created_at` datetime DEFAULT current_timestamp(),
//   PRIMARY KEY (`id`)
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


// CREATE TABLE `manual_event_logs` (
//   `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
//   `event_id` int(10) unsigned NOT NULL,
//   `student_id` int(10) unsigned NOT NULL,
//   `event_type` varchar(255) NOT NULL,
//   `created_by` int(10) unsigned NOT NULL,
//   `action` enum('create','update','delete') NOT NULL DEFAULT 'create',
//   `old_data` json DEFAULT NULL,
//   `new_data` json DEFAULT NULL,
//   `created_at` datetime DEFAULT current_timestamp(),
//   PRIMARY KEY (`id`)
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

// CREATE TABLE `risk_rules_audit` (
//   `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
//   `risk_rule_id` int(10) unsigned NOT NULL,
//   `action` enum('CREATE','UPDATE','DELETE') NOT NULL,
//   `changed_by` int(10) unsigned DEFAULT NULL,
//   `previous_data` json DEFAULT NULL,
//   `new_data` json DEFAULT NULL,
//   `created_at` datetime DEFAULT current_timestamp(),
//   PRIMARY KEY (`id`),
//   KEY `idx_risk_rule_id` (`risk_rule_id`),
//   CONSTRAINT `fk_risk_rules_audit_risk_rule_id`
//     FOREIGN KEY (`risk_rule_id`)
//     REFERENCES `risk_rules` (`id`)
//     ON DELETE CASCADE
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

// CREATE TABLE `risk_table` (
//   `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
//   `student_id` int(10) unsigned NOT NULL,
//   `teacher_id` int(10) unsigned DEFAULT NULL,
//   `rep_id` int(10) unsigned DEFAULT NULL,
//   `risk_level` enum('dark_red','red','orange','green') NOT NULL DEFAULT 'green',
//   `risk_score` int(11) NOT NULL DEFAULT 0,
//   `recurring_risk` varchar(50) DEFAULT NULL,
//   `contact_status` enum('not_contacted','whatsapp','called','no_answer','follow_up','resolved') DEFAULT 'not_contacted',
//   `payment_method` enum('credit','bit','bank','standing_order') DEFAULT NULL,
//   `total_paid` decimal(10,2) DEFAULT 0.00,
//   `risk_events` json NOT NULL DEFAULT (json_array()),
//   `added_date` datetime DEFAULT current_timestamp(),
//   `family_linked` tinyint(1) NOT NULL DEFAULT 0,
//   `next_class_date` datetime DEFAULT NULL,
//   `created_at` datetime DEFAULT current_timestamp(),
//   `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
//   PRIMARY KEY (`id`),
//   KEY `idx_student_id` (`student_id`),
//   KEY `idx_risk_level` (`risk_level`),
//   KEY `idx_is_active_risk` (`risk_score`)
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

// CREATE TABLE `risk_audit_logs` (
//   `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
//   `risk_id` int(10) unsigned DEFAULT NULL,
//   `action` varchar(50) NOT NULL,
//   `changed_by` int(10) unsigned DEFAULT NULL,
//   `previous_data` json DEFAULT NULL,
//   `new_data` json DEFAULT NULL,
//   `created_at` datetime DEFAULT current_timestamp(),
//   PRIMARY KEY (`id`),
//   KEY `idx_risk_id` (`risk_id`),
//   CONSTRAINT `fk_risk_audit_logs_risk_id`
//     FOREIGN KEY (`risk_id`)
//     REFERENCES `risk_table` (`id`)
//     ON DELETE SET NULL
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

// CREATE TABLE `risk_thresholds` (
//   `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
//   `critical` float NOT NULL DEFAULT 100,
//   `high` float NOT NULL DEFAULT 70,
//   `medium` float NOT NULL DEFAULT 40,
//   `low` float NOT NULL DEFAULT 20,
//   `created_at` datetime DEFAULT current_timestamp(),
//   `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
//   PRIMARY KEY (`id`)
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


// CREATE TABLE `saved_views` (
//   `id` int(11) NOT NULL AUTO_INCREMENT,
//   `user_id` int(10) unsigned NOT NULL,
//   `name` varchar(100) NOT NULL,
//   `config` json NOT NULL,
//   `is_default` tinyint(1) NOT NULL DEFAULT 0,
//   `created_at` datetime DEFAULT current_timestamp(),
//   `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
//   PRIMARY KEY (`id`),
//   KEY `idx_user_id` (`user_id`),
//   CONSTRAINT `fk_saved_views_user_id`
//     FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
//     ON DELETE CASCADE
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

// CREATE TABLE `student_communication_logs` (
//   `id` int(11) NOT NULL AUTO_INCREMENT,
//   `student_id` int(11) NOT NULL,
//   `risk_level` varchar(50) NOT NULL,
//   `message_type` enum('whatsapp','task','call','review') DEFAULT NULL,
//   `status` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
//   `triggered_by` varchar(100) NOT NULL DEFAULT 'system',
//   `notes` text DEFAULT NULL,
//   `created_at` datetime DEFAULT current_timestamp(),
//   PRIMARY KEY (`id`),
//   KEY `idx_student_id` (`student_id`),
//   CONSTRAINT `fk_communication_logs_student_id`
//     FOREIGN KEY (`student_id`) REFERENCES `students` (`id`)
//     ON DELETE CASCADE
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

// CREATE TABLE `student_labels` (
//   `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
//   `user_id` int(10) unsigned NOT NULL,
//   `label_key` varchar(255) NOT NULL,
//   `label_value` varchar(255) NOT NULL,
//   `valid_until` datetime NOT NULL,
//   `created_at` datetime DEFAULT current_timestamp(),
//   `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
//   PRIMARY KEY (`id`),
//   KEY `idx_user_id` (`user_id`),
//   KEY `idx_label_key` (`label_key`),
//   CONSTRAINT `fk_student_labels_user_id`
//     FOREIGN KEY (`user_id`)
//     REFERENCES `users` (`id`)
//     ON DELETE CASCADE
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

// CREATE TABLE `student_risk_history` (
//   `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
//   `user_id` int(10) unsigned NOT NULL,
//   `risk_level` varchar(50) NOT NULL,
//   `total_points` int(11) NOT NULL,
//   `snapshot_json` json NOT NULL,
//   `created_at` datetime DEFAULT current_timestamp(),
//   `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
//   PRIMARY KEY (`id`),
//   KEY `idx_user_id` (`user_id`),
//   KEY `idx_risk_level` (`risk_level`),
//   CONSTRAINT `fk_student_risk_history_user_id`
//     FOREIGN KEY (`user_id`)
//     REFERENCES `users` (`id`)
//     ON DELETE CASCADE
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

// INSERT INTO `risk_rules` (`id`, `event_type`, `display_name`, `default_points`, `default_valid_days`, `description`, `impact_level`, `conditions`, `is_auto`, `is_active`, `created_at`, `updated_at`) VALUES
// (1, 'Payment', 'Payment Failed', 10, 30, 'If a user got failed payment for 3 consecutive charges .', 'low', '[{\"metric\":\"payment_failed\",\"operator\":\">=\",\"value\":\"3\",\"window\":\"\"}]', 1, 1, '2025-10-29 06:17:18', '2025-10-29 13:44:09'),
// (2, 'Attendance', 'Missed Class', 5, 30, 'If a student missed a class', 'low', '[{\"metric\":\"missed_class\",\"operator\":\"==\",\"value\":\"1\",\"window\":\"\"}]', 1, 1, '2025-10-29 08:24:03', '2025-10-29 08:24:03'),
// (3, 'Attendance', '2 Consecutive Missed Class', 10, 30, 'If the Student Miss 2 Consecutive Class', 'low', '[{\"metric\":\"consecutive_missed_class\",\"operator\":\"==\",\"value\":\"2\",\"window\":\"\"}]', 1, 1, '2025-10-29 08:48:30', '2025-10-29 08:48:30'),
// (4, 'Attendance', '3 Consecutive Missed Classes', 20, 30, 'If a Student Missed 3 consecutive classes\n', 'low', '[{\"metric\":\"consecutive_missed_class\",\"operator\":\"==\",\"value\":\"3\",\"window\":\"\"}]', 1, 1, '2025-10-29 09:03:13', '2025-10-29 09:03:13'),
// (5, 'Attendance', 'Unused Lesson', 10, 30, 'If a Student has 16 unused lessons', 'low', '[{\"metric\":\"unused_lesson\",\"operator\":\">=\",\"value\":\"16\",\"window\":\"\"}]', 1, 1, '2025-10-29 09:31:37', '2025-10-29 09:31:37'),
// (6, 'Attendance', 'regular scheduled lessons', 60, 30, 'If a Student has no class in the present month', 'high', '[{\"metric\":\"regular_scheduled_lessons\",\"operator\":\"==\",\"value\":\"0\",\"window\":\"\"}]', 1, 1, '2025-10-29 10:49:23', '2025-10-29 10:49:23'),
// (7, 'Payment', 'Payment Method ', 20, 30, 'If any student has a bank transfer or one time payment', 'low', '[{\"metric\":\"payment_method_bank_transfer_one_time_payment\",\"operator\":\">=\",\"value\":\"1\",\"window\":\"\"}]', 1, 1, '2025-10-29 10:58:20', '2025-10-29 10:58:20'),
// (8, 'Engagement', 'Low Engagement ', 10, 30, 'Engagement is Low', 'low', '[{\"metric\":\"Engagement\",\"operator\":\"==\",\"value\":\"10\",\"window\":\"\"}]', 1, 1, '2025-10-29 15:04:16', '2025-10-29 15:04:16');

// CREATE TABLE `student_events` (
//   `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
//   `user_id` INT UNSIGNED NOT NULL,
//   `event_type` VARCHAR(255) NOT NULL,
//   `description` VARCHAR(255) NOT NULL,
//   `points` INT NOT NULL,
//   `valid_until` INT NOT NULL,
//   `reported_by` VARCHAR(255) NOT NULL,
//   `event_source` VARCHAR(255) NOT NULL DEFAULT 'auto',
//   `created_at` DATETIME NOT NULL,
//   `updated_at` DATETIME NOT NULL,
  
//   PRIMARY KEY (`id`),

//   CONSTRAINT `fk_student_events_user`
//     FOREIGN KEY (`user_id`)
//     REFERENCES `User` (`id`)
//     ON DELETE CASCADE
//     ON UPDATE CASCADE
// );

// ALTER TABLE risk_table
// ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
// ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

// ALTER TABLE risk_table 
// MODIFY COLUMN risk_level ENUM('critical', 'high', 'medium', 'low') NOT NULL DEFAULT 'low';

// ALTER TABLE risk_table 
// MODIFY COLUMN payment_method 
// ENUM('credit', 'bit', 'bank', 'standing_order', 'unknown') 
// NULL;

// ALTER TABLE risk_table MODIFY payment_method VARCHAR(50);

// ALTER TABLE risk_table 
// MODIFY COLUMN student_id INT NULL;

// ALTER TABLE risk_table 
// MODIFY COLUMN payment_method VARCHAR(50) NULL DEFAULT 'unknown';

// ALTER TABLE risk_table
// MODIFY COLUMN student_id INT NOT NULL;

// ALTER TABLE risk_table
// ADD UNIQUE KEY unique_student (student_id);

// Added on 30th dec

// ALTER TABLE risk_table
// ADD UNIQUE KEY unique_student_risk (student_id);

// ALTER TABLE risk_table
// ADD COLUMN recurring_lessons BOOLEAN DEFAULT FALSE AFTER total_paid,
// ADD COLUMN subscription_type VARCHAR(50) NULL AFTER recurring_lessons,
// ADD COLUMN learning_duration INT NULL AFTER subscription_type;

// ALTER TABLE risk_table
// MODIFY COLUMN risk_level VARCHAR(50) NOT NULL DEFAULT 'low';

// ALTER TABLE risk_table
// MODIFY COLUMN payment_method VARCHAR(50) DEFAULT 'unknown';
