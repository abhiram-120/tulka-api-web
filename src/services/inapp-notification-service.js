// inapp-notification-service.js
const FirebaseService = require('./firebase-service');
const NotificationTemplates = require('../helper/notificationTemplates'); // Your existing template helper
const InAppNotificationTemplates = require('../helper/inAppNotificationTemplates'); // If you have this

class InAppNotificationService {
    constructor() {
        this.firebaseService = new FirebaseService();
    }

    /**
     * Send in-app notification to user
     * Equivalent to the sendNotification function in your PHP helper
     * @param {string} template - Template name
     * @param {Object} options - Template options/variables
     * @param {number} userId - User ID
     * @param {Object} user - User object from database
     * @returns {Promise<boolean>} - Success status
     */
    async sendInAppNotification(template, options, userId, user) {
        try {
            console.log(`Preparing InApp notification for user: ${user.full_name} (ID: ${userId})`);
            
            // Check if user has FCM token
            if (!user.fcm_token) {
                console.log(`Failed to send notification (No FCM token): ${user.full_name}`);
                return false;
            }

            // Parse notification preferences
            const notificationOptions = JSON.parse(user.notification_channels || '[]');
            const inAppEnabled = notificationOptions.includes('inapp') || user.isAdmin;

            if (!inAppEnabled) {
                console.log(`InApp notifications disabled for user: ${user.full_name}`);
                return false;
            }

            // Get notification content based on template
            const language = user.language || 'HE';
            let inAppNotification = null;

            // Check if template supports in-app notifications (same logic as PHP)
            const inAppSupportedTemplates = [
                'booking_done', 
                'regular_class_reminders_24', 
                'regular_class_reminders_4', 
                'regular_class_reminders_1', 
                'new_lesson_reminders_30', 
                'lesson_started', 
                'homework_received', 
                'feedback_received',
                'regular_class_book_for_teacher'
            ];

            if (inAppSupportedTemplates.includes(template)) {
                // Use InAppNotificationTemplates if available, otherwise use regular templates
                if (typeof InAppNotificationTemplates !== 'undefined') {
                    inAppNotification = InAppNotificationTemplates.getNotification(template, language, 'email', options);
                } else {
                    inAppNotification = NotificationTemplates.getNotification(template, language, 'email', options);
                }
            }

            if (!inAppNotification) {
                console.log(`No in-app notification template found for: ${template}`);
                return false;
            }

            // Parse FCM tokens (handle both single token and array format)
            const tokenArray = this.firebaseService.parseFcmTokens(user.fcm_token);

            if (tokenArray.length === 0) {
                console.log(`Failed to send notification (Invalid token format): ${user.full_name}`);
                return false;
            }

            console.log(`Sending FCM notification to ${tokenArray.length} device(s) for user: ${user.full_name}`);

            // Send notification to each device
            let successCount = 0;
            for (const token of tokenArray) {
                const result = await this.firebaseService.sendNotificationToDevice(token, {
                    title: inAppNotification.title,
                    body: inAppNotification.content
                });

                if (result.success) {
                    successCount++;
                    console.log(`Notification sent successfully to device for: ${user.full_name}`);
                } else {
                    console.error(`FCM send failed for user ${user.full_name}:`, result.error);
                }
            }

            return successCount > 0;

        } catch (error) {
            console.error(`FCM request failed for user ${user.full_name} (ID: ${userId}):`, error.message);
            return false;
        }
    }

    /**
     * Send notification to multiple users
     * @param {string} template - Template name
     * @param {Object} options - Template options
     * @param {Array<Object>} users - Array of user objects
     * @returns {Promise<Object>} - Results summary
     */
    async sendBulkInAppNotifications(template, options, users) {
        const results = {
            total: users.length,
            success: 0,
            failed: 0,
            errors: []
        };

        for (const user of users) {
            try {
                const success = await this.sendInAppNotification(template, options, user.id, user);
                if (success) {
                    results.success++;
                } else {
                    results.failed++;
                }
            } catch (error) {
                results.failed++;
                results.errors.push({
                    userId: user.id,
                    userName: user.full_name,
                    error: error.message
                });
            }
        }

        return results;
    }
}

module.exports = InAppNotificationService;