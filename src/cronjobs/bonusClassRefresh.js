const cron = require('node-cron');
const moment = require('moment-timezone');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');

// Import models (following your server structure)
const UserSubscriptionDetails = require('../models/UserSubscriptionDetails');
const User = require('../models/users');

// Setup logging directory
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Enhanced logging function
 * @param {string} message - Log message
 * @param {string} type - Log type (info, warn, error)
 */
function logBonusRefresh(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logDate = timestamp.split('T')[0]; // YYYY-MM-DD
    const logFile = path.join(logsDir, `bonus-class-refresh-${logDate}.log`);
    const logEntry = `[${timestamp}] [BONUS-REFRESH] [${type.toUpperCase()}] ${message}\n`;

    // Write to file
    fs.appendFileSync(logFile, logEntry);
}

// Flag to prevent concurrent executions
let isBonusRefreshRunning = false;

/**
 * Safe helper function to parse bonus class data from database
 * @param {string|object|array} data - Raw data from database
 * @returns {array} - Always returns an array
 */
const safeParseBonusData = (data) => {
    if (!data) return [];
    
    // If already an array, return it
    if (Array.isArray(data)) return data;
    
    // If string, try to parse
    if (typeof data === 'string') {
        try {
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            logBonusRefresh(`Error parsing bonus data: ${error.message}`, 'error');
            return [];
        }
    }
    
    // For any other type, return empty array
    return [];
};

/**
 * Main function to process expired bonus classes
 * Replicates the PHP RefreshBonusClass command functionality
 */
async function processExpiredBonusClasses() {
    if (isBonusRefreshRunning) {
        logBonusRefresh('Previous bonus refresh job still running, skipping execution', 'warn');
        return;
    }

    isBonusRefreshRunning = true;
    logBonusRefresh('Starting expired bonus classes refresh process');

    try {
        // Find active subscriptions with expired bonus classes
        const expiredSubscriptions = await UserSubscriptionDetails.findAll({
            where: {
                status: 'active',
                bonus_class: {
                    [Op.gt]: 0
                },
                bonus_expire_date: {
                    [Op.lte]: new Date()
                }
            },
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    attributes: ['id', 'full_name', 'timezone'],
                    required: false
                }
            ]
        });

        if (expiredSubscriptions.length === 0) {
            logBonusRefresh('No expired bonus classes found');
            return;
        }

        logBonusRefresh(`Found ${expiredSubscriptions.length} subscriptions with expired bonus classes`);

        let processedCount = 0;
        let errorCount = 0;

        // Process each expired subscription
        for (const subscription of expiredSubscriptions) {
            try {
                // Get user timezone or default to UTC
                const userTimezone = subscription.SubscriptionUser?.timezone || 'UTC';
                const now = moment().tz(userTimezone);
                const expireTime = moment(subscription.bonus_expire_date).tz(userTimezone);

                // Double-check expiration in user's timezone
                if (!now.isSameOrAfter(expireTime)) {
                    logBonusRefresh(`Subscription ${subscription.id} not yet expired in timezone ${userTimezone}`, 'warn');
                    continue;
                }

                logBonusRefresh(`Processing subscription ${subscription.id} (User: ${subscription.SubscriptionUser?.full_name || 'Unknown'})`);

                // Parse existing bonus data safely
                let bonusData = safeParseBonusData(subscription.data_of_bonus_class);

                // Process bonus data following PHP logic
                if (subscription.bonus_class > 0) {
                    if (bonusData.length > 0) {
                        // Find current active bonus
                        const currentBonusIndex = bonusData.findIndex(bonus => !bonus.refresh);
                        
                        if (currentBonusIndex !== -1) {
                            // Mark existing bonus as refreshed
                            bonusData[currentBonusIndex] = {
                                ...bonusData[currentBonusIndex],
                                bonus_completed_class: subscription.bonus_completed_class > 0 ? subscription.bonus_completed_class : 0,
                                refresh: true,
                                refresh_reason: 'Automatically expired and refreshed by system',
                                refresh_date: moment().format('YYYY-MM-DD HH:mm'),
                                refreshed_by_system: true,
                                system_refresh_timestamp: new Date().toISOString()
                            };
                        } else {
                            // No active bonus found, create new refreshed entry
                            const refreshedBonus = {
                                refresh: true,
                                bonus_class: subscription.bonus_class.toString(),
                                bonus_completed_class: subscription.bonus_completed_class > 0 ? subscription.bonus_completed_class : 0,
                                bonus_expire_date: moment(subscription.bonus_expire_date).format('YYYY-MM-DD HH:mm'),
                                bonus_created_at: moment().format('YYYY-MM-DD HH:mm'),
                                refresh_reason: 'Automatically expired and refreshed by system',
                                refresh_date: moment().format('YYYY-MM-DD HH:mm'),
                                refreshed_by_system: true,
                                system_refresh_timestamp: new Date().toISOString()
                            };
                            bonusData.unshift(refreshedBonus);
                        }
                    } else {
                        // No existing data, create new refreshed entry
                        const refreshedBonus = {
                            refresh: true,
                            bonus_class: subscription.bonus_class.toString(),
                            bonus_completed_class: subscription.bonus_completed_class > 0 ? subscription.bonus_completed_class : 0,
                            bonus_expire_date: moment(subscription.bonus_expire_date).format('YYYY-MM-DD HH:mm'),
                            bonus_created_at: moment().format('YYYY-MM-DD HH:mm'),
                            refresh_reason: 'Automatically expired and refreshed by system',
                            refresh_date: moment().format('YYYY-MM-DD HH:mm'),
                            refreshed_by_system: true,
                            system_refresh_timestamp: new Date().toISOString()
                        };
                        bonusData.push(refreshedBonus);
                    }
                }

                // Calculate new left_lessons (following PHP logic)
                const unusedBonusClasses = subscription.bonus_class - subscription.bonus_completed_class;
                let newLeftLessons = subscription.left_lessons - unusedBonusClasses;
                
                // Ensure left_lessons doesn't go negative
                if (newLeftLessons < 0) {
                    newLeftLessons = 0;
                }

                // Update subscription in database
                await subscription.update({
                    left_lessons: newLeftLessons,
                    bonus_class: 0,
                    bonus_completed_class: 0,
                    bonus_expire_date: null,
                    data_of_bonus_class: JSON.stringify(bonusData),
                    updated_at: new Date()
                });

                logBonusRefresh(
                    `✅ Refreshed subscription ${subscription.id}: ` +
                    `Unused bonus: ${unusedBonusClasses}, ` +
                    `New left lessons: ${newLeftLessons}`,
                    'success'
                );

                processedCount++;

            } catch (subscriptionError) {
                errorCount++;
                logBonusRefresh(
                    `❌ Error processing subscription ${subscription.id}: ${subscriptionError.message}`,
                    'error'
                );
                logBonusRefresh(subscriptionError.stack, 'error');
            }
        }

        // Log final results
        logBonusRefresh(
            `Bonus refresh process completed. ` +
            `✅ Processed: ${processedCount}, ` +
            `❌ Errors: ${errorCount}, ` +
            `📊 Total found: ${expiredSubscriptions.length}`,
            processedCount > 0 ? 'success' : 'info'
        );

    } catch (mainError) {
        logBonusRefresh(`💥 Fatal error in bonus refresh process: ${mainError.message}`, 'error');
        logBonusRefresh(mainError.stack, 'error');
    } finally {
        isBonusRefreshRunning = false;
    }
}

/**
 * Optional: Process bonus classes expiring soon (for notifications)
 */
async function processExpiringBonusClasses() {
    try {
        // Find subscriptions with bonus classes expiring in next 24 hours
        const expiringSubscriptions = await UserSubscriptionDetails.findAll({
            where: {
                status: 'active',
                bonus_class: {
                    [Op.gt]: 0
                },
                bonus_expire_date: {
                    [Op.between]: [
                        new Date(),
                        moment().add(24, 'hours').toDate()
                    ]
                }
            },
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    attributes: ['id', 'full_name', 'email'],
                    required: false
                }
            ]
        });

        if (expiringSubscriptions.length > 0) {
            logBonusRefresh(`📅 Found ${expiringSubscriptions.length} bonus classes expiring within 24 hours`);
            
            for (const subscription of expiringSubscriptions) {
                const hoursUntilExpiry = moment(subscription.bonus_expire_date).diff(moment(), 'hours');
                logBonusRefresh(
                    `⏰ Subscription ${subscription.id} (${subscription.SubscriptionUser?.full_name || 'Unknown'}) ` +
                    `expires in ${hoursUntilExpiry} hours`
                );
            }
        }

    } catch (error) {
        logBonusRefresh(`Error checking expiring bonus classes: ${error.message}`, 'error');
    }
}

// Schedule the main cron job to run every minute
cron.schedule('* * * * *', () => {
    processExpiredBonusClasses();
});

// Optional: Schedule expiring bonus notifications every hour
cron.schedule('0 * * * *', () => {
    processExpiringBonusClasses();
});

// Initialize logging
logBonusRefresh('🚀 Bonus class refresh cron job initialized');
logBonusRefresh('📅 Schedule: Every minute for expired bonus checks');
logBonusRefresh('📅 Schedule: Every hour for expiring bonus notifications');

// Export for manual execution or testing
module.exports = {
    processExpiredBonusClasses,
    processExpiringBonusClasses,
    safeParseBonusData
};