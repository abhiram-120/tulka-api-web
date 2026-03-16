// CREATE TABLE cohort_retention (
//     id BIGINT PRIMARY KEY AUTO_INCREMENT,

//     -- Cohort = month of first paid subscription
//     cohort_year INT NOT NULL,
//     cohort_month INT NOT NULL,  -- 1-12
//     cohort_label VARCHAR(7) NOT NULL, -- "2025-08"

//     -- Filters / dimensions
//     lead_source VARCHAR(50) NULL,
//     subscription_type VARCHAR(50) NULL,
//     sales_rep_id BIGINT NULL,
//     trial_booked_by_type VARCHAR(50) NULL,  -- coordinator / website / app
//     trial_coordinator_id BIGINT NULL,

//     -- Base cohort size
//     total_users INT NOT NULL DEFAULT 0,

//     -- Retention absolute counts
//     month_1_active INT DEFAULT 0,
//     month_2_active INT DEFAULT 0,
//     month_3_active INT DEFAULT 0,
//     month_4_active INT DEFAULT 0,
//     month_5_active INT DEFAULT 0,
//     month_6_active INT DEFAULT 0,
//     month_7_active INT DEFAULT 0,
//     month_8_active INT DEFAULT 0,
//     month_9_active INT DEFAULT 0,
//     month_10_active INT DEFAULT 0,
//     month_11_active INT DEFAULT 0,
//     month_12_active INT DEFAULT 0,

//     -- Retention percentages
//     month_1_percent DECIMAL(5,2),
//     month_2_percent DECIMAL(5,2),
//     month_3_percent DECIMAL(5,2),
//     month_4_percent DECIMAL(5,2),
//     month_5_percent DECIMAL(5,2),
//     month_6_percent DECIMAL(5,2),
//     month_7_percent DECIMAL(5,2),
//     month_8_percent DECIMAL(5,2),
//     month_9_percent DECIMAL(5,2),
//     month_10_percent DECIMAL(5,2),
//     month_11_percent DECIMAL(5,2),
//     month_12_percent DECIMAL(5,2),

//     -- Operational fields
//     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
// );


// CREATE INDEX idx_cohort_retention_cohort ON cohort_retention (cohort_year, cohort_month);

// CREATE INDEX idx_cohort_retention_sales_rep ON cohort_retention (sales_rep_id);
// CREATE INDEX idx_cohort_retention_lead_source ON cohort_retention (lead_source);
// CREATE INDEX idx_cohort_retention_subscription_type ON cohort_retention (subscription_type);

// CREATE INDEX idx_cohort_retention_trial ON cohort_retention (trial_booked_by_type, trial_coordinator_id);
