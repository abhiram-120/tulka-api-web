-- ============================================
-- Engagement Notification System - Database Migration
-- Run this in your MySQL database (tulkka9 or whichever you use)
-- ============================================

-- 1. notification_rules - Admin-configurable engagement rules
CREATE TABLE IF NOT EXISTS notification_rules (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    rule_name       VARCHAR(100) NOT NULL,
    display_name    VARCHAR(255) NOT NULL,
    description     TEXT,
    trigger_type    VARCHAR(100) NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    delay_hours     INT DEFAULT 0,
    delay_days      INT DEFAULT 0,
    channels        JSON,
    title_he        VARCHAR(255),
    title_en        VARCHAR(255),
    body_he         TEXT,
    body_en         TEXT,
    max_per_day     INT DEFAULT 3,
    max_per_week    INT DEFAULT 10,
    quiet_start     TIME DEFAULT '22:00:00',
    quiet_end       TIME DEFAULT '08:00:00',
    priority        INT DEFAULT 5,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 2. notification_log - Tracks every notification sent
CREATE TABLE IF NOT EXISTS notification_log (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    student_id      INT NOT NULL,
    rule_id         INT NOT NULL,
    channel         VARCHAR(50),
    title           VARCHAR(255),
    body            TEXT,
    status          VARCHAR(50) DEFAULT 'queued',
    failure_reason  VARCHAR(255),
    sent_at         DATETIME DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_student_date (student_id, sent_at),
    INDEX idx_rule (rule_id),
    INDEX idx_status (status),
    FOREIGN KEY (rule_id) REFERENCES notification_rules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 3. student_activity - Tracks student app usage for inactivity detection
CREATE TABLE IF NOT EXISTS student_activity (
    id                      INT PRIMARY KEY AUTO_INCREMENT,
    student_id              INT NOT NULL,
    last_app_open           DATETIME,
    last_practice           DATETIME,
    last_vocab_practice     DATETIME,
    last_feedback_viewed    DATETIME,
    last_game_played        DATETIME,
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE INDEX idx_student_unique (student_id),
    INDEX idx_last_open (last_app_open)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================
-- 4. Seed default notification rules
-- ============================================
INSERT INTO notification_rules (rule_name, display_name, description, trigger_type, is_active, delay_hours, delay_days, channels, title_he, title_en, body_he, body_en, max_per_day, max_per_week, priority) VALUES

('post_lesson_feedback', 'Post-Lesson Feedback Reminder', 'Reminds students to review teacher feedback after a lesson ends', 'post_lesson_feedback', 1, 2, 0, '["push", "whatsapp"]',
 'המורה שלך השאיר/ה משוב! 📝', 'Your teacher left feedback! 📝',
 'לאחר השיעור האחרון, המורה שלך כתב/ה לך משוב. בוא/י לקרוא!', 'After your last lesson, your teacher wrote you feedback. Come check it out!',
 3, 10, 1),

('post_lesson_practice', 'Post-Lesson Practice Reminder', 'Reminds students to play practice games after a lesson', 'post_lesson_practice', 1, 4, 0, '["push"]',
 'זמן לתרגל! 🎮', 'Time to practice! 🎮',
 'יש לך משחקי תרגול חדשים מהשיעור האחרון. בוא/י לשחק!', 'You have new practice games from your last lesson. Come play!',
 3, 10, 2),

('inactivity_gentle', 'Inactivity Reminder (Gentle)', 'Sent when student has not opened the app for several days', 'inactivity', 1, 0, 3, '["push"]',
 'מתגעגעים אליך! 💙', 'We miss you! 💙',
 'לא ראינו אותך כבר כמה ימים. בוא/י לתרגל קצת ולהישאר בכושר!', 'We haven''t seen you in a few days. Come practice a bit and stay sharp!',
 1, 3, 3),

('inactivity_urgent', 'Inactivity Reminder (Urgent)', 'Sent when student has not opened the app for a week', 'inactivity', 1, 0, 7, '["push", "whatsapp"]',
 'שבוע בלי תרגול? 😟', 'A week without practice? 😟',
 'עבר שבוע מאז שהתרגלת. הלמידה שלך חשובה - בוא/י חזרה!', 'It''s been a week since you practiced. Your learning matters - come back!',
 1, 2, 2),

('unviewed_feedback', 'Unviewed Feedback Reminder', 'Reminds students about teacher feedback they have not viewed', 'unviewed_feedback', 1, 24, 0, '["push"]',
 'עדיין לא קראת את המשוב 📋', 'You haven''t read your feedback yet 📋',
 'המורה שלך השאיר/ה משוב שעדיין לא צפית בו. בוא/י לקרוא!', 'Your teacher left feedback you haven''t viewed yet. Come check it out!',
 1, 5, 4),

('new_practice_available', 'New Practice Available', 'Notifies students when new practice activities are available', 'new_practice_available', 1, 1, 0, '["push"]',
 'פעילות תרגול חדשה! ✨', 'New practice activity! ✨',
 'יש לך תרגול חדש זמין. בוא/י להתחיל!', 'You have a new practice available. Come get started!',
 2, 7, 5),

('unpracticed_vocab', 'Unpracticed Vocabulary Reminder', 'Reminds students to practice vocabulary from their last lesson', 'unpracticed_vocab', 1, 0, 2, '["push"]',
 'יש לך מילים לתרגל! 📚', 'You have words to practice! 📚',
 'יש מילים מהשיעור האחרון שעדיין לא תרגלת. בוא/י לחזק את האוצר מילים!', 'You have words from your last lesson you haven''t practiced. Come strengthen your vocabulary!',
 1, 3, 5);
