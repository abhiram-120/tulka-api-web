ALTER TABLE user_subscription_details
ADD COLUMN discount_data JSON NULL 
AFTER data_of_bonus_class;

ALTER TABLE `recurring_payments` 
ADD COLUMN `pricing_info` JSON NULL 
AFTER `webhook_data`;