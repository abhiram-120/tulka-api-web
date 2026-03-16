-- Indexes to support churn analysis queries
-- Review and apply during a maintenance window on large datasets.

-- classes: optimize joins by teacher/student and time filtering
CREATE INDEX idx_classes_teacher_student ON classes (teacher_id, student_id);
CREATE INDEX idx_classes_meeting_student_teacher ON classes (meeting_start, student_id, teacher_id);
-- NEW: Optimize finding latest lesson for a student
-- CREATE INDEX idx_classes_student_status_meeting ON classes (student_id, status, meeting_start DESC);

-- user_subscription_details: optimize churn filters by status/payment + date + user
CREATE INDEX idx_usd_status_cancel_user ON user_subscription_details (status, cancellation_date, user_id);
CREATE INDEX idx_usd_status_updated_user ON user_subscription_details (status, updated_at, user_id);
CREATE INDEX idx_usd_payment_cancel_user ON user_subscription_details (payment_status, cancellation_date, user_id);
CREATE INDEX idx_usd_payment_updated_user ON user_subscription_details (payment_status, updated_at, user_id);
-- NEW: Optimize getting latest subscription for a user
CREATE INDEX idx_usd_user_created_desc ON user_subscription_details (user_id, created_at DESC);

-- payment_transactions: optimize lifetime_value subquery
CREATE INDEX idx_payment_student_status ON payment_transactions (student_id, status);

-- past_due_payments: optimize joining on status
CREATE INDEX idx_pdp_status_user ON past_due_payments (status, user_id);
