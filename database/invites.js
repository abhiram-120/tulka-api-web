-- Table 1: referral_links
CREATE TABLE `referral_links` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT UNSIGNED NOT NULL,
  `invite_code` VARCHAR(50) UNIQUE NOT NULL,
  `invite_url` VARCHAR(500) UNIQUE NOT NULL,
  `created_at` BIGINT NOT NULL,
  `last_refreshed_at` BIGINT NULL,
  `is_active` BOOLEAN DEFAULT TRUE,
  `refresh_count` INT UNSIGNED DEFAULT 0,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_invite_code` (`invite_code`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table 2: referral_tiers
CREATE TABLE `referral_tiers` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `tier_name` VARCHAR(100) NOT NULL,
  `tier_level` INT NOT NULL,
  `min_referrals` INT NOT NULL,
  `max_referrals` INT NOT NULL,
  `referee_reward_type` ENUM('free_lessons', 'free_months', 'discount', 'cash') NOT NULL,
  `referee_reward_value` INT NOT NULL,
  `referrer_reward_type` ENUM('free_lessons', 'free_months', 'discount', 'cash') NOT NULL,
  `referrer_reward_value` INT NOT NULL,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` BIGINT NOT NULL,
  `updated_at` BIGINT NULL,
  INDEX `idx_tier_level` (`tier_level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table 3: referrals
CREATE TABLE `referrals` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `referrer_id` INT UNSIGNED NOT NULL,
  `referee_id` INT UNSIGNED NOT NULL,
  `invite_code` VARCHAR(50) NOT NULL,
  `status` ENUM('pending', 'validated', 'rewarded', 'fraud') DEFAULT 'pending',
  `tier_at_signup` INT NULL,
  `subscription_value` DECIMAL(10, 2) DEFAULT 0.00,
  `first_payment_at` BIGINT NULL,
  `is_paying_user` BOOLEAN DEFAULT FALSE,
  `fraud_flags` JSON NULL,
  `created_at` BIGINT NOT NULL,
  `updated_at` BIGINT NULL,
  INDEX `idx_referrer_id` (`referrer_id`),
  INDEX `idx_referee_id` (`referee_id`),
  INDEX `idx_status` (`status`),
  FOREIGN KEY (`referrer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`referee_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`invite_code`) REFERENCES `referral_links`(`invite_code`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table 4: referral_rewards
CREATE TABLE `referral_rewards` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `referral_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `user_type` ENUM('referrer', 'referee') NOT NULL,
  `reward_type` ENUM('free_lessons', 'free_months', 'discount', 'cash') NOT NULL,
  `reward_value` INT NOT NULL,
  `tier_level` INT NOT NULL,
  `status` ENUM('pending', 'granted', 'expired') DEFAULT 'pending',
  `granted_at` BIGINT NULL,
  `expires_at` BIGINT NULL,
  `created_at` BIGINT NOT NULL,
  INDEX `idx_referral_id` (`referral_id`),
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_status` (`status`),
  FOREIGN KEY (`referral_id`) REFERENCES `referrals`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table 5: user_referral_settings
CREATE TABLE `user_referral_settings` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT UNSIGNED UNIQUE NOT NULL,
  `user_tag` ENUM('regular', 'partnership', 'custom') DEFAULT 'regular',
  `custom_rules` JSON NULL,
  `reward_multiplier` DECIMAL(5, 2) DEFAULT 1.00,
  `is_active` BOOLEAN DEFAULT TRUE,
  `notes` TEXT NULL,
  `created_at` BIGINT NOT NULL,
  `updated_at` BIGINT NULL,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_user_tag` (`user_tag`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table 6: referral_config
CREATE TABLE `referral_config` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `config_key` VARCHAR(100) UNIQUE NOT NULL,
  `config_value` JSON NOT NULL,
  `description` TEXT NULL,
  `updated_at` BIGINT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table 7: referral_notifications
CREATE TABLE `referral_notifications` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `referral_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `notification_type` ENUM('whatsapp', 'in_app', 'popup') NOT NULL,
  `notification_event` ENUM('friend_joined', 'reward_received', 'tier_upgraded') NOT NULL,
  `status` ENUM('pending', 'sent', 'failed') DEFAULT 'pending',
  `sent_at` BIGINT NULL,
  `created_at` BIGINT NOT NULL,
  INDEX `idx_referral_id` (`referral_id`),
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_status` (`status`),
  FOREIGN KEY (`referral_id`) REFERENCES `referrals`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table 8: referral_fraud_logs
CREATE TABLE `referral_fraud_logs` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `referee_id` INT UNSIGNED NOT NULL,
  `referrer_id` INT UNSIGNED NOT NULL,
  `fraud_type` ENUM('duplicate_email', 'duplicate_phone', 'duplicate_card', 'suspicious_pattern') NOT NULL,
  `fraud_score` INT DEFAULT 0,
  `details` JSON NULL,
  `is_blocked` BOOLEAN DEFAULT FALSE,
  `reviewed_by` INT UNSIGNED NULL,
  `reviewed_at` BIGINT NULL,
  `created_at` BIGINT NOT NULL,
  INDEX `idx_referee_id` (`referee_id`),
  INDEX `idx_fraud_type` (`fraud_type`),
  FOREIGN KEY (`referee_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`referrer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table 9: referral_retention_tracking
CREATE TABLE `referral_retention_tracking` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `referee_id` INT UNSIGNED NOT NULL,
  `referrer_id` INT UNSIGNED NOT NULL,
  `subscription_start_date` BIGINT NOT NULL,
  `subscription_end_date` BIGINT NULL,
  `total_months_active` INT DEFAULT 0,
  `total_revenue_generated` DECIMAL(10, 2) DEFAULT 0.00,
  `is_currently_active` BOOLEAN DEFAULT TRUE,
  `churn_date` BIGINT NULL,
  `updated_at` BIGINT NULL,
  INDEX `idx_referee_id` (`referee_id`),
  INDEX `idx_referrer_id` (`referrer_id`),
  FOREIGN KEY (`referee_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`referrer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert default tier configurations
INSERT INTO `referral_tiers` (`tier_name`, `tier_level`, `min_referrals`, `max_referrals`, `referee_reward_type`, `referee_reward_value`, `referrer_reward_type`, `referrer_reward_value`, `is_active`, `created_at`) VALUES
('Bronze', 1, 0, 5, 'free_lessons', 1, 'free_lessons', 1, TRUE, UNIX_TIMESTAMP()),
('Silver', 2, 6, 10, 'free_lessons', 2, 'free_lessons', 2, TRUE, UNIX_TIMESTAMP()),
('Gold', 3, 11, 15, 'free_months', 1, 'free_months', 1, TRUE, UNIX_TIMESTAMP()),
('Platinum', 4, 16, 25, 'free_months', 1, 'free_months', 2, TRUE, UNIX_TIMESTAMP()),
('Diamond', 5, 26, 999999, 'free_months', 2, 'free_months', 3, TRUE, UNIX_TIMESTAMP());

-- Insert default config
INSERT INTO `referral_config` (`config_key`, `config_value`, `description`, `updated_at`) VALUES
('link_refresh_cooldown_hours', '24', 'Hours to wait before allowing link refresh', UNIX_TIMESTAMP()),
('fraud_detection_enabled', 'true', 'Enable fraud detection', UNIX_TIMESTAMP()),
('auto_reward_on_payment', 'true', 'Automatically grant rewards after first payment', UNIX_TIMESTAMP());


-- New Table: referral_tier_claims
-- Table 10: referral_tier_claims
-- Create referral_tier_claims table
CREATE TABLE IF NOT EXISTS `referral_tier_claims` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `tier_level` INT NOT NULL,
  `tier_name` VARCHAR(50) NOT NULL,
  `reward_type` ENUM('free_lessons', 'free_months', 'discount', 'cash', 'cash_and_subscription') NOT NULL,
  `reward_value` JSON NOT NULL COMMENT 'Stores reward details like {"count": 1} or {"amount": 200, "duration": "3_months"}',
  `claim_receipt_id` VARCHAR(50) NOT NULL UNIQUE,
  `notes` TEXT NULL,
  `claimed_at` BIGINT NOT NULL,
  `created_at` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_tier_unique` (`user_id`, `tier_level`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_claimed_at` (`claimed_at`),
  KEY `idx_receipt_id` (`claim_receipt_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Alter users table to add invite tracking columns
ALTER TABLE `users` 
ADD COLUMN `invite_code` VARCHAR(50) NULL DEFAULT NULL COMMENT 'Invite code used during registration',
ADD COLUMN `invite_by` INT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who referred this user',
ADD COLUMN `attribution` JSON NULL DEFAULT NULL COMMENT 'UTM and marketing attribution data';

CREATE TABLE free_classes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,                 -- The user who earns the free class
    referred_user_id INT,                 -- The person who referred or was referred
    count_free_class INT DEFAULT 0,       -- Number of free classes earned
    created_at INT DEFAULT (UNIX_TIMESTAMP()),
    updated_at INT DEFAULT (UNIX_TIMESTAMP())
);


ALTER TABLE referral_fraud_logs 
ADD COLUMN referral_id INT UNSIGNED NULL;
