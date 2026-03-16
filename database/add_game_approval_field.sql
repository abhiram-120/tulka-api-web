-- Add is_game_approved field to classes table
-- This field tracks whether game approval has been completed for a class

ALTER TABLE `classes` 
ADD COLUMN `is_game_approved` TINYINT(1) NOT NULL DEFAULT 0 
COMMENT 'Whether the game approval has been completed for this class' 
AFTER `batch_id`;

-- Add index for better query performance when filtering by game approval status
CREATE INDEX `idx_is_game_approved` ON `classes` (`is_game_approved`);

-- Create table to store approved game approval data
CREATE TABLE IF NOT EXISTS `game_approvals` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `class_id` INT(11) NOT NULL COMMENT 'Reference to classes table',
  `teacher_id` VARCHAR(255) NOT NULL COMMENT 'Teacher who approved the game',
  `student_id` VARCHAR(255) NOT NULL COMMENT 'Student for whom the game was approved',
  `zoom_summary_id` INT(11) DEFAULT NULL COMMENT 'Reference to zoom summary if available',
  `lesson_number` INT(11) DEFAULT NULL COMMENT 'Lesson number',
  `fill_in_blank` JSON DEFAULT NULL COMMENT 'Approved fill-in-the-blank exercises with approval status',
  `flashcards` JSON DEFAULT NULL COMMENT 'Approved flashcards with approval status',
  `spelling` JSON DEFAULT NULL COMMENT 'Approved spelling exercises with approval status',
  `quality_score` INT(11) DEFAULT NULL COMMENT 'Quality score from the original data',
  `approved_count` INT(11) DEFAULT 0 COMMENT 'Total number of approved exercises',
  `rejected_count` INT(11) DEFAULT 0 COMMENT 'Total number of rejected exercises',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When the approval was created',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'When the approval was last updated',
  PRIMARY KEY (`id`),
  KEY `idx_class_id` (`class_id`),
  KEY `idx_teacher_id` (`teacher_id`),
  KEY `idx_student_id` (`student_id`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_game_approvals_class` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Stores approved game approval data for classes';

