// ALTER TABLE user_subscription_details
// ADD COLUMN payment_id INT NULL AFTER plan_id;

// ALTER TABLE user_subscription_details
// ADD CONSTRAINT fk_user_subscription_payment
//     FOREIGN KEY (payment_id) REFERENCES payment_transactions(id);

// UPDATE user_subscription_details usd
// JOIN payment_transactions pt
//   ON pt.student_id = usd.user_id
//  AND pt.status IN ('success', 'refunded')
//  AND ABS(TIMESTAMPDIFF(MINUTE, pt.created_at, usd.created_at)) <= 1
// SET usd.payment_id = pt.id
// WHERE usd.payment_id IS NULL;
