-- Family Module Database Tables
-- Run these queries in order to create the required tables

-- 1. Families table (main parent/family information)
CREATE TABLE `families` (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `parent_name` varchar(255) NOT NULL COMMENT 'Full name of the parent/guardian',
  `parent_email` varchar(255) NOT NULL COMMENT 'Parent email address',
  `parent_phone` varchar(32) DEFAULT NULL COMMENT 'Parent phone number',
  `parent_country_code` varchar(10) DEFAULT NULL COMMENT 'Country code for phone',
  `parent_address` text DEFAULT NULL COMMENT 'Family address',
  `family_notes` text DEFAULT NULL COMMENT 'Additional notes about the family',
  `total_monthly_amount` decimal(10,2) DEFAULT 0.00 COMMENT 'Total monthly subscription amount',
  `status` enum('active','pending','suspended','cancelled') DEFAULT 'pending' COMMENT 'Family account status',
  `created_by` int(11) UNSIGNED DEFAULT NULL COMMENT 'Sales person who created this family',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_parent_email` (`parent_email`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `families_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Main family/parent account information';

-- 2. Family Children table (individual children under each family)
CREATE TABLE `family_children` (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `family_id` int(11) UNSIGNED NOT NULL COMMENT 'Reference to families table',
  `child_name` varchar(255) NOT NULL COMMENT 'Child full name',
  `child_age` int(3) NOT NULL COMMENT 'Child age',
  `subscription_type` enum('monthly','quarterly','yearly') NOT NULL COMMENT 'Subscription billing type',
  `monthly_amount` decimal(8,2) NOT NULL COMMENT 'Monthly subscription amount for this child',
  `custom_amount` decimal(8,2) DEFAULT NULL COMMENT 'Custom amount if different from standard pricing',
  `status` enum('active','paused','cancelled','pending') DEFAULT 'pending' COMMENT 'Child subscription status',
  `payplus_subscription_id` varchar(255) DEFAULT NULL COMMENT 'PayPlus subscription ID for this child',
  `subscription_start_date` date DEFAULT NULL COMMENT 'When subscription started',
  `next_payment_date` date DEFAULT NULL COMMENT 'Next payment due date',
  `last_payment_date` date DEFAULT NULL COMMENT 'Last successful payment date',
  `child_notes` text DEFAULT NULL COMMENT 'Notes specific to this child',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_family_id` (`family_id`),
  KEY `idx_status` (`status`),
  KEY `idx_subscription_type` (`subscription_type`),
  KEY `idx_payplus_subscription_id` (`payplus_subscription_id`),
  CONSTRAINT `family_children_family_id_foreign` FOREIGN KEY (`family_id`) REFERENCES `families` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Individual children under family accounts';

-- 3. Family Cart Items table (cart system for child selection)
CREATE TABLE `family_cart_items` (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `sales_user_id` int(11) UNSIGNED NOT NULL COMMENT 'Sales person who added to cart',
  `family_id` int(11) UNSIGNED NOT NULL COMMENT 'Reference to families table',
  `child_id` int(11) UNSIGNED NOT NULL COMMENT 'Reference to family_children table',
  `selected` boolean DEFAULT TRUE COMMENT 'Whether this child is selected in cart',
  `added_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_cart_child` (`sales_user_id`, `child_id`),
  KEY `idx_sales_user_id` (`sales_user_id`),
  KEY `idx_family_id` (`family_id`),
  KEY `idx_child_id` (`child_id`),
  KEY `idx_selected` (`selected`),
  CONSTRAINT `family_cart_items_sales_user_id_foreign` FOREIGN KEY (`sales_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `family_cart_items_family_id_foreign` FOREIGN KEY (`family_id`) REFERENCES `families` (`id`) ON DELETE CASCADE,
  CONSTRAINT `family_cart_items_child_id_foreign` FOREIGN KEY (`child_id`) REFERENCES `family_children` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Cart system for selecting individual children for payment';

-- 4. Family Payment Links table (PayPlus payment links for families)
CREATE TABLE `family_payment_links` (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `link_token` varchar(64) NOT NULL COMMENT 'Unique token for this payment link',
  `sales_user_id` int(11) UNSIGNED NOT NULL COMMENT 'Sales person who generated the link',
  `selected_children_ids` json NOT NULL COMMENT 'Array of selected child IDs for this payment',
  `total_amount` decimal(10,2) NOT NULL COMMENT 'Total payment amount',
  `currency` varchar(3) DEFAULT 'USD' COMMENT 'Payment currency',
  `payment_type` enum('one_time','recurring') NOT NULL COMMENT 'Type of payment',
  `description` varchar(500) NOT NULL COMMENT 'Payment description',
  `custom_note` text DEFAULT NULL COMMENT 'Custom note for the payment',
  `payplus_payment_url` text DEFAULT NULL COMMENT 'PayPlus payment URL',
  `payplus_page_request_uid` varchar(255) DEFAULT NULL COMMENT 'PayPlus page request UID',
  `payplus_qr_code` text DEFAULT NULL COMMENT 'PayPlus QR code image URL',
  `status` enum('active','used','expired','cancelled') DEFAULT 'active' COMMENT 'Payment link status',
  `expires_at` timestamp NULL DEFAULT NULL COMMENT 'When the payment link expires',
  `used_at` timestamp NULL DEFAULT NULL COMMENT 'When the payment link was used',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_link_token` (`link_token`),
  KEY `idx_sales_user_id` (`sales_user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_payment_type` (`payment_type`),
  KEY `idx_expires_at` (`expires_at`),
  KEY `idx_payplus_page_request_uid` (`payplus_page_request_uid`),
  CONSTRAINT `family_payment_links_sales_user_id_foreign` FOREIGN KEY (`sales_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='PayPlus payment links for family subscriptions';

-- 5. Family Payment Transactions table (completed payments)
CREATE TABLE `family_payment_transactions` (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `payment_link_id` int(11) UNSIGNED DEFAULT NULL COMMENT 'Reference to family_payment_links',
  `transaction_token` varchar(255) NOT NULL COMMENT 'Unique transaction token',
  `payplus_transaction_id` varchar(255) NOT NULL COMMENT 'PayPlus transaction ID',
  `family_id` int(11) UNSIGNED NOT NULL COMMENT 'Reference to families table',
  `paid_children_ids` json NOT NULL COMMENT 'Array of child IDs that were paid for',
  `amount` decimal(10,2) NOT NULL COMMENT 'Payment amount',
  `currency` varchar(3) DEFAULT 'USD' COMMENT 'Payment currency',
  `payment_type` enum('one_time','recurring') NOT NULL COMMENT 'Type of payment',
  `status` enum('success','failed','pending','refunded') DEFAULT 'pending' COMMENT 'Transaction status',
  `payment_method` varchar(50) DEFAULT NULL COMMENT 'Payment method used',
  `card_last_digits` varchar(4) DEFAULT NULL COMMENT 'Last 4 digits of card',
  `payplus_response_data` json DEFAULT NULL COMMENT 'Full PayPlus response data',
  `error_code` varchar(50) DEFAULT NULL COMMENT 'Error code if failed',
  `error_message` varchar(255) DEFAULT NULL COMMENT 'Error message if failed',
  `processed_at` timestamp NULL DEFAULT NULL COMMENT 'When payment was processed',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_transaction_token` (`transaction_token`),
  KEY `idx_payment_link_id` (`payment_link_id`),
  KEY `idx_payplus_transaction_id` (`payplus_transaction_id`),
  KEY `idx_family_id` (`family_id`),
  KEY `idx_status` (`status`),
  KEY `idx_payment_type` (`payment_type`),
  KEY `idx_processed_at` (`processed_at`),
  CONSTRAINT `family_payment_transactions_payment_link_id_foreign` FOREIGN KEY (`payment_link_id`) REFERENCES `family_payment_links` (`id`) ON DELETE SET NULL,
  CONSTRAINT `family_payment_transactions_family_id_foreign` FOREIGN KEY (`family_id`) REFERENCES `families` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Completed payment transactions for families';

-- 6. Family Activity Log table (audit trail)
CREATE TABLE `family_activity_log` (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `family_id` int(11) UNSIGNED DEFAULT NULL COMMENT 'Reference to families table',
  `child_id` int(11) UNSIGNED DEFAULT NULL COMMENT 'Reference to family_children table if child-specific',
  `user_id` int(11) UNSIGNED NOT NULL COMMENT 'User who performed the action',
  `action_type` enum('family_created','child_added','child_removed','child_status_changed','payment_generated','payment_completed','subscription_modified','cart_updated') NOT NULL COMMENT 'Type of action performed',
  `action_description` varchar(500) NOT NULL COMMENT 'Human-readable description of the action',
  `old_values` json DEFAULT NULL COMMENT 'Previous values before change',
  `new_values` json DEFAULT NULL COMMENT 'New values after change',
  `metadata` json DEFAULT NULL COMMENT 'Additional metadata about the action',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_family_id` (`family_id`),
  KEY `idx_child_id` (`child_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_action_type` (`action_type`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `family_activity_log_family_id_foreign` FOREIGN KEY (`family_id`) REFERENCES `families` (`id`) ON DELETE CASCADE,
  CONSTRAINT `family_activity_log_child_id_foreign` FOREIGN KEY (`child_id`) REFERENCES `family_children` (`id`) ON DELETE CASCADE,
  CONSTRAINT `family_activity_log_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Activity log for family account changes';

-- Add indexes for better performance
ALTER TABLE `families` ADD INDEX `idx_parent_name` (`parent_name`);
ALTER TABLE `family_children` ADD INDEX `idx_child_name` (`child_name`);
ALTER TABLE `family_children` ADD INDEX `idx_next_payment_date` (`next_payment_date`);
ALTER TABLE `family_payment_links` ADD INDEX `idx_created_at` (`created_at`);
ALTER TABLE `family_payment_transactions` ADD INDEX `idx_created_at` (`created_at`);

-- Insert default subscription pricing (optional - adjust amounts as needed)
-- This assumes you want standard pricing for different subscription types
INSERT INTO `families` (`id`, `parent_name`, `parent_email`, `status`, `created_by`) VALUES 
(1, 'Demo Family', 'demo@example.com', 'active', 1) 
ON DUPLICATE KEY UPDATE `id` = `id`;



-- Database Migration Script for Family Module Updates
-- Run these queries to update existing tables for the new requirements

-- 1. Add relationship_to_parent column to family_children table
ALTER TABLE `family_children` 
ADD COLUMN `relationship_to_parent` ENUM('son','daughter','stepson','stepdaughter','nephew','niece','grandson','granddaughter','other') NOT NULL DEFAULT 'son' 
COMMENT 'Relationship to parent/guardian' 
AFTER `child_age`;

-- 2. Make subscription_type nullable (since it will be set during payment generation)
ALTER TABLE `family_children` 
MODIFY COLUMN `subscription_type` ENUM('monthly','quarterly','yearly') NULL 
COMMENT 'Subscription billing type - set during payment generation';

-- 3. Make monthly_amount nullable (since it will be calculated during payment generation)
ALTER TABLE `family_children` 
MODIFY COLUMN `monthly_amount` DECIMAL(8,2) NULL 
COMMENT 'Monthly subscription amount for this child - set during payment';

-- 4. Remove total_monthly_amount from families table (will be calculated dynamically)
ALTER TABLE `families` 
DROP COLUMN `total_monthly_amount`;

-- 5. Add cart subscription fields to family_cart_items table
ALTER TABLE `family_cart_items` 
ADD COLUMN `cart_subscription_type` ENUM('monthly','quarterly','yearly') NULL 
COMMENT 'Subscription type selected in cart for payment generation' 
AFTER `selected`;

ALTER TABLE `family_cart_items` 
ADD COLUMN `cart_custom_amount` DECIMAL(8,2) NULL 
COMMENT 'Custom amount set in cart for this child' 
AFTER `cart_subscription_type`;

-- 6. Update family_payment_links table to store detailed children information
ALTER TABLE `family_payment_links` 
MODIFY COLUMN `selected_children_ids` JSON NULL 
COMMENT 'Legacy field - replaced by selected_children_details';

ALTER TABLE `family_payment_links` 
ADD COLUMN `selected_children_details` JSON NOT NULL 
COMMENT 'Array of selected children with their subscription details for payment' 
AFTER `selected_children_ids`;

-- 7. Add index for new relationship field
ALTER TABLE `family_children` 
ADD INDEX `idx_relationship` (`relationship_to_parent`);

-- 8. Add index for cart subscription type
ALTER TABLE `family_cart_items` 
ADD INDEX `idx_cart_subscription_type` (`cart_subscription_type`);

-- 9. Update family_activity_log enum to include new action types
ALTER TABLE `family_activity_log` 
MODIFY COLUMN `action_type` ENUM(
    'family_created',
    'child_added',
    'child_removed',
    'child_status_changed',
    'child_subscription_updated',
    'payment_generated',
    'payment_completed',
    'subscription_modified',
    'cart_updated',
    'cart_subscription_configured'
) NOT NULL COMMENT 'Type of action performed';

-- 10. Create a new table for subscription modification history (for tracking changes when parents modify subscriptions)
CREATE TABLE `family_subscription_modifications` (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `family_id` int(11) UNSIGNED NOT NULL COMMENT 'Reference to families table',
  `child_id` int(11) UNSIGNED NOT NULL COMMENT 'Reference to family_children table',
  `old_subscription_type` enum('monthly','quarterly','yearly') DEFAULT NULL COMMENT 'Previous subscription type',
  `new_subscription_type` enum('monthly','quarterly','yearly') DEFAULT NULL COMMENT 'New subscription type',
  `old_amount` decimal(8,2) DEFAULT NULL COMMENT 'Previous amount',
  `new_amount` decimal(8,2) DEFAULT NULL COMMENT 'New amount',
  `modification_reason` enum('parent_request','payment_failure','upgrade','downgrade','custom_pricing','other') NOT NULL COMMENT 'Reason for modification',
  `requested_by_user_id` int(11) UNSIGNED DEFAULT NULL COMMENT 'User who requested the change',
  `processed_by_user_id` int(11) UNSIGNED DEFAULT NULL COMMENT 'User who processed the change',
  `effective_date` date NOT NULL COMMENT 'When the change takes effect',
  `notes` text DEFAULT NULL COMMENT 'Additional notes about the modification',
  `payplus_modification_id` varchar(255) DEFAULT NULL COMMENT 'PayPlus modification reference',
  `status` enum('pending','approved','rejected','completed','failed') DEFAULT 'pending' COMMENT 'Modification status',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_family_id` (`family_id`),
  KEY `idx_child_id` (`child_id`),
  KEY `idx_effective_date` (`effective_date`),
  KEY `idx_status` (`status`),
  KEY `idx_modification_reason` (`modification_reason`),
  CONSTRAINT `family_subscription_modifications_family_id_foreign` FOREIGN KEY (`family_id`) REFERENCES `families` (`id`) ON DELETE CASCADE,
  CONSTRAINT `family_subscription_modifications_child_id_foreign` FOREIGN KEY (`child_id`) REFERENCES `family_children` (`id`) ON DELETE CASCADE,
  CONSTRAINT `family_subscription_modifications_requested_by_foreign` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `family_subscription_modifications_processed_by_foreign` FOREIGN KEY (`processed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Track subscription modifications for individual children';

-- 11. Sample data update (optional - for existing test data)
-- Update any existing children to have a default relationship
UPDATE `family_children` 
SET `relationship_to_parent` = CASE 
    WHEN `child_name` LIKE '%son%' OR `child_name` LIKE '%boy%' THEN 'son'
    WHEN `child_name` LIKE '%daughter%' OR `child_name` LIKE '%girl%' THEN 'daughter'
    ELSE 'son' -- Default fallback
END 
WHERE `relationship_to_parent` IS NULL OR `relationship_to_parent` = '';

-- 12. Create view for easy querying of family totals (since we removed the stored total)
CREATE VIEW `family_totals_view` AS
SELECT 
    f.id as family_id,
    f.parent_name,
    f.parent_email,
    f.status as family_status,
    COUNT(fc.id) as total_children,
    COUNT(CASE WHEN fc.status = 'active' THEN 1 END) as active_children,
    COALESCE(SUM(CASE WHEN fc.status = 'active' AND fc.monthly_amount IS NOT NULL THEN fc.monthly_amount ELSE 0 END), 0) as total_monthly_amount,
    COALESCE(SUM(CASE WHEN fc.status = 'active' AND fc.subscription_type = 'monthly' AND fc.monthly_amount IS NOT NULL THEN fc.monthly_amount ELSE 0 END), 0) as monthly_revenue,
    COALESCE(SUM(CASE WHEN fc.status = 'active' AND fc.subscription_type = 'quarterly' AND fc.monthly_amount IS NOT NULL THEN fc.monthly_amount/3 ELSE 0 END), 0) as quarterly_monthly_equivalent,
    COALESCE(SUM(CASE WHEN fc.status = 'active' AND fc.subscription_type = 'yearly' AND fc.monthly_amount IS NOT NULL THEN fc.monthly_amount/12 ELSE 0 END), 0) as yearly_monthly_equivalent,
    f.created_at,
    f.updated_at
FROM families f
LEFT JOIN family_children fc ON f.id = fc.family_id
GROUP BY f.id, f.parent_name, f.parent_email, f.status, f.created_at, f.updated_at;

-- 13. Add some helpful indexes for performance
ALTER TABLE `family_children` ADD INDEX `idx_status_subscription` (`status`, `subscription_type`);
ALTER TABLE `families` ADD INDEX `idx_status_created` (`status`, `created_at`);

-- 14. Add a check constraint to ensure valid data relationships (MySQL 8.0+)
-- Uncomment if using MySQL 8.0 or later
-- ALTER TABLE `family_children` 
-- ADD CONSTRAINT `chk_subscription_amount_consistency` 
-- CHECK (
--     (subscription_type IS NULL AND monthly_amount IS NULL) OR 
--     (subscription_type IS NOT NULL AND monthly_amount IS NOT NULL)
-- );

-- Verification queries to check the migration
-- SELECT COUNT(*) FROM family_children WHERE relationship_to_parent IS NOT NULL;
-- SELECT f.*, ft.total_children, ft.total_monthly_amount FROM families f LEFT JOIN family_totals_view ft ON f.id = ft.family_id LIMIT 5;
-- SHOW CREATE TABLE family_children;
-- SHOW CREATE TABLE family_cart_items;



-----------------------------------
NEW
----------------------------------
ALTER TABLE family_payment_transactions 
ADD COLUMN paid_children_details JSON NULL COMMENT 'Detailed information about paid children with their subscription types';

ALTER TABLE family_children 
ADD COLUMN child_email VARCHAR(255) NULL;

ALTER TABLE `family_payment_transactions` 
ADD COLUMN `student_ids` JSON NULL 
COMMENT 'Array of student IDs associated with this payment transaction' 
AFTER `paid_children_details`;


ALTER TABLE `family_payment_transactions` 
ADD COLUMN `subscription_ids` JSON NULL 
COMMENT 'Array of UserSubscriptionDetails IDs created for this payment' 
AFTER `student_ids`;

ALTER TABLE `family_children` CHANGE `subscription_type` `subscription_type` ENUM('monthly','quarterly','yearly','custom') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Subscription billing type - set during payment generation';
ALTER TABLE `family_children` ADD `durationmonths` INT(11) NULL AFTER `subscription_type`;
ALTER TABLE `family_children` CHANGE `durationmonths` `durationmonths` INT(11) NULL DEFAULT NULL COMMENT 'Duration Months';
