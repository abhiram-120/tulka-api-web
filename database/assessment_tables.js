// ASSESSMENT QUESTIONS TABLE
CREATE TABLE `assessment_questions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `question` TEXT NOT NULL,
  `question_type` VARCHAR(50) DEFAULT NULL,
  `difficulty_level` VARCHAR(20) DEFAULT NULL,
  `skill_focus` VARCHAR(50) DEFAULT NULL,
  `options` JSON NOT NULL,
  `correct_answer` JSON NOT NULL,
  `image_url` VARCHAR(255) DEFAULT NULL,
  `audio_url` VARCHAR(255) DEFAULT NULL,
  `explanation` TEXT DEFAULT NULL,
  `disabled` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

// ASSESSMENT SESSIONS TABLE
CREATE TABLE `assessment_sessions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `status` ENUM('started','submitted') NOT NULL DEFAULT 'started',
  `question_ids` JSON NOT NULL,
  `answers` JSON DEFAULT NULL,
  `total_questions` INT NOT NULL DEFAULT 0,
  `correct_count` INT DEFAULT NULL,
  `score_percent` DECIMAL(5,2) DEFAULT NULL,
  `started_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `submitted_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_assessment_sessions_user_id` (`user_id`),
  CONSTRAINT `fk_assessment_sessions_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


ALTER TABLE assessment_questions
  ADD COLUMN disabled TINYINT(1) NOT NULL DEFAULT 0;
