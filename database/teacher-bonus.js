// CREATE TABLE compensation_groups (
//     id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

//     name VARCHAR(100) NOT NULL,

//     levels JSON NOT NULL,
//     is_active BOOLEAN NOT NULL DEFAULT TRUE,

//     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
//     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
//         ON UPDATE CURRENT_TIMESTAMP,

//     -- 🔒 HARD GUARANTEE: one group per name
//     CONSTRAINT uniq_compensation_group_name UNIQUE (name)
// );

// ALTER TABLE compensation_groups
// ADD COLUMN bonus_rules JSON NULL
// COMMENT 'Bonus slabs with thresholds and amounts';

// CREATE TABLE penalties (
//     id INT AUTO_INCREMENT PRIMARY KEY,

//     penalty_type VARCHAR(100) NOT NULL,
//     amount DECIMAL(10,2) NOT NULL,
//     description TEXT NULL,
//     penalty_month DATE NOT NULL,

//     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
//     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
//         ON UPDATE CURRENT_TIMESTAMP
// );

// CREATE TABLE teacher_salary_profiles (
//     id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

//     teacher_id INT UNSIGNED NOT NULL,

//     salary_mode ENUM('auto', 'manual') NOT NULL DEFAULT 'auto',

//     manual_start_date DATE NULL,
//     manual_end_date DATE NULL,
//     manual_hourly_rate DECIMAL(10,2) NULL,

//     compensation_group_id BIGINT UNSIGNED NOT NULL,

//     current_group VARCHAR(100) NOT NULL,
//     current_level VARCHAR(50) NOT NULL,
//     eligible_level VARCHAR(50) NULL,

//     level_locked BOOLEAN NOT NULL DEFAULT FALSE,

//     bonus DECIMAL(10,2) NOT NULL DEFAULT 0,
//     penalty DECIMAL(10,2) NOT NULL DEFAULT 0,
//     total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,

//     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
//     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
//         ON UPDATE CURRENT_TIMESTAMP,

//     CONSTRAINT fk_teacher_salary_teacher
//         FOREIGN KEY (teacher_id)
//         REFERENCES users(id)
//         ON DELETE CASCADE,

//     CONSTRAINT fk_teacher_salary_group
//         FOREIGN KEY (compensation_group_id)
//         REFERENCES compensation_groups(id)
//         ON DELETE RESTRICT
// ) ENGINE=InnoDB;

// ALTER TABLE teacher_salary_profiles
// DROP COLUMN penalty;

// ALTER TABLE teacher_salary_profiles
// ADD COLUMN penalty JSON NOT NULL DEFAULT (JSON_ARRAY());

// ALTER TABLE compensation_groups
// ADD COLUMN eligible_kpis JSON NOT NULL
// COMMENT 'Eligibility KPIs per level (lessons, hours, retention rate)';


// CREATE TABLE activity_logs (
//   id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

//   entity_type ENUM(
//     'salary',
//     'compensation_group',
//     'group_level',
//     'bonus',
//     'penalty',
//     'payslip'
//   ) NOT NULL,

//   entity_id BIGINT UNSIGNED NULL,

//   action_type VARCHAR(50) NOT NULL,
//   -- examples:
//   -- salary_changed
//   -- level_changed
//   -- bonus_added
//   -- penalty_added
//   -- payslip_generated
//   -- payslip_cancelled

//   performed_by BIGINT UNSIGNED NULL,
//   -- admin_id (from middleware), null if system/cron

//   before_value JSON NULL,
//   after_value JSON NULL,

//   action JSON NULL,
//   -- human readable / extra context

//   source ENUM('admin', 'system') NOT NULL DEFAULT 'admin',

//   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
// );


// ALTER TABLE activity_logs
// MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;


// CREATE TABLE teacher_payslips (
//   id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

//   teacher_id BIGINT UNSIGNED NOT NULL,
//   salary_profile_id BIGINT UNSIGNED NOT NULL,

//   period_start DATE NOT NULL,
//   period_end DATE NOT NULL,

//   status ENUM(
//     'draft',
//     'final',
//     'cancelled'
//   ) NOT NULL DEFAULT 'draft',

//   -- Financial breakdown (editable in draft)
//   base_salary DECIMAL(10,2) NOT NULL DEFAULT 0,
//   bonus_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
//   penalty_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
//   total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,

//   -- Line items (fully auditable & editable in draft)
//   classes JSON NULL,
//   bonuses JSON NULL,
//   penalties JSON NULL,

//   -- Lifecycle metadata
//   sent_at DATETIME NULL,
//   finalized_at DATETIME NULL,
//   cancelled_at DATETIME NULL,

//   created_by BIGINT UNSIGNED NOT NULL,
//   updated_by BIGINT UNSIGNED NULL,

//   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
//   updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
// );

// ALTER TABLE teacher_payslips
// ADD UNIQUE KEY uniq_teacher_period (
//   teacher_id,
//   period_start,
//   period_end,
//   status
// );


// CREATE TABLE payslip_exports (
//   id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

//   period_start DATE NOT NULL,
//   period_end DATE NOT NULL,

//   status ENUM(
//     'processing',
//     'completed',
//     'failed'
//   ) NOT NULL DEFAULT 'processing',

//   file_path VARCHAR(255) NULL,
//   error TEXT NULL,

//   requested_by BIGINT UNSIGNED NOT NULL,

//   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
//   completed_at DATETIME NULL
// );


// ALTER TABLE teacher_salary_profiles
// DROP COLUMN bonus,
// DROP COLUMN penalty,
// DROP COLUMN total_amount;


// CREATE TABLE teacher_salary_adjustments (
//   id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

//   teacher_id INT(10) UNSIGNED NOT NULL,

//   type ENUM('bonus', 'penalty') NOT NULL,

//   applied_date DATE NOT NULL,

//   value JSON NOT NULL,

//   created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
//   updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

//   CONSTRAINT fk_adjustment_teacher
//     FOREIGN KEY (teacher_id) REFERENCES users(id)
// ) ENGINE=InnoDB;


// ALTER TABLE teacher_payslips
// DROP INDEX uniq_teacher_period;

// Added on 1st january

// CREATE TABLE teacher_earning_history (
//   id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

//   teacher_id BIGINT UNSIGNED NOT NULL,
//   earning_date DATE NOT NULL,

//   base_rate DECIMAL(10,2) NOT NULL DEFAULT 0.00,
//   bonus_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
//   penalty_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
//   total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,

//   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//     ON UPDATE CURRENT_TIMESTAMP,

//   UNIQUE KEY uniq_teacher_day (teacher_id, earning_date),
//   INDEX idx_teacher_date (teacher_id, earning_date)
// );

// ALTER TABLE teacher_earning_history
// ADD COLUMN classes JSON NULL
// COMMENT 'Stores class references for the day (regular & trial class IDs)'
// AFTER earning_date;

// CREATE TABLE teacher_advanced_cash_requests (
//     id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

//     teacher_id INT UNSIGNED NOT NULL,
    
//     amount DECIMAL(10,2) NOT NULL,

//     status ENUM('pending', 'accepted', 'rejected') 
//         NOT NULL 
//         DEFAULT 'pending',

//     req_note TEXT NULL COMMENT 'Note added by teacher while requesting advance',

//     res_note TEXT NULL COMMENT 'Note added by admin while responding',

//     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
//     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

//     CONSTRAINT fk_teacher_advanced_cash_teacher
//         FOREIGN KEY (teacher_id)
//         REFERENCES users(id)
//         ON DELETE CASCADE,

//     INDEX idx_teacher_id (teacher_id),
//     INDEX idx_status (status),
//     INDEX idx_created_at (created_at)
// );

//Added on 2nd January

// ALTER TABLE teacher_salary_profiles
// DROP FOREIGN KEY fk_teacher_salary_group;

//Added on 23rd January
// ALTER TABLE teacher_salary_profiles
// ADD COLUMN pay_cycle ENUM('monthly', 'half_monthly')
// NOT NULL DEFAULT 'monthly'
// AFTER salary_mode;

// ALTER TABLE teacher_payslips
// ADD COLUMN period_type ENUM('FULL', 'FIRST_HALF', 'SECOND_HALF')
// NOT NULL DEFAULT 'FULL'
// AFTER period_end;


// ALTER TABLE compensation_groups
// ADD COLUMN currency_code VARCHAR(10) NOT NULL DEFAULT 'USD';


// CREATE TABLE bonuses (
//   id BIGINT PRIMARY KEY AUTO_INCREMENT,
//   bonus_type VARCHAR(50) NOT NULL,
//   amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
//   description TEXT NULL,
//   created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
//   updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
// );


// ALTER TABLE compensation_groups
// ADD COLUMN pay_cycle ENUM('monthly', 'half_monthly') NOT NULL DEFAULT 'monthly'
// AFTER currency_code;

// ALTER TABLE teacher_payslips
// ADD COLUMN classes_stats JSON NULL
// AFTER classes;


//Table to be cleard

// 1.activityLogs
// 2.compensationgroup
// 3.teacherBonus
// 4.teacherEarningHistory
// 5.teacherPaySlip
// 6.teacherPenalty
// 7.teacherSalaryAdjustment
// 8.teacherSalaryProfile