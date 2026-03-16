// src/services/dunningNotificationService.js
const { sendNotificationEmail, whatsappReminderTrailClass } = require('../cronjobs/reminder');
const moment = require('moment');

/**
 * Send immediate failure notification (Day 0)
 * @param {Object} params - Notification parameters
 */
const sendFailureNotification = async (params) => {
    try {
        const {
            user,
            past_due_payment,
            payment_link,
            days_remaining,
            is_first_notification = true
        } = params;

        console.log(`Sending failure notification to user ${user.id} - days remaining: ${days_remaining}`);

        const notificationParams = {
            'student.name': user.full_name || 'Dear Student',
            'amount': past_due_payment.amount.toString(),
            'currency': past_due_payment.currency || 'ILS',
            'payment.link': payment_link,
            'days.remaining': days_remaining.toString(),
            'expiry.date': moment(past_due_payment.grace_period_expires_at).format('MMMM DD, YYYY'),
            'failed.date': moment(past_due_payment.failed_at).format('MMMM DD, YYYY'),
            'support.email': process.env.SUPPORT_EMAIL || 'support@tulkka.com',
            'company.name': 'Tulkka'
        };

        // Prepare recipient details
        const recipientDetails = {
            email: user.email,
            full_name: user.full_name,
            language: user.language || 'EN',
            mobile: user.mobile,
            country_code: user.country_code
        };

        let emailSent = false;
        let whatsappSent = false;

        // Send email notification
        if (user.email && user.email.trim() !== '') {
            try {
                const emailTemplate = is_first_notification ? 'payment_failed_immediate' : 'payment_failed_reminder';
                emailSent = await sendNotificationEmail(
                    emailTemplate,
                    notificationParams,
                    recipientDetails,
                    false // Not a trial user
                );

                if (emailSent) {
                    console.log(`Email failure notification sent to ${user.email}`);
                } else {
                    console.error(`Failed to send email failure notification to ${user.email}`);
                }
            } catch (emailError) {
                console.error('Error sending failure email:', emailError);
            }
        }

        // Send WhatsApp notification
        if (user.mobile && user.mobile.trim() !== '') {
            try {
                const whatsappTemplate = is_first_notification ? 'payment_failed_immediate' : 'payment_failed_reminder';
                
                whatsappSent = await whatsappReminderTrailClass(
                    whatsappTemplate,
                    notificationParams,
                    {
                        country_code: user.country_code || '+972',
                        mobile: user.mobile,
                        full_name: user.full_name,
                        language: user.language || 'HE'
                    }
                );

                if (whatsappSent) {
                    console.log(`WhatsApp failure notification sent to ${user.mobile}`);
                } else {
                    console.error(`Failed to send WhatsApp failure notification to ${user.mobile}`);
                }
            } catch (whatsappError) {
                console.error('Error sending failure WhatsApp:', whatsappError);
            }
        }

        return {
            success: emailSent || whatsappSent,
            email_sent: emailSent,
            whatsapp_sent: whatsappSent,
            channels_attempted: {
                email: !!user.email,
                whatsapp: !!user.mobile
            }
        };

    } catch (error) {
        console.error('Error in sendFailureNotification:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Send reminder notification (Daily reminders during grace period)
 * @param {Object} params - Reminder parameters
 */
const sendReminderNotification = async (params) => {
    try {
        const {
            user,
            past_due_payment,
            dunning_schedule,
            payment_link,
            days_remaining
        } = params;

        console.log(`Sending reminder notification to user ${user.id} - reminder #${dunning_schedule.total_reminders_sent + 1}`);

        // Use the failure notification with is_first_notification = false
        const result = await sendFailureNotification({
            user,
            past_due_payment,
            payment_link,
            days_remaining,
            is_first_notification: false
        });

        return result;

    } catch (error) {
        console.error('Error in sendReminderNotification:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Send final cancellation notification (Day 30)
 * @param {Object} params - Cancellation notification parameters
 */
const sendCancellationNotification = async (params) => {
    try {
        const {
            user,
            past_due_payment,
            subscription
        } = params;

        console.log(`Sending cancellation notification to user ${user.id}`);

        const notificationParams = {
            'student.name': user.full_name || 'Dear Student',
            'amount': past_due_payment.amount.toString(),
            'currency': past_due_payment.currency || 'ILS',
            'subscription.type': subscription.type || 'Subscription',
            'canceled.date': moment().format('MMMM DD, YYYY'),
            'failed.date': moment(past_due_payment.failed_at).format('MMMM DD, YYYY'),
            'support.email': process.env.SUPPORT_EMAIL || 'support@tulkka.com',
            'company.name': 'Tulkka',
            'reactivation.info': 'Contact support to reactivate your subscription'
        };

        const recipientDetails = {
            email: user.email,
            full_name: user.full_name,
            language: user.language || 'EN',
            mobile: user.mobile,
            country_code: user.country_code
        };

        let emailSent = false;
        let whatsappSent = false;

        // Send email notification
        if (user.email && user.email.trim() !== '') {
            try {
                emailSent = await sendNotificationEmail(
                    'subscription_canceled_unpaid',
                    notificationParams,
                    recipientDetails,
                    false
                );

                if (emailSent) {
                    console.log(`Cancellation email sent to ${user.email}`);
                }
            } catch (emailError) {
                console.error('Error sending cancellation email:', emailError);
            }
        }

        // Send WhatsApp notification
        if (user.mobile && user.mobile.trim() !== '') {
            try {
                whatsappSent = await whatsappReminderTrailClass(
                    'subscription_canceled_unpaid',
                    notificationParams,
                    {
                        country_code: user.country_code || '+972',
                        mobile: user.mobile,
                        full_name: user.full_name,
                        language: user.language || 'HE'
                    }
                );

                if (whatsappSent) {
                    console.log(`Cancellation WhatsApp sent to ${user.mobile}`);
                }
            } catch (whatsappError) {
                console.error('Error sending cancellation WhatsApp:', whatsappError);
            }
        }

        return {
            success: emailSent || whatsappSent,
            email_sent: emailSent,
            whatsapp_sent: whatsappSent
        };

    } catch (error) {
        console.error('Error in sendCancellationNotification:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

module.exports = {
    sendFailureNotification,
    sendReminderNotification,
    sendCancellationNotification
};