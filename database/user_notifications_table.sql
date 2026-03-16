-- ============================================
-- User In-App Notifications Table
-- Stores notifications visible INSIDE the mobile app
-- ============================================

CREATE TABLE IF NOT EXISTS user_notifications (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    user_id         INT NOT NULL,
    rule_id         INT DEFAULT NULL,               -- Links to notification_rules (NULL for system notifications)
    type            VARCHAR(100) NOT NULL,           -- e.g., 'post_lesson_feedback', 'inactivity', 'system'
    title           VARCHAR(255) NOT NULL,
    body            TEXT,
    data            JSON DEFAULT NULL,               -- Extra payload (e.g., lesson_id, feedback_id for deep linking)
    is_read         BOOLEAN DEFAULT FALSE,
    read_at         DATETIME DEFAULT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_user_read (user_id, is_read),
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_rule (rule_id),
    FOREIGN KEY (rule_id) REFERENCES notification_rules(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
