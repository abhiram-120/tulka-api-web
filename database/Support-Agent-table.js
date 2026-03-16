-- Create support_permissions table
CREATE TABLE `support_permissions` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `resource` varchar(255) NOT NULL,
  `action` enum('create','read','update','delete') NOT NULL,
  `description` text DEFAULT NULL,
  `created_at` bigint(20) NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `updated_at` bigint(20) NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `support_permissions_resource_action_unique` (`resource`,`action`),
  KEY `support_permissions_resource_index` (`resource`),
  KEY `support_permissions_action_index` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create support_user_permissions table
CREATE TABLE `support_user_permissions` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `permission_id` int(10) unsigned DEFAULT NULL,
  `resource` varchar(255) DEFAULT NULL,
  `action` enum('create','read','update','delete') DEFAULT NULL,
  `granted` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` bigint(20) NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `updated_at` bigint(20) NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (`id`),
  KEY `support_user_permissions_user_id_index` (`user_id`),
  KEY `support_user_permissions_permission_id_index` (`permission_id`),
  UNIQUE KEY `support_user_permissions_user_resource_action_unique` (`user_id`,`resource`,`action`),
  CONSTRAINT `support_user_permissions_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `support_user_permissions_permission_id_foreign` FOREIGN KEY (`permission_id`) REFERENCES `support_permissions` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add missing columns to support_user_permissions table

-- Add granted_by column (who granted the permission)
ALTER TABLE `support_user_permissions` 
ADD COLUMN `granted_by` int(10) unsigned DEFAULT NULL COMMENT 'ID of the admin who granted this permission' 
AFTER `granted`;

-- Add granted_at column (when permission was granted)
ALTER TABLE `support_user_permissions` 
ADD COLUMN `granted_at` bigint(20) DEFAULT NULL COMMENT 'Timestamp when permission was granted' 
AFTER `granted_by`;

-- Add expires_at column (optional expiration timestamp)
ALTER TABLE `support_user_permissions` 
ADD COLUMN `expires_at` bigint(20) DEFAULT NULL COMMENT 'Optional expiration timestamp for temporary permissions' 
AFTER `granted_at`;

-- Add notes column (optional notes about the permission)
ALTER TABLE `support_user_permissions` 
ADD COLUMN `notes` text DEFAULT NULL COMMENT 'Optional notes about why this permission was granted/denied' 
AFTER `expires_at`;

-- Add foreign key constraint for granted_by
ALTER TABLE `support_user_permissions` 
ADD CONSTRAINT `support_user_permissions_granted_by_foreign` 
FOREIGN KEY (`granted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Add indexes for better performance
ALTER TABLE `support_user_permissions` 
ADD INDEX `support_user_permissions_granted_by_index` (`granted_by`);

ALTER TABLE `support_user_permissions` 
ADD INDEX `support_user_permissions_expires_at_index` (`expires_at`);

ALTER TABLE `support_user_permissions` 
ADD INDEX `support_user_permissions_granted_index` (`granted`);

-- Add index for name field in support_permissions (from your model)
ALTER TABLE `support_permissions` 
ADD INDEX `support_permissions_name_index` (`name`);


-- Insert default support permissions
INSERT INTO `support_permissions` (`name`, `resource`, `action`, `description`, `created_at`, `updated_at`) VALUES
('create_students', 'students', 'create', 'Create students', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('read_students', 'students', 'read', 'Read students', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('update_students', 'students', 'update', 'Update students', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('delete_students', 'students', 'delete', 'Delete students', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),

('create_teachers', 'teachers', 'create', 'Create teachers', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('read_teachers', 'teachers', 'read', 'Read teachers', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('update_teachers', 'teachers', 'update', 'Update teachers', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('delete_teachers', 'teachers', 'delete', 'Delete teachers', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),

('create_classes', 'classes', 'create', 'Create classes', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('read_classes', 'classes', 'read', 'Read classes', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('update_classes', 'classes', 'update', 'Update classes', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('delete_classes', 'classes', 'delete', 'Delete classes', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),

('create_payments', 'payments', 'create', 'Create payments', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('read_payments', 'payments', 'read', 'Read payments', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('update_payments', 'payments', 'update', 'Update payments', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('delete_payments', 'payments', 'delete', 'Delete payments', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),

('create_subscriptions', 'subscriptions', 'create', 'Create subscriptions', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('read_subscriptions', 'subscriptions', 'read', 'Read subscriptions', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('update_subscriptions', 'subscriptions', 'update', 'Update subscriptions', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('delete_subscriptions', 'subscriptions', 'delete', 'Delete subscriptions', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),

('create_reports', 'reports', 'create', 'Create reports', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('read_reports', 'reports', 'read', 'Read reports', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('update_reports', 'reports', 'update', 'Update reports', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('delete_reports', 'reports', 'delete', 'Delete reports', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),

('create_settings', 'settings', 'create', 'Create settings', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('read_settings', 'settings', 'read', 'Read settings', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('update_settings', 'settings', 'update', 'Update settings', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('delete_settings', 'settings', 'delete', 'Delete settings', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),

('create_users', 'users', 'create', 'Create users', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('read_users', 'users', 'read', 'Read users', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('update_users', 'users', 'update', 'Update users', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('delete_users', 'users', 'delete', 'Delete users', UNIX_TIMESTAMP(), UNIX_TIMESTAMP());

-- Insert support agent roles (if they don't exist)
INSERT IGNORE INTO `roles` (`name`, `caption`, `users_count`, `is_admin`, `created_at`) VALUES
('support_agent', 'Support Agent', 0, 0, UNIX_TIMESTAMP()),
('senior_support', 'Senior Support', 0, 0, UNIX_TIMESTAMP()),
('support_lead', 'Support Lead', 0, 1, UNIX_TIMESTAMP());