/**
 * Engagement Notification Service
 * 
 * Handles sending engagement notifications through multiple channels (push, WhatsApp, email)
 * with frequency limiting, quiet hours, and deduplication.
 */
const { Op } = require('sequelize');
const moment = require('moment-timezone');
const NotificationLog = require('../models/NotificationLog');
const UserNotification = require('../models/UserNotification');
const FirebaseService = require('./firebase-service');
const { sendCombinedNotifications } = require('../cronjobs/reminder');
const fs = require('fs');
const path = require('path');

// Logging setup
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

function logToFile(message, type = 'info', additionalData = null) {
    const timestamp = new Date().toISOString();
    const logDate = timestamp.split('T')[0];
    const logFile = path.join(logsDir, `engagement-notifications-${logDate}.log`);

    let logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}`;
    if (additionalData) {
        logEntry += `\nData: ${JSON.stringify(additionalData, null, 2)}`;
    }
    logEntry += '\n';

    fs.appendFileSync(logFile, logEntry);

    if (type === 'error') {
        console.error(`[ENGAGEMENT] ${message}`, additionalData || '');
    } else {
        console.log(`[ENGAGEMENT] ${message}`, additionalData || '');
    }
}

class EngagementNotificationService {
    constructor() {
        this.firebaseService = new FirebaseService();
    }

    /**
     * Check if we can send a notification to this student based on frequency limits
     * @param {number} studentId 
     * @param {object} rule - The notification rule
     * @returns {Promise<{allowed: boolean, reason: string}>}
     */
    async checkFrequencyLimits(studentId, rule) {
        try {
            const now = new Date();
            
            // Check daily limit
            const startOfDay = moment(now).startOf('day').toDate();
            const dailyCount = await NotificationLog.count({
                where: {
                    student_id: studentId,
                    sent_at: { [Op.gte]: startOfDay },
                    status: 'sent'
                }
            });

            if (dailyCount >= rule.max_per_day) {
                return { allowed: false, reason: `Daily limit reached (${dailyCount}/${rule.max_per_day})` };
            }

            // Check weekly limit
            const startOfWeek = moment(now).startOf('isoWeek').toDate();
            const weeklyCount = await NotificationLog.count({
                where: {
                    student_id: studentId,
                    sent_at: { [Op.gte]: startOfWeek },
                    status: 'sent'
                }
            });

            if (weeklyCount >= rule.max_per_week) {
                return { allowed: false, reason: `Weekly limit reached (${weeklyCount}/${rule.max_per_week})` };
            }

            return { allowed: true, reason: 'OK' };
        } catch (error) {
            logToFile(`Error checking frequency limits for student ${studentId}`, 'error', { error: error.message });
            return { allowed: true, reason: 'Error checking limits, allowing by default' };
        }
    }

    /**
     * Check if we are in quiet hours for this student  
     * @param {object} user - User object (must have timezone field)
     * @param {object} rule - The notification rule
     * @returns {boolean} true if in quiet hours (should NOT send)
     */
    isInQuietHours(user, rule) {
        try {
            const timezone = user.timezone || 'Asia/Jerusalem'; // Default to Israel timezone
            const nowInTz = moment().tz(timezone);
            const currentTime = nowInTz.format('HH:mm:ss');
            
            const quietStart = rule.quiet_start || '22:00:00';
            const quietEnd = rule.quiet_end || '08:00:00';

            // Handle overnight quiet hours (e.g., 22:00 - 08:00)
            if (quietStart > quietEnd) {
                // It's quiet if current time is AFTER start OR BEFORE end
                return currentTime >= quietStart || currentTime < quietEnd;
            } else {
                // Normal range (e.g., 01:00 - 06:00)
                return currentTime >= quietStart && currentTime < quietEnd;
            }
        } catch (error) {
            logToFile('Error checking quiet hours', 'error', { error: error.message });
            return false; // If error, allow sending
        }
    }

    /**
     * Check if this exact notification was already sent recently (deduplication)
     * @param {number} studentId 
     * @param {number} ruleId 
     * @param {number} hoursBack - How many hours back to check for duplicates
     * @returns {Promise<boolean>} true if already sent (duplicate)
     */
    async isDuplicate(studentId, ruleId, hoursBack = 24) {
        try {
            const since = moment().subtract(hoursBack, 'hours').toDate();
            const existing = await NotificationLog.findOne({
                where: {
                    student_id: studentId,
                    rule_id: ruleId,
                    status: 'sent',
                    sent_at: { [Op.gte]: since }
                }
            });
            return !!existing;
        } catch (error) {
            logToFile('Error checking duplicates', 'error', { error: error.message });
            return false;
        }
    }

    /**
     * Get notification content based on user language
     * @param {object} rule - The notification rule
     * @param {object} user - User object
     * @returns {{title: string, body: string}}
     */
    getNotificationContent(rule, user) {
        const lang = (user.language || 'HE').toUpperCase();
        
        if (lang === 'HE') {
            return {
                title: rule.title_he || rule.title_en || rule.display_name,
                body: rule.body_he || rule.body_en || rule.description || ''
            };
        }
        
        return {
            title: rule.title_en || rule.title_he || rule.display_name,
            body: rule.body_en || rule.body_he || rule.description || ''
        };
    }

    /**
     * Send push notification to a student via FCM
     * @param {object} user - User object
     * @param {string} title 
     * @param {string} body 
     * @returns {Promise<boolean>}
     */
    async sendPushNotification(user, title, body) {
        try {
            if (!user.fcm_token) {
                logToFile(`No FCM token for user ${user.full_name} (ID: ${user.id})`, 'warn');
                return false;
            }

            const tokens = this.firebaseService.parseFcmTokens(user.fcm_token);
            if (tokens.length === 0) {
                logToFile(`Invalid FCM tokens for user ${user.full_name} (ID: ${user.id})`, 'warn');
                return false;
            }

            let successCount = 0;
            for (const token of tokens) {
                const result = await this.firebaseService.sendNotificationToDevice(token, { title, body });
                if (result.success) successCount++;
            }

            return successCount > 0;
        } catch (error) {
            logToFile(`Push notification failed for user ${user.id}`, 'error', { error: error.message });
            return false;
        }
    }

    /**
     * Send a full engagement notification to a student with all checks
     * @param {object} user - Full user object from DB
     * @param {object} rule - NotificationRule object
     * @returns {Promise<{sent: boolean, channels: string[], reason: string}>}
     */
    async sendEngagementNotification(user, rule) {
        const result = { sent: false, channels: [], reason: '' };

        try {
            // 1. Check frequency limits
            const freqCheck = await this.checkFrequencyLimits(user.id, rule);
            if (!freqCheck.allowed) {
                result.reason = freqCheck.reason;
                await this.logNotification(user.id, rule.id, 'all', '', '', 'skipped', freqCheck.reason);
                logToFile(`Skipped notification for user ${user.id}: ${freqCheck.reason}`, 'info');
                return result;
            }

            // 2. Check quiet hours
            if (this.isInQuietHours(user, rule)) {
                result.reason = 'Quiet hours';
                await this.logNotification(user.id, rule.id, 'all', '', '', 'skipped', 'Quiet hours');
                logToFile(`Skipped notification for user ${user.id}: quiet hours`, 'info');
                return result;
            }

            // 3. Check deduplication
            const dedupHours = rule.trigger_type === 'inactivity' ? 48 : 24;
            if (await this.isDuplicate(user.id, rule.id, dedupHours)) {
                result.reason = 'Already sent recently';
                logToFile(`Skipped notification for user ${user.id}: duplicate`, 'info');
                return result;
            }

            // 4. Get content
            const content = this.getNotificationContent(rule, user);
            const channels = rule.channels || ['push'];

            // 5. Send via each configured channel
            for (const channel of channels) {
                try {
                    let success = false;

                    if (channel === 'push') {
                        success = await this.sendPushNotification(user, content.title, content.body);
                    } else if (channel === 'whatsapp') {
                        // Use the existing AiSensy WhatsApp integration
                        // We send a generic engagement template
                        success = await this.sendWhatsAppNotification(user, content);
                    } else if (channel === 'email') {
                        success = await this.sendEmailNotification(user, content);
                    } else if (channel === 'inapp') {
                        success = await this.sendInAppNotification(user, rule, content);
                    }

                    const status = success ? 'sent' : 'failed';
                    await this.logNotification(user.id, rule.id, channel, content.title, content.body, status, success ? null : 'Channel delivery failed');

                    if (success) {
                        result.channels.push(channel);
                        result.sent = true;
                    }
                } catch (channelError) {
                    logToFile(`Channel ${channel} failed for user ${user.id}`, 'error', { error: channelError.message });
                    await this.logNotification(user.id, rule.id, channel, content.title, content.body, 'failed', channelError.message);
                }
            }

            if (result.sent) {
                result.reason = `Sent via: ${result.channels.join(', ')}`;
                logToFile(`Engagement notification sent to user ${user.id} (${user.full_name}) via ${result.channels.join(', ')}`, 'info', {
                    ruleId: rule.id,
                    ruleName: rule.rule_name,
                    channels: result.channels
                });
            } else {
                result.reason = 'All channels failed';
            }

            return result;
        } catch (error) {
            logToFile(`Error sending engagement notification to user ${user.id}`, 'error', { error: error.message });
            result.reason = error.message;
            return result;
        }
    }

    /**
     * Send WhatsApp notification using AiSensy (simplified engagement message)
     * @param {object} user 
     * @param {object} content - {title, body}
     * @returns {Promise<boolean>}
     */
    async sendWhatsAppNotification(user, content) {
        try {
            if (!user.mobile || !user.country_code) {
                logToFile(`No phone number for user ${user.id}`, 'warn');
                return false;
            }

            // Use the existing sendCombinedNotifications or sendAisensyNotification
            // For engagement, we use a simple template approach
            const axios = require('axios');
            const apiKey = process.env.AISENSY_API_KEY;

            if (!apiKey) {
                logToFile('Missing AISENSY_API_KEY', 'error');
                return false;
            }

            if (process.env.NOTIFICATIONS_ENABLED === 'false') {
                logToFile(`[SUPPRESSED] WhatsApp engagement notification for user ${user.id}`, 'info');
                return true;
            }

            const rawNumber = user.mobile.trim();
            const countryCode = user.country_code.trim();
            const destinationCountryCode = countryCode.startsWith('+') ? countryCode : '+' + countryCode;
            const destination = destinationCountryCode + rawNumber;
            const lang = (user.language || 'HE').toUpperCase();

            const payload = {
                apiKey: apiKey,
                campaignName: `engagement_reminder_${lang}`,
                destination: destination,
                userName: user.full_name,
                templateParams: [user.full_name, content.body],
                source: 'engagement-reminder',
                media: {},
                buttons: [],
                carouselCards: [],
                location: {},
                paramsFallbackValue: {
                    FirstName: user.full_name
                }
            };

            const response = await axios({
                method: 'post',
                url: 'https://backend.aisensy.com/campaign/t1/api/v2',
                data: JSON.stringify(payload, null, 2),
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000
            });

            return response.status >= 200 && response.status < 300;
        } catch (error) {
            logToFile(`WhatsApp notification failed for user ${user.id}`, 'error', { error: error.message });
            return false;
        }
    }

    /**
     * Send email notification  
     * @param {object} user 
     * @param {object} content - {title, body}
     * @returns {Promise<boolean>}
     */
    async sendEmailNotification(user, content) {
        try {
            if (!user.email) {
                logToFile(`No email for user ${user.id}`, 'warn');
                return false;
            }

            const sendEmail = require('../utils/sendEmail');
            await sendEmail({
                to: user.email,
                subject: content.title,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #4A90D9;">${content.title}</h2>
                        <p style="font-size: 16px; line-height: 1.6; color: #333;">${content.body}</p>
                        <br>
                        <a href="https://tulkka.com" style="background-color: #4A90D9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Open Tulkka</a>
                        <br><br>
                        <p style="font-size: 12px; color: #999;">Tulkka - Learning Platform</p>
                    </div>
                `
            });
            return true;
        } catch (error) {
            logToFile(`Email notification failed for user ${user.id}`, 'error', { error: error.message });
            return false;
        }
    }

    /**
     * Save an in-app notification to user_notifications table
     * This is the notification the student sees INSIDE the app
     * @param {object} user 
     * @param {object} rule - NotificationRule object
     * @param {object} content - {title, body}
     * @returns {Promise<boolean>}
     */
    async sendInAppNotification(user, rule, content) {
        try {
            await UserNotification.create({
                user_id: user.id,
                rule_id: rule.id,
                type: rule.trigger_type,
                title: content.title,
                body: content.body,
                data: JSON.stringify({
                    rule_name: rule.rule_name,
                    trigger_type: rule.trigger_type,
                    priority: rule.priority
                }),
                is_read: false,
                created_at: new Date()
            });

            logToFile(`In-app notification saved for user ${user.id} (${user.full_name}) - rule: ${rule.rule_name}`, 'info');
            return true;
        } catch (error) {
            logToFile(`In-app notification failed for user ${user.id}`, 'error', { error: error.message });
            return false;
        }
    }

    /**
     * Log a notification to the database
     */
    async logNotification(studentId, ruleId, channel, title, body, status, failureReason = null) {
        try {
            await NotificationLog.create({
                student_id: studentId,
                rule_id: ruleId,
                channel: channel,
                title: title,
                body: body,
                status: status,
                failure_reason: failureReason,
                sent_at: new Date()
            });
        } catch (error) {
            logToFile('Error logging notification', 'error', { error: error.message });
        }
    }

    /**
     * Get notification statistics for admin dashboard
     * @param {object} filters - Optional filters
     * @returns {Promise<object>}
     */
    async getStats(filters = {}) {
        try {
            const now = new Date();
            const startOfDay = moment(now).startOf('day').toDate();
            const startOfWeek = moment(now).startOf('isoWeek').toDate();

            const [todayCount, weekCount, todayByChannel, byRule] = await Promise.all([
                NotificationLog.count({
                    where: { status: 'sent', sent_at: { [Op.gte]: startOfDay } }
                }),
                NotificationLog.count({
                    where: { status: 'sent', sent_at: { [Op.gte]: startOfWeek } }
                }),
                NotificationLog.findAll({
                    attributes: [
                        'channel',
                        [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count']
                    ],
                    where: { status: 'sent', sent_at: { [Op.gte]: startOfDay } },
                    group: ['channel'],
                    raw: true
                }),
                NotificationLog.findAll({
                    attributes: [
                        'rule_id',
                        [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count']
                    ],
                    where: { status: 'sent', sent_at: { [Op.gte]: startOfWeek } },
                    group: ['rule_id'],
                    raw: true
                })
            ]);

            return {
                today: todayCount,
                thisWeek: weekCount,
                todayByChannel: todayByChannel,
                thisWeekByRule: byRule
            };
        } catch (error) {
            logToFile('Error getting stats', 'error', { error: error.message });
            return { today: 0, thisWeek: 0, todayByChannel: [], thisWeekByRule: [] };
        }
    }
}

module.exports = EngagementNotificationService;
