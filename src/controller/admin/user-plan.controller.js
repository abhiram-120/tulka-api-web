const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const CancelReason = require('../../models/cancelReason');
const User = require('../../models/users');
const Class = require('../../models/classes');
const RegularClass = require('../../models/regularClass');
const RecurringPayment = require('../../models/RecurringPayment');
const PaymentTransaction = require('../../models/PaymentTransaction');
const Referral = require('../../models/Referral');
const ReferralReward = require('../../models/ReferralReward');
const ReferralTier = require('../../models/ReferralTier');
const SubscriptionPlan = require('../../models/subscription_plan');
const SubscriptionDuration = require('../../models/subscription_duration');
const LessonLength = require('../../models/lesson_length');
const LessonsPerMonth = require('../../models/lessons_per_month');
const PastDuePayment = require('../../models/PastDuePayment');
const DunningSchedule = require('../../models/DunningSchedule');
const { Op, Sequelize } = require('sequelize');
const moment = require('moment');
const axios = require('axios');
const CancellationReasonCategory = require('../../models/cancellationReasonCategory');
const { classDeletionLogger } = require('../../utils/classDeletionLogger');

// PayPlus API Configuration
const PAYPLUS_CONFIG = {
    apiKey: process.env.PAYPLUS_API_KEY || '',
    secretKey: process.env.PAYPLUS_SECRET_KEY || '',
    baseUrl: process.env.PAYPLUS_BASE_URL || 'https://restapidev.payplus.co.il/api/v1.0',
    terminalUid: process.env.PAYPLUS_TERMINAL_UID || '7aab6b6b-0ab9-42b2-b71c-37307667ced7'
};

/**
 * Helper: Log a cancellation reason into cancel_reasons table
 * @param {Object} options - Options for logging
 * @param {Number} options.student_id - ID of the student
 * @param {String} options.cancellation_type - 'lesson' | 'subscription'
 * @param {String} options.reason - Reason category
 * @param {String} [options.note] - Additional note/details
 * @returns {Promise<void>}
 */
async function logCancelReason({ student_id, cancellation_type, reason, note }) {
    try {
        await CancelReason.create({
            student_id,
            cancellation_type,
            reason: reason || 'other',
            note: note || null,
            created_at: new Date()
        });
        console.log(`🧾 Logged cancel reason → ${cancellation_type}: ${reason}`);
    } catch (error) {
        console.error('❌ Failed to log cancel reason:', error.message);
    }
}

/**
 * Internal helper: find March 2026 online subscriptions with plan mismatch,
 * and optionally update left_lessons.
 *
 * @param {boolean} applyChanges - When true, persist left_lessons updates.
 * @returns {Promise<{summary: Object, message: string}>}
 */
async function handleMarch2026OnlineSubscriptionsPlanMismatch(applyChanges) {
    // 01-03-2026 00:00:00 UTC to 16-03-2026 23:59:59 UTC
    const startDate = moment.utc('2026-02-18').startOf('day').toDate();
    const endDate = moment.utc('2026-03-18').endOf('day').toDate();

    const targetSubscriptions = await UserSubscriptionDetails.findAll({
        where: {
            status: 'active',
            payment_status: 'online',
            is_cancel: 0,
            weekly_lesson: 4,
            renew_date: {
                [Op.gte]: startDate,
                [Op.lte]: endDate
            }
        },
        order: [['user_id', 'ASC'], ['renew_date', 'ASC']]
    });

    const summary = {
        total_checked: targetSubscriptions.length,
        total_affected: 0,
        total_updated: 0,
        applyChanges: !!applyChanges,
        items: []
    };

    if (!targetSubscriptions.length) {
        return {
            summary,
            message: 'No matching subscriptions found in the specified window'
        };
    }

    const transaction = applyChanges
        ? await UserSubscriptionDetails.sequelize.transaction()
        : null;

    try {
        for (const sub of targetSubscriptions) {
            // Find previous subscription for same user (most recent before current renew_date)
            const previousSub = await UserSubscriptionDetails.findOne({
                where: {
                    user_id: sub.user_id,
                    id: { [Op.ne]: sub.id },
                    renew_date: { [Op.lt]: sub.renew_date }
                },
                order: [['renew_date', 'DESC']],
                transaction
            });

            if (!previousSub) {
                continue;
            }

            const planChanged =
                previousSub.weekly_lesson !== sub.weekly_lesson ||
                previousSub.lesson_min !== sub.lesson_min;

            if (!planChanged) {
                continue;
            }

            const originalWeekly = sub.weekly_lesson || 0;
            const previousWeekly = previousSub.weekly_lesson || 0;
            const deltaWeekly = previousWeekly - originalWeekly;

            const currentLeft = sub.left_lessons || 0;
            let newLeftLessons = currentLeft;
            let newWeeklyLesson = previousSub.weekly_lesson;
            let newLessonMin = previousSub.lesson_min;
            let updated = false;
            let reason = '';

            // Always update subscription to match previous subscription when plan changed
            if (deltaWeekly > 0) {
                // If weekly_lesson increased, add the difference to left_lessons
                newLeftLessons = currentLeft + deltaWeekly;
            }

            if (applyChanges && transaction) {
                await sub.update(
                    {
                        // Align core plan fields with previous subscription
                        weekly_lesson: previousSub.weekly_lesson,
                        lesson_min: previousSub.lesson_min,
                        left_lessons: newLeftLessons,
                        updated_at: new Date()
                    },
                    { transaction }
                );
                updated = true;
                summary.total_updated += 1;
                reason = deltaWeekly > 0
                    ? `Aligned plan with previous month: weekly_lesson ${originalWeekly}→${previousSub.weekly_lesson}, lesson_min ${sub.lesson_min}→${previousSub.lesson_min}, and increased left_lessons by ${deltaWeekly}`
                    : `Aligned plan with previous month: weekly_lesson ${originalWeekly}→${previousSub.weekly_lesson}, lesson_min ${sub.lesson_min}→${previousSub.lesson_min}`;
            } else {
                reason = deltaWeekly > 0
                    ? `Would align plan with previous month: weekly_lesson ${originalWeekly}→${previousSub.weekly_lesson}, lesson_min ${sub.lesson_min}→${previousSub.lesson_min}, and increase left_lessons by ${deltaWeekly}`
                    : `Would align plan with previous month: weekly_lesson ${originalWeekly}→${previousSub.weekly_lesson}, lesson_min ${sub.lesson_min}→${previousSub.lesson_min}`;
            }

            summary.total_affected += 1;

            // Check regular classes for this student
            const regularClasses = await RegularClass.findAll({
                where: { student_id: sub.user_id },
                transaction
            });

            const regularClassUpdates = [];
            for (const regularClass of regularClasses) {
                // Check if classes are booked - matching logic from setMonthlyClasses.js
                // In setMonthlyClasses.js (line 728-738), it checks:
                // - student_id, teacher_id
                // - status: { [Op.ne]: 'canceled' } (not canceled)
                // - is_regular_hide: 0 (visible classes only)
                const classWhere = {
                    student_id: sub.user_id,
                    teacher_id: regularClass.teacher_id,
                    status: { [Op.ne]: 'canceled' },
                    is_regular_hide: 0
                };

                // Add batch_id filter if it exists in RegularClass (optional, like in setMonthlyClasses.js)
                if (regularClass.batch_id) {
                    classWhere.batch_id = regularClass.batch_id;
                }

                const bookedClassesCount = await Class.count({
                    where: classWhere,
                    transaction
                });

                if (bookedClassesCount === 0) {
                    // No classes booked - reset student_lesson_reset_at to one month earlier
                    const currentResetAt = moment.utc(regularClass.student_lesson_reset_at);
                    const newResetAt = currentResetAt.clone().subtract(1, 'month');

                    if (applyChanges && transaction) {
                        await regularClass.update(
                            {
                                student_lesson_reset_at: newResetAt.toDate(),
                                updated_at: new Date()
                            },
                            { transaction }
                        );
                        regularClassUpdates.push({
                            regular_class_id: regularClass.id,
                            teacher_id: regularClass.teacher_id,
                            batch_id: regularClass.batch_id,
                            booked_classes_count: bookedClassesCount,
                            old_student_lesson_reset_at: currentResetAt.format(),
                            new_student_lesson_reset_at: newResetAt.format(),
                            updated: true
                        });
                    } else {
                        regularClassUpdates.push({
                            regular_class_id: regularClass.id,
                            teacher_id: regularClass.teacher_id,
                            batch_id: regularClass.batch_id,
                            booked_classes_count: bookedClassesCount,
                            old_student_lesson_reset_at: currentResetAt.format(),
                            new_student_lesson_reset_at: newResetAt.format(),
                            updated: false
                        });
                    }
                } else {
                    // Classes are booked, log this info
                    regularClassUpdates.push({
                        regular_class_id: regularClass.id,
                        teacher_id: regularClass.teacher_id,
                        batch_id: regularClass.batch_id,
                        booked_classes_count: bookedClassesCount,
                        skipped: true,
                        reason: 'Classes are already booked for this batch'
                    });
                }
            }

            summary.items.push({
                subscription_id: sub.id,
                user_id: sub.user_id,
                renew_date: sub.renew_date,
                current_weekly_lesson: sub.weekly_lesson,
                previous_weekly_lesson: previousSub.weekly_lesson,
                current_lesson_min: sub.lesson_min,
                previous_lesson_min: previousSub.lesson_min,
                previous_left_lessons: currentLeft,
                delta_weekly_lessons: deltaWeekly,
                new_weekly_lesson: newWeeklyLesson,
                new_lesson_min: newLessonMin,
                new_left_lessons: newLeftLessons,
                updated,
                reason,
                regular_classes_checked: regularClasses.length,
                regular_classes_updated: regularClassUpdates.length,
                regular_class_updates: regularClassUpdates
            });
        }

        if (transaction) {
            await transaction.commit();
        }

        return {
            summary,
            message: applyChanges
                ? 'Affected subscriptions processed and left_lessons updated where applicable'
                : 'Dry-run completed. No changes were applied (use POST /fix endpoint to apply).'
        };
    } catch (innerError) {
        if (transaction) {
            await transaction.rollback();
        }
        throw innerError;
    }
}

/**
 * GET: dry-run – list affected March 2026 online subscriptions with plan mismatch.
 */
const getMarch2026OnlineSubscriptionsPlanMismatch = async (req, res) => {
    try {
        const { summary, message } =
            await handleMarch2026OnlineSubscriptionsPlanMismatch(false);

        return res.status(200).json({
            status: 'success',
            data: summary,
            message
        });
    } catch (error) {
        console.error(
            'Error in getMarch2026OnlineSubscriptionsPlanMismatch:',
            error
        );
        return res.status(500).json({
            status: 'error',
            message:
                'Failed to fetch March 2026 online subscription plan mismatch data',
            details: error.message
        });
    }
};

/**
 * POST: apply changes – update left_lessons for affected March 2026 subscriptions.
 */
const fixMarch2026OnlineSubscriptionsPlanMismatch = async (req, res) => {
    try {
        const { summary, message } =
            await handleMarch2026OnlineSubscriptionsPlanMismatch(true);

        return res.status(200).json({
            status: 'success',
            data: summary,
            message
        });
    } catch (error) {
        console.error(
            'Error in fixMarch2026OnlineSubscriptionsPlanMismatch:',
            error
        );
        return res.status(500).json({
            status: 'error',
            message:
                'Failed to apply March 2026 online subscription plan mismatch fix',
            details: error.message
        });
    }
};

/**
 * Extract terminal UID from PayPlus webhook data with enhanced parsing
 * @param {String} pageRequestUid - PayPlus page request UID
 * @param {Object} webhookData - Webhook data from RecurringPayment.webhook_data
 * @returns {String|null} - Extracted terminal UID or null
 */
const extractTerminalUidFromPageRequest = (pageRequestUid, webhookData = null) => {
    try {
        console.log(`🔍 Extracting terminal UID from webhook data:`, {
            hasWebhookData: !!webhookData,
            pageRequestUid
        });

        if (!webhookData) {
            console.log(`⚠️ No webhook data provided, using fallback terminal UID`);
            return null;
        }

        // Parse webhook data if it's a string
        let parsedWebhookData = webhookData;
        if (typeof webhookData === 'string') {
            try {
                parsedWebhookData = JSON.parse(webhookData);
            } catch (parseError) {
                console.error(`❌ Error parsing webhook data string:`, parseError);
                return null;
            }
        }

        // Try to extract terminal UID from various locations in the webhook data
        let terminalUid = null;

        // Method 1: Direct terminal_uid field
        if (parsedWebhookData.terminal_uid) {
            terminalUid = parsedWebhookData.terminal_uid;
            console.log(`🏢 Found terminal UID in root webhook data: ${terminalUid}`);
            return terminalUid;
        }

        // Method 2: From original_webhook object (most common location)
        if (parsedWebhookData.original_webhook && parsedWebhookData.original_webhook.terminal_uid) {
            terminalUid = parsedWebhookData.original_webhook.terminal_uid;
            console.log(`🏢 Found terminal UID in original_webhook: ${terminalUid}`);
            return terminalUid;
        }

        // Method 3: From nested data structure if present
        if (parsedWebhookData.data && parsedWebhookData.data.terminal_uid) {
            terminalUid = parsedWebhookData.data.terminal_uid;
            console.log(`🏢 Found terminal UID in data object: ${terminalUid}`);
            return terminalUid;
        }

        // Method 4: From transaction object if present
        if (parsedWebhookData.transaction && parsedWebhookData.transaction.terminal_uid) {
            terminalUid = parsedWebhookData.transaction.terminal_uid;
            console.log(`🏢 Found terminal UID in transaction object: ${terminalUid}`);
            return terminalUid;
        }

        console.log(`⚠️ Terminal UID not found in webhook data structure`);
        return null;
    } catch (error) {
        console.error(`❌ Error extracting terminal UID:`, error);
        return null;
    }
};

/**
 * Extract recurring payment UID from PayPlus webhook data
 * @param {Object} webhookData - Webhook data from RecurringPayment.webhook_data
 * @returns {String|null} - Extracted recurring payment UID or null
 */
const extractRecurringPaymentUid = (webhookData) => {
    try {
        console.log(`🔍 Extracting recurring payment UID from webhook data`);

        if (!webhookData) {
            console.log(`⚠️ No webhook data provided for recurring UID extraction`);
            return null;
        }

        // Parse webhook data if it's a string
        let parsedWebhookData = webhookData;
        if (typeof webhookData === 'string') {
            try {
                parsedWebhookData = JSON.parse(webhookData);
            } catch (parseError) {
                console.error(`❌ Error parsing webhook data for recurring UID:`, parseError);
                return null;
            }
        }

        // Try to extract recurring payment UID from various locations
        let recurringUid = null;

        // Method 1: From original_webhook.recurring_payment_uid (most accurate)
        if (parsedWebhookData.original_webhook && parsedWebhookData.original_webhook.recurring_payment_uid) {
            recurringUid = parsedWebhookData.original_webhook.recurring_payment_uid;
            console.log(`💰 Found recurring payment UID in original_webhook: ${recurringUid}`);
            return recurringUid;
        }

        // Method 2: From recurring_info object
        if (parsedWebhookData.recurring_info) {
            if (parsedWebhookData.recurring_info.recurring_payment_uid) {
                recurringUid = parsedWebhookData.recurring_info.recurring_payment_uid;
                console.log(`💰 Found recurring payment UID in recurring_info: ${recurringUid}`);
                return recurringUid;
            }
            if (parsedWebhookData.recurring_info.recurring_uid) {
                recurringUid = parsedWebhookData.recurring_info.recurring_uid;
                console.log(`💰 Found recurring UID in recurring_info: ${recurringUid}`);
                return recurringUid;
            }
        }

        // Method 3: Direct field
        if (parsedWebhookData.recurring_payment_uid) {
            recurringUid = parsedWebhookData.recurring_payment_uid;
            console.log(`💰 Found recurring payment UID in root: ${recurringUid}`);
            return recurringUid;
        }

        // Method 4: From transaction object
        if (parsedWebhookData.transaction && parsedWebhookData.transaction.recurring_payment_uid) {
            recurringUid = parsedWebhookData.transaction.recurring_payment_uid;
            console.log(`💰 Found recurring payment UID in transaction: ${recurringUid}`);
            return recurringUid;
        }

        // Method 5: From original_webhook.recurring_id (alternative field)
        if (parsedWebhookData.original_webhook && parsedWebhookData.original_webhook.recurring_id) {
            // Note: This might be a different format, so we'll use it as fallback
            recurringUid = parsedWebhookData.original_webhook.recurring_id;
            console.log(`💰 Found recurring ID in original_webhook (fallback): ${recurringUid}`);
            return recurringUid;
        }

        console.log(`⚠️ Recurring payment UID not found in webhook data structure`);
        return null;
    } catch (error) {
        console.error(`❌ Error extracting recurring payment UID:`, error);
        return null;
    }
};

/**
 * Cancel recurring payment at PayPlus with enhanced UID extraction
 * @param {String} recurringPaymentUid - PayPlus recurring payment UID (from payplus_transaction_uid field)
 * @param {String} pageRequestUid - PayPlus page request UID (for terminal extraction)
 * @param {Object} webhookData - Webhook data that contains terminal_uid and recurring_payment_uid
 * @returns {Boolean} - Success status
 */
const cancelPayPlusRecurringPayment = async (recurringPaymentUid, pageRequestUid = null, webhookData = null) => {
    try {
        console.log(`🔄 Attempting to cancel PayPlus recurring payment with data:`, {
            recurringPaymentUid,
            pageRequestUid,
            hasWebhookData: !!webhookData
        });

        // First, try to extract the actual recurring payment UID from webhook data
        let actualRecurringUid = recurringPaymentUid;

        if (webhookData) {
            const extractedRecurringUid = extractRecurringPaymentUid(webhookData);
            if (extractedRecurringUid && extractedRecurringUid !== recurringPaymentUid) {
                console.log(`🔄 Using extracted recurring payment UID: ${extractedRecurringUid} instead of ${recurringPaymentUid}`);
                actualRecurringUid = extractedRecurringUid;
            }
        }

        if (!actualRecurringUid || actualRecurringUid === 'undefined' || actualRecurringUid === '' || actualRecurringUid === 'N/A') {
            console.log('⚠️ No valid recurring payment UID found, skipping PayPlus cancellation');
            return true; // Consider it successful if there's nothing to cancel
        }

        // Extract terminal UID from webhook data
        let terminalUid = extractTerminalUidFromPageRequest(pageRequestUid, webhookData);

        // Fall back to config terminal UID if extraction fails
        if (!terminalUid) {
            terminalUid = PAYPLUS_CONFIG.terminalUid;
            console.log(`🏢 Using fallback terminal UID from config: ${terminalUid}`);
        } else {
            console.log(`🏢 Using extracted terminal UID: ${terminalUid}`);
        }

        console.log(`🔄 Making PayPlus API call to cancel recurring payment:`, {
            recurringUid: actualRecurringUid,
            terminalUid,
            endpoint: `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/DeleteRecurring/${actualRecurringUid}`
        });

        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/DeleteRecurring/${actualRecurringUid}`,
            {
                terminal_uid: terminalUid,
                _method: 'DELETE'
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_CONFIG.apiKey,
                    'secret-key': PAYPLUS_CONFIG.secretKey
                },
                timeout: 30000
            }
        );

        console.log(`📊 PayPlus API response:`, {
            status: response.status,
            statusText: response.statusText,
            data: response.data
        });

        if (response.status === 200 || response.status === 204) {
            console.log(`✅ Successfully cancelled PayPlus recurring payment: ${actualRecurringUid} with terminal: ${terminalUid}`);
            return true;
        } else {
            console.error(`❌ PayPlus API returned status ${response.status} for recurring payment cancellation`);
            console.error(`Response data:`, response.data);
            return false;
        }
    } catch (error) {
        console.error(`❌ Error cancelling PayPlus recurring payment ${recurringPaymentUid}:`, {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
            statusText: error.response?.statusText
        });

        // If the error is that the recurring payment doesn't exist, consider it successful
        if (error.response?.status === 404 || error.response?.data?.includes('not found') || error.response?.data?.includes('Not Found') || error.message?.includes('not found')) {
            console.log('ℹ️ Recurring payment not found at PayPlus, considering cancellation successful');
            return true;
        }

        // If it's already cancelled, also consider it successful
        if (error.response?.data?.includes('already cancelled') || error.response?.data?.includes('already canceled') || error.response?.data?.includes('inactive')) {
            console.log('ℹ️ Recurring payment already cancelled at PayPlus, considering cancellation successful');
            return true;
        }

        return false;
    }
};

/**
 * Cancel all active recurring payments for a user - ENHANCED VERSION
 * @param {Number} userId - User ID
 * @param {String} reason - Cancellation reason
 * @param {Number} cancelledBy - ID of user who cancelled
 * @param {Object} transaction - Database transaction
 * @returns {Object} - Cancellation results
 */
const cancelUserRecurringPayments = async (userId, reason, cancelledBy, transaction) => {
    try {
        console.log(`🔄 Cancelling recurring payments for user ${userId}`);

        // Find all active recurring payments for this user
        const activeRecurringPayments = await RecurringPayment.findAll({
            where: {
                student_id: userId,
                status: { [Op.in]: ['pending', 'paid'] }
            },
            transaction
        });

        console.log(`📋 Found ${activeRecurringPayments.length} active recurring payments for user ${userId}`);

        let successCount = 0;
        let failureCount = 0;
        const results = [];

        for (const recurringPayment of activeRecurringPayments) {
            try {
                let payPlusCancelled = true;
                let actualRecurringUid = null;
                let terminalUid = null;

                // Get the actual recurring payment UID for cancellation using enhanced extraction
                actualRecurringUid = getRecurringPaymentUidForCancellation(recurringPayment);

                // Get terminal UID from webhook data
                terminalUid = getTerminalUidFromRecord(recurringPayment);

                console.log(`🔍 Processing recurring payment ${recurringPayment.id}:`, {
                    originalPayplusUid: recurringPayment.payplus_transaction_uid,
                    extractedRecurringUid: actualRecurringUid,
                    extractedTerminalUid: terminalUid,
                    pageRequestUid: recurringPayment.payplus_page_request_uid
                });

                // Try to cancel at PayPlus if we have the UID
                if (actualRecurringUid && actualRecurringUid !== 'N/A' && actualRecurringUid !== '') {
                    // Parse webhook data for the API call
                    let webhookDataForApi = null;
                    try {
                        if (recurringPayment.webhook_data) {
                            webhookDataForApi = parseWebhookDataFromDB(recurringPayment.webhook_data);
                        }
                    } catch (parseError) {
                        console.log(`⚠️ Could not parse webhook data for payment ${recurringPayment.id}: ${parseError.message}`);
                    }

                    // Make the PayPlus API call with enhanced data
                    payPlusCancelled = await cancelPayPlusRecurringPayment(actualRecurringUid, recurringPayment.payplus_page_request_uid, webhookDataForApi);
                } else {
                    console.log(`⚠️ No valid recurring payment UID found for payment ${recurringPayment.id}, skipping PayPlus cancellation`);
                    payPlusCancelled = true; // Consider successful if there's nothing to cancel
                }

                // Update the recurring payment record regardless of PayPlus result
                // (Better to mark as cancelled locally even if PayPlus fails)
                const updateRemarks = `${recurringPayment.remarks || ''}\n[${new Date().toISOString()}] Cancelled: ${reason}. PayPlus cancelled: ${payPlusCancelled}. Used recurring UID: ${
                    actualRecurringUid || 'N/A'
                }. Terminal UID: ${terminalUid || 'N/A'}`;

                await recurringPayment.update(
                    {
                        status: 'cancelled',
                        is_active: false,
                        cancelled_at: new Date(),
                        cancelled_by: cancelledBy,
                        remarks: updateRemarks
                    },
                    { transaction }
                );

                if (payPlusCancelled) {
                    successCount++;
                    results.push({
                        id: recurringPayment.id,
                        payplus_uid: recurringPayment.payplus_transaction_uid,
                        actual_recurring_uid: actualRecurringUid,
                        page_request_uid: recurringPayment.payplus_page_request_uid,
                        terminal_uid: terminalUid,
                        status: 'success',
                        message: 'Cancelled successfully at PayPlus'
                    });
                } else {
                    failureCount++;
                    results.push({
                        id: recurringPayment.id,
                        payplus_uid: recurringPayment.payplus_transaction_uid,
                        actual_recurring_uid: actualRecurringUid,
                        page_request_uid: recurringPayment.payplus_page_request_uid,
                        terminal_uid: terminalUid,
                        status: 'partial_success',
                        message: 'Marked as cancelled locally but PayPlus cancellation failed'
                    });
                }

                console.log(`✅ Processed recurring payment ${recurringPayment.id} for user ${userId} - PayPlus result: ${payPlusCancelled}`);
            } catch (error) {
                failureCount++;
                console.error(`❌ Error processing recurring payment ${recurringPayment.id}:`, error);

                results.push({
                    id: recurringPayment.id,
                    payplus_uid: recurringPayment.payplus_transaction_uid,
                    actual_recurring_uid: null,
                    page_request_uid: recurringPayment.payplus_page_request_uid,
                    terminal_uid: null,
                    status: 'error',
                    message: error.message
                });
            }
        }

        console.log(`📊 Recurring payment cancellation summary for user ${userId}: ${successCount} successful, ${failureCount} failed`);

        return {
            total: activeRecurringPayments.length,
            successful: successCount,
            failed: failureCount,
            results
        };
    } catch (error) {
        console.error(`❌ Error in cancelUserRecurringPayments for user ${userId}:`, error);
        throw error;
    }
};

/**
 * Reactivate recurring payments for a user (when subscription is reactivated)
 * @param {Number} userId - User ID
 * @param {Object} subscriptionDetails - New subscription details
 * @param {Number} reactivatedBy - ID of user who reactivated
 * @param {Object} transaction - Database transaction
 * @returns {Object} - Reactivation results
 */
const reactivateUserRecurringPayments = async (userId, subscriptionDetails, reactivatedBy, transaction) => {
    try {
        console.log(`🔄 Reactivating recurring payments for user ${userId}`);

        // Note: PayPlus doesn't typically support reactivating cancelled recurring payments
        // Instead, we would need to create a new recurring payment setup
        // For now, we'll just log that a new payment setup is needed

        console.log(`ℹ️ Recurring payment reactivation for user ${userId} requires new payment setup`);
        console.log(`📋 New subscription details:`, {
            type: subscriptionDetails.type,
            weekly_lesson: subscriptionDetails.weekly_lesson,
            lesson_min: subscriptionDetails.lesson_min,
            amount: subscriptionDetails.amount || 'unknown'
        });

        // Mark any recently cancelled payments with a note about reactivation attempt
        const recentlyCancelledPayments = await RecurringPayment.findAll({
            where: {
                student_id: userId,
                status: 'cancelled',
                cancelled_at: {
                    [Op.gte]: moment().subtract(30, 'days').toDate() // Within last 30 days
                }
            },
            transaction
        });

        for (const payment of recentlyCancelledPayments) {
            await payment.update(
                {
                    remarks: `${payment.remarks || ''}\n[${new Date().toISOString()}] Subscription reactivated by user ${reactivatedBy}. New payment setup required.`
                },
                { transaction }
            );
        }

        return {
            message: 'Recurring payments cannot be automatically reactivated. New payment setup required.',
            action_required: 'create_new_payment_link',
            cancelled_payments_found: recentlyCancelledPayments.length,
            recommendation: 'Generate a new payment link for the customer to set up recurring payments'
        };
    } catch (error) {
        console.error(`❌ Error in reactivateUserRecurringPayments for user ${userId}:`, error);
        throw error;
    }
};

/**
 * Get all user plans with optional filtering and pagination
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getUserPlans = async (req, res) => {
    try {
        const { keyword, subscription_type, status = 'all', payment_status, page = 1, limit = 10, date_from, date_to, permanent_teacher_id, sortBy, sortDirection = 'asc' } = req.query;

        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 100);

        // ✅ OPTIMIZED: Build where conditions efficiently
        const subscriptionWhereConditions = {};

        // Handle status filter
        if (status === 'inactive') {
            subscriptionWhereConditions.status = 'inactive';
            subscriptionWhereConditions.is_cancel = 1;
        } else if (status === 'inactive_after_renew') {
            subscriptionWhereConditions.inactive_after_renew = 1;
            subscriptionWhereConditions.status = 'active';
        } else if (status === 'active') {
            subscriptionWhereConditions.status = 'active';
            subscriptionWhereConditions.inactive_after_renew = 0;
        }

        if (subscription_type && subscription_type !== 'all') {
            subscriptionWhereConditions.type = subscription_type;
        }

        if (payment_status && payment_status !== 'all') {
            subscriptionWhereConditions.payment_status = payment_status;
        }

        if (date_from && date_to) {
            subscriptionWhereConditions.created_at = {
                // [Op.between]: [new Date(date_from), new Date(date_to)],
                [Op.between]: [moment.tz(date_from, 'YYYY-MM-DD', 'UTC').startOf('day').toDate(), moment.tz(date_to, 'YYYY-MM-DD', 'UTC').endOf('day').toDate()]
            };
        }

        const userWhereConditions = {};
        if (keyword) {
            userWhereConditions[Op.or] = [{ full_name: { [Op.like]: `%${keyword}%` } }, { email: { [Op.like]: `%${keyword}%` } }, { mobile: { [Op.like]: `%${keyword}%` } }];
        }

        // ✅ OPTIMIZED: Build order clause based on sortBy (database-level sorting when possible)
        let orderClause = [['id', 'DESC']]; // Default order
        const needsInMemorySort = sortBy && ['subscription_duration_months', 'monthly_completed', 'permanent_teacher'].includes(sortBy);

        if (sortBy && !needsInMemorySort) {
            const direction = sortDirection === 'desc' ? 'DESC' : 'ASC';
            switch (sortBy) {
                case 'student_name':
                    orderClause = [[{ model: User, as: 'SubscriptionUser' }, 'full_name', direction]];
                    break;
                case 'subscription_details':
                    orderClause = [['type', direction]];
                    break;
                case 'renew_date':
                    orderClause = [['renew_date', direction]];
                    break;
                default:
                    orderClause = [['id', 'DESC']];
            }
        }

        // ✅ OPTIMIZED: Use raw SQL query to get latest subscription per user at database level
        // This avoids fetching all subscriptions and filtering in memory (major performance improvement)
        const sequelize = UserSubscriptionDetails.sequelize;
        
        // Build WHERE clause for subscriptions
        let subscriptionWhereSQL = '1=1';
        const replacements = {};
        
        if (subscription_type && subscription_type !== 'all') {
            subscriptionWhereSQL += ' AND usd.type = :subscription_type';
            replacements.subscription_type = subscription_type;
        }
        
        if (payment_status && payment_status !== 'all') {
            subscriptionWhereSQL += ' AND usd.payment_status = :payment_status';
            replacements.payment_status = payment_status;
        }
        
        if (date_from && date_to) {
            subscriptionWhereSQL += ' AND usd.created_at BETWEEN :date_from AND :date_to';
            replacements.date_from = moment.tz(date_from, 'YYYY-MM-DD', 'UTC').startOf('day').toDate();
            replacements.date_to = moment.tz(date_to, 'YYYY-MM-DD', 'UTC').endOf('day').toDate();
        }
        
        // Build user WHERE clause
        let userWhereSQL = '1=1';
        if (keyword) {
            userWhereSQL += ' AND (u.full_name LIKE :keyword OR u.email LIKE :keyword OR u.mobile LIKE :keyword)';
            replacements.keyword = `%${keyword}%`;
        }
        
        // Build status filter SQL
        let statusWhereSQL = '';
        if (status === 'inactive') {
            statusWhereSQL = 'AND usd.status = \'inactive\'';
        } else if (status === 'inactive_after_renew') {
            statusWhereSQL = 'AND usd.status = \'active\' AND usd.inactive_after_renew = 1';
        } else if (status === 'active') {
            statusWhereSQL = 'AND usd.status = \'active\' AND usd.inactive_after_renew = 0';
        }
        
        // ✅ OPTIMIZED: Use ROW_NUMBER() to get latest subscription per user at database level
        // First, get total count for pagination
        const countQuery = `
            WITH RankedSubscriptions AS (
                SELECT 
                    usd.id,
                    ROW_NUMBER() OVER (PARTITION BY usd.user_id ORDER BY usd.created_at DESC) as rn
                FROM user_subscription_details usd
                INNER JOIN users u ON usd.user_id = u.id
                WHERE ${subscriptionWhereSQL}
                AND ${userWhereSQL}
                ${statusWhereSQL}
            )
            SELECT COUNT(*) as total FROM RankedSubscriptions WHERE rn = 1
        `;
        
        const [countResult] = await sequelize.query(countQuery, {
            replacements,
            type: sequelize.QueryTypes.SELECT
        });
        
        const total = parseInt(countResult?.total || 0);
        
        if (total === 0) {
            return res.status(200).json({
                status: 'success',
                data: [],
                pagination: {
                    total: 0,
                    page: pageNum,
                    limit: pageLimit,
                    pages: 0
                },
                message: 'User plans retrieved successfully'
            });
        }

        // ✅ OPTIMIZED: Handle pagination differently based on sorting needs
        let subscriptionIds = [];
        
        if (needsInMemorySort) {
            // For in-memory sorting, we need all IDs first (will sort after calculations)
            const allIdsQuery = `
                WITH RankedSubscriptions AS (
                    SELECT 
                        usd.id,
                        ROW_NUMBER() OVER (PARTITION BY usd.user_id ORDER BY usd.created_at DESC) as rn
                    FROM user_subscription_details usd
                    INNER JOIN users u ON usd.user_id = u.id
                    WHERE ${subscriptionWhereSQL}
                    AND ${userWhereSQL}
                    ${statusWhereSQL}
                )
                SELECT id FROM RankedSubscriptions WHERE rn = 1
            `;
            
            const allIdsRows = await sequelize.query(allIdsQuery, {
                replacements,
                type: sequelize.QueryTypes.SELECT
            });
            
            subscriptionIds = allIdsRows.map(row => row.id).filter(Boolean);
        } else {
            // ✅ OPTIMIZED: For database-level sorting, get only paginated IDs
            let sqlOrderBy = 'usd.id DESC'; // Default order
            if (sortBy) {
                const direction = sortDirection === 'desc' ? 'DESC' : 'ASC';
                switch (sortBy) {
                    case 'student_name':
                        sqlOrderBy = `u.full_name ${direction}`;
                        break;
                    case 'subscription_details':
                        sqlOrderBy = `usd.type ${direction}`;
                        break;
                    case 'renew_date':
                        sqlOrderBy = `usd.renew_date ${direction}`;
                        break;
                    default:
                        sqlOrderBy = 'usd.id DESC';
                }
            }
            
            const offset = (pageNum - 1) * pageLimit;
            const paginatedIdsQuery = `
                WITH RankedSubscriptions AS (
                    SELECT 
                        usd.id,
                        ROW_NUMBER() OVER (PARTITION BY usd.user_id ORDER BY usd.created_at DESC) as rn
                    FROM user_subscription_details usd
                    INNER JOIN users u ON usd.user_id = u.id
                    WHERE ${subscriptionWhereSQL}
                    AND ${userWhereSQL}
                    ${statusWhereSQL}
                ),
                LatestSubscriptions AS (
                    SELECT id FROM RankedSubscriptions WHERE rn = 1
                )
                SELECT ls.id
                FROM LatestSubscriptions ls
                INNER JOIN user_subscription_details usd ON ls.id = usd.id
                INNER JOIN users u ON usd.user_id = u.id
                ORDER BY ${sqlOrderBy}
                LIMIT :limit OFFSET :offset
            `;
            
            const paginatedReplacements = { ...replacements, limit: pageLimit, offset: offset };
            const paginatedIdsRows = await sequelize.query(paginatedIdsQuery, {
                replacements: paginatedReplacements,
                type: sequelize.QueryTypes.SELECT
            });
            
            subscriptionIds = paginatedIdsRows.map(row => row.id).filter(Boolean);
        }
        
        if (subscriptionIds.length === 0) {
            return res.status(200).json({
                status: 'success',
                data: [],
                pagination: {
                    total,
                    page: pageNum,
                    limit: pageLimit,
                    pages: Math.ceil(total / pageLimit)
                },
                message: 'User plans retrieved successfully'
            });
        }
        
        // Fetch full subscription records with associations
        const latestPlans = await UserSubscriptionDetails.findAll({
            where: { id: { [Op.in]: subscriptionIds } },
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'status', 'next_month_subscription', 'next_year_subscription'],
                    required: true
                },
                {
                    model: User,
                    as: 'OfflinePaymentAdmin',
                    attributes: ['id', 'full_name', 'email'],
                    required: false
                },
                {
                    model: CancellationReasonCategory,
                    as: 'CancellationReasonCategory',
                    attributes: ['id', 'name'],
                    required: false
                }
            ],
            order: orderClause
        });

        // ---- DEBUG TABLE: Show latest plan status breakdown (only in development)
        if (process.env.NODE_ENV === 'development') {
            const debugTable = latestPlans.map((p) => ({
                id: p.id,
                user_id: p.user_id,
                status: p.status,
                is_cancel: p.is_cancel,
                inactive_after_renew: p.inactive_after_renew
            }));
            console.table(debugTable);
        }

        // ✅ OPTIMIZATION: Batch fetch all related data upfront to avoid N+1 queries
        const studentIds = latestPlans.map((sub) => sub.user_id || sub.SubscriptionUser?.id).filter(Boolean);

        // Removed debug log for production
        if (studentIds.length === 0) {
            return res.status(200).json({
                status: 'success',
                data: [],
                pagination: {
                    total: 0,
                    page: pageNum,
                    limit: pageLimit,
                    pages: 0
                },
                message: 'User plans retrieved successfully'
            });
        }

        // Batch fetch all RegularClasses for active subscriptions
        const activeStudentIds = latestPlans
            .filter((sub) => sub.status === 'active')
            .map((sub) => sub.user_id || sub.SubscriptionUser?.id)
            .filter(Boolean);

        const [regularClassesMap, latestClassMap] = await Promise.all([
            // ✅ OPTIMIZED: Batch fetch latest RegularClasses for active subscriptions (only one per student)
            (async () => {
                const map = new Map();
                if (activeStudentIds.length > 0) {
                    // Fetch all RegularClasses ordered by created_at DESC, then take first per student
                    const regularClasses = await RegularClass.findAll({
                        where: { student_id: { [Op.in]: activeStudentIds } },
                        attributes: ['id', 'student_id', 'teacher_id', 'created_at'],
                        order: [['created_at', 'DESC']],
                        raw: true
                    });

                    // Group by student_id and take the latest one (first in DESC order)
                    regularClasses.forEach((rc) => {
                        if (!map.has(rc.student_id)) {
                            map.set(rc.student_id, rc);
                        }
                    });
                }
                return map;
            })(),

            // ✅ OPTIMIZED: Batch fetch latest Classes for all students (only one per student)
            (async () => {
                const map = new Map();
                if (studentIds.length > 0) {
                    const allLatestClasses = await Class.findAll({
                        where: { student_id: { [Op.in]: studentIds } },
                        attributes: ['id', 'student_id', 'teacher_id', 'created_at'],
                        order: [['created_at', 'DESC']],
                        raw: true
                    });

                    // Group by student_id and take the latest one (first in DESC order)
                    allLatestClasses.forEach((cls) => {
                        if (!map.has(cls.student_id)) {
                            map.set(cls.student_id, cls);
                        }
                    });
                }
                return map;
            })()
        ]);

        // ✅ OPTIMIZED: Collect teacher IDs and fetch all related data in parallel
        const teacherIds = new Set();
        regularClassesMap.forEach((rc) => {
            if (rc.teacher_id) teacherIds.add(rc.teacher_id);
        });
        latestClassMap.forEach((cls) => {
            if (cls.teacher_id) teacherIds.add(cls.teacher_id);
        });

        const userEmails = latestPlans.map((sub) => sub.SubscriptionUser?.email).filter(Boolean);
        
        // ✅ OPTIMIZED: Calculate unique price keys from latestPlans (not rawSubscriptions)
        const uniquePriceKeys = new Set(latestPlans.map((sub) => `${sub.type}_${sub.weekly_lesson}`));

        // ✅ OPTIMIZED: Run ALL independent queries in a single Promise.all for maximum parallelization
        const [teachers, transactionsByEmail, firstSubscriptionsMap, priceCache] = await Promise.all([
            // Fetch teachers in parallel
            teacherIds.size > 0 ? User.findAll({
                where: { id: { [Op.in]: Array.from(teacherIds) } },
                attributes: ['id', 'full_name', 'email'],
                raw: true
            }) : Promise.resolve([]),
            
            // Batch fetch all payment transactions grouped by email
            // Batch fetch all payment transactions grouped by email
            (async () => {
                const transactionsMap = new Map();
                if (userEmails.length > 0) {
                    const allTransactions = await PaymentTransaction.findAll({
                        where: {
                            student_email: { [Op.in]: userEmails },
                            status: { [Op.in]: ['success', 'refunded'] }
                        },
                        attributes: ['student_email', 'amount', 'refund_amount', 'status', 'is_recurring', 'payment_method', 'card_last_digits', 'created_at'],
                        order: [['created_at', 'DESC']],
                        raw: true
                    });

                    allTransactions.forEach((tx) => {
                        if (!transactionsMap.has(tx.student_email)) {
                            transactionsMap.set(tx.student_email, []);
                        }
                        transactionsMap.get(tx.student_email).push(tx);
                    });
                }
                return transactionsMap;
            })(),

            // ✅ OPTIMIZED: Batch fetch first subscriptions (only one per user)
            (async () => {
                const firstSubsMap = new Map();
                if (studentIds.length > 0) {
                    const firstSubs = await UserSubscriptionDetails.findAll({
                        where: { user_id: { [Op.in]: studentIds } },
                        attributes: ['user_id', 'created_at'],
                        order: [['created_at', 'ASC']],
                        raw: true
                    });

                    // Group by user_id and take the first one (oldest created_at)
                    firstSubs.forEach((sub) => {
                        if (!firstSubsMap.has(sub.user_id)) {
                            firstSubsMap.set(sub.user_id, sub);
                        }
                    });
                }
                return firstSubsMap;
            })(),

            // ✅ OPTIMIZED: Cache price calculations only for subscriptions that will be used
            (async () => {
                const cache = new Map();
                if (uniquePriceKeys.size > 0) {
                    await Promise.all(
                        Array.from(uniquePriceKeys).map(async (key) => {
                            const [type, lessons] = key.split('_');
                            const result = await calculateSubscriptionPrice(type, parseInt(lessons));
                            cache.set(key, result.price);
                        })
                    );
                }
                return cache;
            })()
        ]);
        
        // Build teachers map
        const teachersMap = new Map();
        teachers.forEach((teacher) => {
            teachersMap.set(teacher.id, teacher);
        });

        // ✅ Now process all subscriptions using in-memory lookups (no more DB queries)
        const formatted = latestPlans.map((subscription) => {
            const subData = subscription.toJSON();
            const studentId = subData.user_id || subData.SubscriptionUser?.id;

            // Find teacher using pre-fetched data
            let teacher = null;
            try {
                if (studentId) {
                    if (subData.status === 'active') {
                        const regClass = regularClassesMap.get(studentId);
                        if (regClass && regClass.teacher_id) {
                            teacher = teachersMap.get(regClass.teacher_id);
                        }

                        // Fallback to latest Class teacher
                        if (!teacher) {
                            const lastClass = latestClassMap.get(studentId);
                            if (lastClass && lastClass.teacher_id) {
                                teacher = teachersMap.get(lastClass.teacher_id);
                            }
                        }
                    } else if (subData.status === 'inactive') {
                        const lastClass = latestClassMap.get(studentId);
                        if (lastClass && lastClass.teacher_id) {
                            teacher = teachersMap.get(lastClass.teacher_id);
                        }
                    }
                }
            } catch (err) {
                console.error(`Error processing teacher for student ${studentId}:`, err);
            }

            // Calculate financial overview using pre-fetched transactions
            let totalSpent = 0;
            let monthlyPayment = 0;
            let paymentMethod = 'Manual / Offline';

            try {
                const userEmail = subData.SubscriptionUser?.email;

                if (userEmail) {
                    const allTransactions = transactionsByEmail.get(userEmail) || [];

                    // Total spent = sum of ALL payments for this user,
                    // subtract refund_amount for refunded transactions
                    totalSpent = allTransactions.reduce((sum, tx) => {
                        const amount = parseFloat(tx.amount || 0);
                        const refundAmount = parseFloat(tx.refund_amount || 0);
                        if (tx.status === 'refunded') {
                            return sum + Math.max(0, amount - refundAmount);
                        }
                        return sum + amount;
                    }, 0);

                    // Use latest transaction for monthlyPayment/paymentMethod
                    const latestTx = allTransactions
                        .slice()
                        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

                    if (latestTx) {
                        monthlyPayment = parseFloat(latestTx.amount || 0);

                        const pm = latestTx.payment_method;
                        if (pm === 'unknown') {
                            paymentMethod = latestTx.card_last_digits ? `Card (${latestTx.card_last_digits})` : 'Card';
                        } else if (pm && pm.trim() !== '') {
                            paymentMethod = latestTx.card_last_digits ? `${pm} (${latestTx.card_last_digits})` : pm;
                        } else {
                            paymentMethod = 'Manual / Offline';
                        }
                    }
                }
            } catch (err) {
                console.error(`Error processing payment info for student ${studentId}:`, err);
            }

            // Calculate subscription duration using pre-fetched first subscription
            let subscriptionDurationMonths = 0;
            try {
                const firstSub = firstSubscriptionsMap.get(studentId);
                const startDate = firstSub ? new Date(firstSub.created_at) : subData.created_at ? new Date(subData.created_at) : null;

                const endDate = subData.status === 'inactive' && subData.cancellation_date ? new Date(subData.cancellation_date) : new Date();

                if (startDate && endDate) {
                    const diffMs = endDate - startDate;
                    const diffDays = diffMs / (1000 * 60 * 60 * 24);
                    const diffInMonths = Math.ceil(diffDays / 30);
                    subscriptionDurationMonths = Math.max(diffInMonths, 0);
                }
            } catch (err) {
                console.error('Error calculating subscription duration:', err);
            }

            // Format subscription response (synchronous, using cached price)
            const priceKey = `${subData.type}_${subData.weekly_lesson}`;
            const currentPrice = priceCache.get(priceKey) || 0;

            // NEW: Parse discount data and calculate final price
            let discountInfo = null;
            let finalPrice = currentPrice;
            let discountAmount = 0;

            if (subData.discount_data) {
                try {
                    const discountData = typeof subData.discount_data === 'string' 
                        ? JSON.parse(subData.discount_data) 
                        : subData.discount_data;
                    
                    if (discountData && discountData.value > 0) {
                        discountInfo = {
                            type: discountData.type,
                            value: discountData.value,
                            reason: discountData.reason,
                            appliedBy: discountData.appliedBy,
                            appliedAt: discountData.appliedAt
                        };

                        const priceCalculation = calculateFinalPriceWithDiscount(currentPrice, discountData);
                        finalPrice = priceCalculation.finalPrice;
                        discountAmount = priceCalculation.discountAmount;
                    }
                } catch (error) {
                    console.error('Error parsing discount data in getUserPlans:', error);
                }
            }

            // Build formatted response (synchronous version of formatUserPlanResponse)
            const user = subData.SubscriptionUser;
            const offlineAdmin = subData.OfflinePaymentAdmin;

            // Parse bonus data safely (handle both string and object)
            let currentBonusReason = '';
            let bonusClassHistory = [];

            if (subData.data_of_bonus_class && subData.data_of_bonus_class !== null && subData.data_of_bonus_class !== undefined) {
                try {
                    // Handle both string and already-parsed object
                    let bonusData;
                    const bonusDataValue = subData.data_of_bonus_class;

                    if (typeof bonusDataValue === 'string' && bonusDataValue.trim() !== '') {
                        bonusData = JSON.parse(bonusDataValue);
                    } else if (Array.isArray(bonusDataValue)) {
                        bonusData = bonusDataValue;
                    } else if (typeof bonusDataValue === 'object' && bonusDataValue !== null) {
                        // If it's already an object but not an array, default to empty array
                        bonusData = [];
                    } else {
                        bonusData = [];
                    }

                    bonusClassHistory = Array.isArray(bonusData) ? bonusData : [];

                    if (bonusClassHistory.length > 0 && !bonusClassHistory[0].refresh) {
                        currentBonusReason = bonusClassHistory[0].bonus_reason || '';
                    }
                } catch (error) {
                    console.error('Error parsing bonus class data:', error, 'Value:', subData.data_of_bonus_class);
                    bonusClassHistory = [];
                }
            }

            const formatted = {
                id: subData.id,
                studentName: user?.full_name || '',
                email: user?.email || '',
                mobile: user?.mobile || '',
                country_code: user?.country_code || null,
                subscriptionType: subData.type,
                renewDate: subData.renew_date ? moment(subData.renew_date).format('DD-MM-YYYY HH:mm') : '',
                monthlyCompletedClass: subData.weekly_comp_class || 0,
                totalMonthlyClass: `${subData.weekly_lesson} lessons/month`,
                lessonPeriod: `${subData.lesson_min} min`,
                // subscriptionStatus: subData.status,
                // 🔥 PATCH: Correct status mapping
                subscriptionStatus:
                    subData.status === 'active' && subData.inactive_after_renew == 1
                        ? 'inactive_after_renew'
                        : subData.status === 'inactive' && subData.is_cancel == 1
                        ? 'inactive'
                        : subData.status === 'inactive'
                        ? 'inactive'
                        : 'active',
                leftLessons: subData.left_lessons || 0,
                weeklyLesson: subData.weekly_lesson,
                lessonMin: subData.lesson_min,
                lessonResetAt: subData.lesson_reset_at,
                userId: subData.user_id,
                paymentStatus: subData.payment_status || 'pending',
                nextMonthSubscription: user?.next_month_subscription || false,
                nextYearSubscription: user?.next_year_subscription || false,
                inactive_after_renew: subData.inactive_after_renew || 0,
                bonusClass: subData.bonus_class || 0,
                bonusCompletedClass: subData.bonus_completed_class || 0,
                bonusExpireDate: subData.bonus_expire_date ? moment(subData.bonus_expire_date).format('DD-MM-YYYY HH:mm') : null,
                bonusClassReason: currentBonusReason,
                bonusClassHistory: bonusClassHistory,
                createdAt: subData.created_at,
                updatedAt: subData.updated_at,
                currentCalculatedPrice: currentPrice,
                originalPrice: currentPrice,
                finalPrice: finalPrice,
                discountAmount: discountAmount,
                appliedDiscount: discountInfo,
                cancellation_date: subData.cancellation_date,
                cancelled_by_user_id: subData.cancelled_by_user_id,
                // cancellation_reason_category: subData.cancellation_reason_category,
                cancellation_reason_category: subData.CancellationReasonCategory ? subData.CancellationReasonCategory.name : null,
                cancellation_reason: subData.cancellation_reason,
                permanent_teacher: teacher
                    ? {
                          id: teacher.id,
                          name: teacher.full_name,
                          email: teacher.email
                      }
                    : null,
                financialOverview: {
                    totalSpent,
                    monthlyPayment,
                    paymentMethod
                },
                subscription_duration_months: subscriptionDurationMonths
            };

            // Add offline payment details if present
            if (subData.payment_status === 'offline') {
                formatted.offlinePaymentDetails = {
                    reason: subData.offline_payment_reason,
                    adminName: offlineAdmin?.full_name || 'Unknown Admin',
                    adminEmail: offlineAdmin?.email,
                    adminId: subData.offline_payment_admin_id,
                    date: subData.offline_payment_date ? moment(subData.offline_payment_date).format('DD-MM-YYYY HH:mm:ss') : null
                };
            }

            return formatted;
        });

        // ✅ OPTIMIZED: Apply filters and sorting
        let filtered = formatted;

        // Apply permanent_teacher_id filter
        if (permanent_teacher_id === 'null') {
            filtered = filtered.filter((p) => p.permanent_teacher === null);
        } else if (permanent_teacher_id && permanent_teacher_id !== 'all') {
            filtered = filtered.filter((p) => p.permanent_teacher && String(p.permanent_teacher.id) === String(permanent_teacher_id));
        }

        // Apply in-memory sorting (only for fields that require calculated data)
        if (sortBy && needsInMemorySort) {
            const dir = sortDirection === 'asc' ? 1 : -1;

            filtered.sort((a, b) => {
                switch (sortBy) {
                    case 'subscription_duration_months':
                        return dir * ((a.subscription_duration_months || 0) - (b.subscription_duration_months || 0));

                    case 'monthly_completed':
                        return dir * ((a.monthlyCompletedClass || 0) - (b.monthlyCompletedClass || 0));

                    case 'permanent_teacher':
                        return dir * (a.permanent_teacher?.name || '').localeCompare(b.permanent_teacher?.name || '');

                    default:
                        return 0;
                }
            });
        }

        // ✅ OPTIMIZED: Pagination logic
        let paginated = filtered;
        let finalTotal = total;
        
        // Only apply in-memory pagination if we fetched all records (for in-memory sorting)
        // Otherwise, data is already paginated at database level
        if (needsInMemorySort) {
            // For in-memory sorting, we need to recalculate total after filtering
            finalTotal = filtered.length;
            const start = (pageNum - 1) * pageLimit;
            const end = start + pageLimit;
            paginated = filtered.slice(start, end);
        } else {
            // For database-level sorting, data is already paginated
            // But we need to adjust total if permanent_teacher_id filter was applied
            // Note: This is an approximation - for exact count with filter, we'd need another query
            // For now, we'll use the original total as the filter is applied post-pagination
        }

        // Removed debug log for production

        return res.status(200).json({
            status: 'success',
            data: paginated,
            pagination: {
                total: finalTotal,
                page: pageNum,
                limit: pageLimit,
                pages: Math.ceil(finalTotal / pageLimit)
            },
            message: 'User plans retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching user plans:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const exportUserPlansCSV = async (req, res) => {
    try {
        const {
            keyword,
            subscription_type,
            status = "all",
            payment_status,
            date_from,
            date_to,
            permanent_teacher_id,
            sortBy,
            sortDirection = "asc",
        } = req.query;

        // ----------------------------------------
        //  SAME FILTERS AS getUserPlans
        // ----------------------------------------
        const subscriptionWhere = {};

        if (status === "inactive_after_renew") {
            subscriptionWhere.inactive_after_renew = 1;
        } else if (status !== "all") {
            subscriptionWhere.status = status;
        }

        if (subscription_type && subscription_type !== "all") {
            subscriptionWhere.type = subscription_type;
        }

        if (payment_status && payment_status !== "all") {
            subscriptionWhere.payment_status = payment_status;
        }

        if (date_from && date_to) {
            subscriptionWhere.created_at = {
                [Op.between]: [new Date(date_from), new Date(date_to)],
            };
        }

        const userWhere = {};
        if (keyword) {
            userWhere[Op.or] = [
                { full_name: { [Op.like]: `%${keyword}%` } },
                { email: { [Op.like]: `%${keyword}%` } },
                { mobile: { [Op.like]: `%${keyword}%` } },
            ];
        }

        // ----------------------------------------
        //  FETCH ALL PLANS (NO PAGINATION)
        // ----------------------------------------
        const rawData = await UserSubscriptionDetails.findAll({
            where: subscriptionWhere,
            include: [
                {
                    model: User,
                    as: "SubscriptionUser",
                    where: userWhere,
                    attributes: [
                        "id",
                        "full_name",
                        "email",
                        "mobile",
                        "country_code",
                        "status",
                        "next_month_subscription",
                        "next_year_subscription",
                    ],
                },
            ],
            order: [["id", "DESC"]],
        });

        if (!rawData.length) {
            return res.status(404).json({
                success: false,
                message: "No data available for export",
            });
        }

        // ----------------------------------------
        //  OPTIMIZED: Batch fetch all related data (same as getUserPlans)
        // ----------------------------------------
        const studentIds = rawData
            .map(sub => sub.user_id || sub.SubscriptionUser?.id)
            .filter(Boolean);

        if (studentIds.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No data available for export",
            });
        }

        // Batch fetch all RegularClasses for active subscriptions
        const activeStudentIds = rawData
            .filter(sub => sub.status === 'active')
            .map(sub => sub.user_id || sub.SubscriptionUser?.id)
            .filter(Boolean);

        const regularClassesMap = new Map();
        if (activeStudentIds.length > 0) {
            const regularClasses = await RegularClass.findAll({
                where: { student_id: { [Op.in]: activeStudentIds } },
                attributes: ['id', 'student_id', 'teacher_id', 'created_at'],
                order: [['created_at', 'DESC']],
                raw: true
            });

            regularClasses.forEach(rc => {
                if (!regularClassesMap.has(rc.student_id)) {
                    regularClassesMap.set(rc.student_id, rc);
                }
            });
        }

        // Batch fetch all latest Classes
        const allLatestClasses = await Class.findAll({
            where: { student_id: { [Op.in]: studentIds } },
            attributes: ['id', 'student_id', 'teacher_id', 'created_at'],
            order: [['created_at', 'DESC']],
            raw: true
        });

        const latestClassMap = new Map();
        allLatestClasses.forEach(cls => {
            if (!latestClassMap.has(cls.student_id)) {
                latestClassMap.set(cls.student_id, cls);
            }
        });

        // Collect all teacher IDs
        const teacherIds = new Set();
        regularClassesMap.forEach(rc => {
            if (rc.teacher_id) teacherIds.add(rc.teacher_id);
        });
        latestClassMap.forEach(cls => {
            if (cls.teacher_id) teacherIds.add(cls.teacher_id);
        });

        // Batch fetch all teachers
        const teachersMap = new Map();
        if (teacherIds.size > 0) {
            const teachers = await User.findAll({
                where: { id: { [Op.in]: Array.from(teacherIds) } },
                attributes: ['id', 'full_name', 'email'],
                raw: true
            });
            teachers.forEach(teacher => {
                teachersMap.set(teacher.id, teacher);
            });
        }

        // Batch fetch all payment transactions
        const userEmails = rawData
            .map(sub => sub.SubscriptionUser?.email)
            .filter(Boolean);

        const transactionsByEmail = new Map();
        if (userEmails.length > 0) {
            const allTransactions = await PaymentTransaction.findAll({
                where: {
                    student_email: { [Op.in]: userEmails },
                    // status: 'success'
                    status: { [Op.in]: ['success', 'refunded'] }
                },
                attributes: ['student_email', 'amount', 'is_recurring', 'payment_method', 'card_last_digits', 'created_at'],
                order: [['created_at', 'DESC']],
                raw: true
            });

            allTransactions.forEach(tx => {
                if (!transactionsByEmail.has(tx.student_email)) {
                    transactionsByEmail.set(tx.student_email, []);
                }
                transactionsByEmail.get(tx.student_email).push(tx);
            });
        }

        // Batch fetch first subscriptions
        const firstSubscriptionsMap = new Map();
        const firstSubs = await UserSubscriptionDetails.findAll({
            where: { user_id: { [Op.in]: studentIds } },
            attributes: ['user_id', 'created_at'],
            order: [['created_at', 'ASC']],
            raw: true
        });

        firstSubs.forEach(sub => {
            if (!firstSubscriptionsMap.has(sub.user_id)) {
                firstSubscriptionsMap.set(sub.user_id, sub);
            }
        });

        // Cache price calculations
        const priceCache = new Map();
        const uniquePriceKeys = new Set(
            rawData.map(sub => `${sub.type}_${sub.weekly_lesson}`)
        );

        await Promise.all(
            Array.from(uniquePriceKeys).map(async (key) => {
                const [type, lessons] = key.split('_');
                const result = await calculateSubscriptionPrice(type, parseInt(lessons));
                priceCache.set(key, result.price);
            })
        );

        // ----------------------------------------
        //  FORMAT USING PRE-FETCHED DATA (no more DB queries)
        // ----------------------------------------
        const formatted = rawData.map((sub) => {
            const d = sub.toJSON();
            const studentId = d.user_id || d.SubscriptionUser?.id;

            // Find teacher using pre-fetched data
            let teacher = null;
            try {
                if (studentId) {
                    if (d.status === "active") {
                        const reg = regularClassesMap.get(studentId);
                        if (reg && reg.teacher_id) {
                            teacher = teachersMap.get(reg.teacher_id);
                        }

                        if (!teacher) {
                            const lastCls = latestClassMap.get(studentId);
                            if (lastCls && lastCls.teacher_id) {
                                teacher = teachersMap.get(lastCls.teacher_id);
                            }
                        }
                    } else {
                        const lastCls = latestClassMap.get(studentId);
                        if (lastCls && lastCls.teacher_id) {
                            teacher = teachersMap.get(lastCls.teacher_id);
                        }
                    }
                }
            } catch (err) {}

            // Calculate financial info using pre-fetched transactions
            let totalSpent = 0;
            let monthlyPayment = 0;
            let paymentMethod = "Manual / Offline";

            try {
                const userEmail = d.SubscriptionUser?.email;
                if (userEmail) {
                    const tx = transactionsByEmail.get(userEmail) || [];
                    if (tx.length > 0) {
                        totalSpent = tx.reduce(
                            (s, t) => s + parseFloat(t.amount || 0),
                            0
                        );
                        const recurring = tx.find((t) => t.is_recurring);
                        monthlyPayment = recurring
                            ? parseFloat(recurring.amount || 0)
                            : parseFloat(tx[0].amount || 0);

                        const last = tx[0];
                        if (last.payment_method) {
                            paymentMethod = last.card_last_digits
                                ? `${last.payment_method} (${last.card_last_digits})`
                                : last.payment_method;
                        }
                    }
                }
            } catch {}

            // Calculate duration using pre-fetched first subscription
            let durationMonths = 0;
            try {
                const firstSub = firstSubscriptionsMap.get(studentId);
                const startDate = firstSub
                    ? new Date(firstSub.created_at)
                    : new Date(d.created_at);

                const endDate =
                    d.status === "inactive" && d.cancellation_date
                        ? new Date(d.cancellation_date)
                        : new Date();

                durationMonths = Math.ceil(
                    (endDate - startDate) / (1000 * 60 * 60 * 24 * 30)
                );
            } catch {}

            // Build formatted response (synchronous, using cached price)
            const priceKey = `${d.type}_${d.weekly_lesson}`;
            const currentPrice = priceCache.get(priceKey) || 0;

            const user = d.SubscriptionUser;
            let currentBonusReason = '';
            let bonusClassHistory = [];
            
            if (d.data_of_bonus_class && d.data_of_bonus_class !== null && d.data_of_bonus_class !== undefined) {
                try {
                    // Handle both string and already-parsed object
                    let bonusData;
                    const bonusDataValue = d.data_of_bonus_class;
                    
                    if (typeof bonusDataValue === 'string' && bonusDataValue.trim() !== '') {
                        bonusData = JSON.parse(bonusDataValue);
                    } else if (Array.isArray(bonusDataValue)) {
                        bonusData = bonusDataValue;
                    } else if (typeof bonusDataValue === 'object' && bonusDataValue !== null) {
                        // If it's already an object but not an array, default to empty array
                        bonusData = [];
                    } else {
                        bonusData = [];
                    }
                    
                    bonusClassHistory = Array.isArray(bonusData) ? bonusData : [];
                    
                    if (bonusClassHistory.length > 0 && !bonusClassHistory[0].refresh) {
                        currentBonusReason = bonusClassHistory[0].bonus_reason || '';
                    }
                } catch (error) {
                    console.error('Error parsing bonus class data in CSV export:', error, 'Value:', d.data_of_bonus_class);
                    bonusClassHistory = [];
                }
            }

            const plan = {
                id: d.id,
                studentName: user?.full_name || '',
                email: user?.email || '',
                mobile: user?.mobile || '',
                country_code: user?.country_code || null,
                subscriptionType: d.type,
                renewDate: d.renew_date ? moment(d.renew_date).format('DD-MM-YYYY HH:mm') : '',
                monthlyCompletedClass: d.weekly_comp_class || 0,
                totalMonthlyClass: `${d.weekly_lesson} lessons/month`,
                lessonPeriod: `${d.lesson_min} min`,
                subscriptionStatus: d.status,
                leftLessons: d.left_lessons || 0,
                weeklyLesson: d.weekly_lesson,
                lessonMin: d.lesson_min,
                lessonResetAt: d.lesson_reset_at,
                userId: d.user_id,
                paymentStatus: d.payment_status || 'pending',
                nextMonthSubscription: user?.next_month_subscription || false,
                nextYearSubscription: user?.next_year_subscription || false,
                inactive_after_renew: d.inactive_after_renew || 0,
                bonusClass: d.bonus_class || 0,
                bonusCompletedClass: d.bonus_completed_class || 0,
                bonusExpireDate: d.bonus_expire_date ? moment(d.bonus_expire_date).format('DD-MM-YYYY HH:mm') : null,
                bonusClassReason: currentBonusReason,
                bonusClassHistory: bonusClassHistory,
                createdAt: d.created_at,
                updatedAt: d.updated_at,
                currentCalculatedPrice: currentPrice,
                cancellation_date: d.cancellation_date,
                cancelled_by_user_id: d.cancelled_by_user_id,
                cancellation_reason_category: d.cancellation_reason_category,
                cancellation_reason: d.cancellation_reason,
                permanent_teacher: teacher
                    ? {
                          id: teacher.id,
                          name: teacher.full_name,
                          email: teacher.email,
                      }
                    : null,
                financialOverview: {
                    totalSpent,
                    monthlyPayment,
                    paymentMethod,
                },
                subscription_duration_months: durationMonths
            };

            return plan;
        });

        // ----------------------------------------
        //  APPLY teacher filter
        // ----------------------------------------
        let filtered = formatted;

        if (permanent_teacher_id === "null") {
            filtered = filtered.filter((p) => p.permanent_teacher === null);
        } else if (
            permanent_teacher_id &&
            permanent_teacher_id !== "all"
        ) {
            filtered = filtered.filter(
                (p) =>
                    p.permanent_teacher &&
                    String(p.permanent_teacher.id) ===
                        String(permanent_teacher_id)
            );
        }

        // ----------------------------------------
        //  SORT EXACTLY LIKE getUserPlans
        // ----------------------------------------
        if (sortBy) {
            const dir = sortDirection === "asc" ? 1 : -1;

            filtered.sort((a, b) => {
                switch (sortBy) {
                    case "student_name":
                        return dir * a.studentName.localeCompare(b.studentName);
                    case "subscription_details":
                        return (
                            dir *
                            (a.subscriptionType || "").localeCompare(
                                b.subscriptionType || ""
                            )
                        );
                    case "renew_date":
                        return (
                            dir *
                            (new Date(a.renewDate) - new Date(b.renewDate))
                        );
                    case "subscription_duration_months":
                        return (
                            dir *
                            ((a.subscription_duration_months || 0) -
                                (b.subscription_duration_months || 0))
                        );
                    case "monthly_completed":
                        return (
                            dir *
                            ((a.monthlyCompletedClass || 0) -
                                (b.monthlyCompletedClass || 0))
                        );
                    case "permanent_teacher":
                        return (
                            dir *
                            (a.permanent_teacher?.name || "").localeCompare(
                                b.permanent_teacher?.name || ""
                            )
                        );
                    default:
                        return 0;
                }
            });
        }

        // ----------------------------------------
        //  BUILD CSV
        // ----------------------------------------
        const headers = [
            "Student Name",
            "Email",
            "Subscription Details",
            "Permanent Teacher",
            "Duration (Months Active)",
            "Total Spent",
            "Monthly Payment",
            "Payment Method",
            "Cancellation Date",
            "Cancellation Reason",
            "Subscription Status",
        ];

        const rows = [headers];

        filtered.forEach((p) => {
            const subscriptionDetails = `${p.subscriptionType} • ${p.lessonMin} min • ${p.weeklyLesson} lessons/month`;

            rows.push([
                p.studentName || "N/A",
                p.email || "N/A",
                subscriptionDetails,
                p.permanent_teacher?.name || "N/A",
                p.subscription_duration_months || 0,
                p.financialOverview.totalSpent?.toFixed(2) || "0.00",
                p.financialOverview.monthlyPayment?.toFixed(2) || "0.00",
                p.financialOverview.paymentMethod || "N/A",
                p.cancellation_date
                    ? moment(p.cancellation_date).format("YYYY-MM-DD")
                    : "N/A",
                p.cancellation_reason || "N/A",
                p.subscriptionStatus || "active",
            ]);
        });

        const csv = rows.map((r) => r.join(",")).join("\n");

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=user-plans-${moment().format("YYYY-MM-DD-HHmm")}.csv`
        );
        return res.send("\uFEFF" + csv);
    } catch (err) {
        console.error("CSV Export Error:", err);
        return res.status(500).json({
            success: false,
            message: err.message,
        });
    }
};

/**
 * Get user plan by ID with offline payment details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getUserPlanById = async (req, res) => {
    try {
        const { id } = req.params;

        const userSubscription = await UserSubscriptionDetails.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_id', 'status', 'created_at', 'next_month_subscription', 'next_year_subscription']
                },
                {
                    model: User,
                    as: 'OfflinePaymentAdmin',
                    attributes: ['id', 'full_name', 'email'],
                    required: false
                }
            ]
        });

        if (!userSubscription) {
            return res.status(404).json({
                status: 'error',
                message: 'User plan not found'
            });
        }

        // Get additional statistics
        const stats = await getUserPlanStats(userSubscription.user_id, userSubscription.id);

        const formattedSubscription = await formatUserPlanResponse(userSubscription);
        formattedSubscription.stats = stats;

        // Get actual recurring payment amount from PayPlus (if online payment)
        if (userSubscription.payment_status === 'online') {
            try {
                // Find active recurring payment for this subscription
                // First try with subscription_id, then fallback to student_id only
                let activeRecurringPayment = await RecurringPayment.findOne({
                    where: {
                        student_id: userSubscription.user_id,
                        subscription_id: userSubscription.id,
                        status: { [Op.in]: ['pending', 'paid'] },
                        is_active: true
                    },
                    order: [['created_at', 'DESC']]
                });

                // If not found with subscription_id, try with student_id only
                if (!activeRecurringPayment) {
                    console.log(`⚠️ No recurring payment found with subscription_id ${userSubscription.id}, trying with student_id only`);
                    activeRecurringPayment = await RecurringPayment.findOne({
                        where: {
                            student_id: userSubscription.user_id,
                            status: { [Op.in]: ['pending', 'paid'] },
                            is_active: true
                        },
                        order: [['created_at', 'DESC']]
                    });
                }

                if (activeRecurringPayment && activeRecurringPayment.amount) {
                    // Use the amount directly from RecurringPayment (this is the amount sent to PayPlus)
                    const actualRecurringAmount = parseFloat(activeRecurringPayment.amount || 0);

                    // Get pricing info from new pricing_info field (stored when PayPlus was updated)
                    let storedPricingInfo = null;
                    if (activeRecurringPayment.pricing_info) {
                        try {
                            storedPricingInfo = typeof activeRecurringPayment.pricing_info === 'string' 
                                ? JSON.parse(activeRecurringPayment.pricing_info) 
                                : activeRecurringPayment.pricing_info;
                        } catch (error) {
                            console.error('Error parsing pricing_info:', error);
                        }
                    }

                    console.log(`🔍 Found recurring payment:`, {
                        id: activeRecurringPayment.id,
                        amount: actualRecurringAmount,
                        subscription_id: activeRecurringPayment.subscription_id,
                        hasStoredPricingInfo: !!storedPricingInfo,
                        calculatedPrice: formattedSubscription.finalPrice,
                        originalPrice: formattedSubscription.originalPrice
                    });

                    // Always use the actual PayPlus amount if it exists and is greater than 0
                    if (actualRecurringAmount > 0) {
                        formattedSubscription.actualRecurringAmount = actualRecurringAmount;
                        formattedSubscription.finalPrice = actualRecurringAmount; // Use actual PayPlus amount
                        
                        // Use stored pricing info if available (from when PayPlus was updated)
                        if (storedPricingInfo) {
                            formattedSubscription.originalPrice = parseFloat(storedPricingInfo.original_price || formattedSubscription.originalPrice);
                            formattedSubscription.discountAmount = parseFloat(storedPricingInfo.discount_amount || 0);
                            
                            // Use stored discount info if available
                            if (storedPricingInfo.discount && storedPricingInfo.discount.value > 0) {
                                formattedSubscription.appliedDiscount = {
                                    type: storedPricingInfo.discount.type,
                                    value: storedPricingInfo.discount.value,
                                    reason: storedPricingInfo.discount.reason || formattedSubscription.appliedDiscount?.reason,
                                    appliedBy: storedPricingInfo.discount.appliedBy || formattedSubscription.appliedDiscount?.appliedBy,
                                    appliedAt: storedPricingInfo.discount.appliedAt || formattedSubscription.appliedDiscount?.appliedAt
                                };
                            }
                            
                            console.log(`✅ Using stored pricing info from PayPlus update:`);
                            console.log(`   Original Price: ${formattedSubscription.originalPrice} ILS`);
                            console.log(`   Final Price: ${actualRecurringAmount} ILS`);
                            console.log(`   Discount Amount: ${formattedSubscription.discountAmount} ILS`);
                        } else {
                            // Fallback: Recalculate discount amount if discount exists
                            if (formattedSubscription.appliedDiscount && formattedSubscription.appliedDiscount.value > 0) {
                                formattedSubscription.discountAmount = formattedSubscription.originalPrice - actualRecurringAmount;
                            }
                            console.log(`✅ Using actual PayPlus recurring amount: ${actualRecurringAmount} ILS (calculated original: ${formattedSubscription.originalPrice} ILS)`);
                        }
                    }
                } else {
                    console.log(`⚠️ No active recurring payment found for user ${userSubscription.user_id}, subscription ${userSubscription.id}`);
                    
                    // Fallback: Check PaymentTransaction for latest recurring payment amount
                    try {
                        const latestRecurringTransaction = await PaymentTransaction.findOne({
                            where: {
                                student_id: userSubscription.user_id,
                                is_recurring: true,
                                status: 'success'
                            },
                            order: [['created_at', 'DESC']],
                            attributes: ['amount']
                        });

                        if (latestRecurringTransaction && latestRecurringTransaction.amount) {
                            const transactionAmount = parseFloat(latestRecurringTransaction.amount || 0);
                            if (transactionAmount > 0 && transactionAmount !== formattedSubscription.finalPrice) {
                                console.log(`💰 Using amount from latest PaymentTransaction: ${transactionAmount} ILS`);
                                formattedSubscription.actualRecurringAmount = transactionAmount;
                                formattedSubscription.finalPrice = transactionAmount;
                                
                                if (formattedSubscription.appliedDiscount && formattedSubscription.appliedDiscount.value > 0) {
                                    formattedSubscription.discountAmount = formattedSubscription.originalPrice - transactionAmount;
                                }
                            }
                        }
                    } catch (txError) {
                        console.error('Error fetching from PaymentTransaction:', txError);
                    }
                }
            } catch (error) {
                console.error('❌ Error fetching recurring payment amount:', error);
                // Continue with calculated price if error occurs
            }
        }

        return res.status(200).json({
            status: 'success',
            data: formattedSubscription
        });
    } catch (error) {
        console.error('Error fetching user plan details:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Create a new user plan with payment status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createUserPlan = async (req, res) => {
    const dbTransaction = await UserSubscriptionDetails.sequelize.transaction();

    try {
        const {
            user_id,
            type,
            weekly_lesson,
            lesson_min,
            status = 'active',
            next_month_subscription = false,
            next_year_subscription = false,
            payment_status = 'offline', // Default to offline as per UI
            offline_payment_reason,
            applied_discount // NEW: Discount field
        } = req.body;

        // Basic validation
        if (!user_id || !type || !weekly_lesson) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'User ID, subscription type, and weekly lessons are required'
            });
        }

        // Validate offline payment (now always required since default is offline)
        if (!offline_payment_reason || offline_payment_reason.trim() === '') {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Offline payment reason is required'
            });
        }

        // Check if user exists
        const user = await User.findByPk(user_id, { transaction: dbTransaction });
        if (!user) {
            await dbTransaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        // Get old subscription data for carryover calculation
        const oldSubscription = await UserSubscriptionDetails.findOne({
            where: { user_id },
            order: [['id', 'DESC']],
            transaction: dbTransaction
        });

        let leftLessonData = 0;
        if (oldSubscription && (next_month_subscription || next_year_subscription)) {
            leftLessonData = oldSubscription.left_lessons || 0;
        }

        // Set lesson duration based on subscription type
        let lessonDuration = lesson_min;
        if (!lessonDuration) {
            if (type === 'Monthly_55') lessonDuration = 55;
            else if (type === 'Monthly_40') lessonDuration = 40;
            else lessonDuration = 25;
        }

        // Calculate renewal date and lesson reset date
        const renewDate = calculateRenewDate(type);
        const lessonResetAt = moment().add(1, 'month').toDate();

        // Calculate left lessons
        let leftLessons = parseInt(weekly_lesson);

        // If there's an old subscription, check for pending lessons
        if (oldSubscription && moment().add(1, 'month').startOf('day').isAfter(moment(oldSubscription.lesson_reset_at))) {
            const pendingLessonsCount = await Class.count({
                where: {
                    student_id: user_id,
                    meeting_start: {
                        [Op.gt]: oldSubscription.lesson_reset_at,
                        [Op.lt]: lessonResetAt
                    },
                    status: 'pending'
                },
                transaction: dbTransaction
            });
            leftLessons = leftLessons - pendingLessonsCount;
        }

        leftLessons = leftLessons + leftLessonData;

        // Deactivate old subscriptions
        await UserSubscriptionDetails.update(
            { status: 'inactive' },
            {
                where: { user_id },
                transaction: dbTransaction
            }
        );

        // Handle negative lessons by canceling classes
        if (leftLessons < 0) {
            const classesToCancel = await Class.findAll({
                where: { student_id: user_id },
                order: [['meeting_start', 'DESC']],
                limit: Math.abs(leftLessons),
                transaction: dbTransaction
            });

            for (const classItem of classesToCancel) {
                await classItem.update(
                    {
                        status: 'canceled',
                        cancelled_by: req.user?.id || null,
                        cancellation_reason: 'Lesson canceled by admin due to subscription change',
                        cancelled_at: new Date()
                    },
                    { transaction: dbTransaction }
                );
            }
            leftLessons = 0;
        }

        try {
            if (!oldSubscription) {
                const referralRecord = await Referral.findOne({
                    where: { referee_id: user_id },
                    transaction: dbTransaction
                });
                if (referralRecord && referralRecord.referrer_id) {
                    // Determine current tier for the referrer based on previously rewarded referrals
                    const rewardedCount = await Referral.count({
                        where: {
                            referrer_id: referralRecord.referrer_id,
                            status: 'rewarded'
                        },
                        transaction: dbTransaction
                    });
                    const currentTier = await ReferralTier.findOne({
                        where: {
                            min_referrals: { [Op.lte]: rewardedCount },
                            max_referrals: { [Op.gte]: rewardedCount },
                            is_active: true
                        },
                        order: [['tier_level', 'ASC']],
                        transaction: dbTransaction
                    });

                    const referrerActiveSub = await UserSubscriptionDetails.findOne({
                        where: { user_id: referralRecord.referrer_id, status: 'active' },
                        order: [['id', 'DESC']],
                        transaction: dbTransaction
                    });
                    if (referrerActiveSub && currentTier) {
                        const now = new Date();
                        const referrerType = currentTier.referrer_reward_type;
                        const referrerValue = parseInt(currentTier.referrer_reward_value || 0);
                        if (referrerType === 'free_lessons' && referrerValue > 0) {
                            await referrerActiveSub.update({
                                left_lessons: (referrerActiveSub.left_lessons || 0) + referrerValue,
                                updated_at: now
                            }, { transaction: dbTransaction });
                        } else if (referrerType === 'free_months' && referrerValue > 0) {
                            const baseRenew = referrerActiveSub.renew_date ? moment(referrerActiveSub.renew_date) : moment();
                            await referrerActiveSub.update({
                                renew_date: baseRenew.add(referrerValue, 'months').toDate(),
                                // Add lessons equal to plan lessons per month × free months
                                left_lessons: (referrerActiveSub.left_lessons || 0) + ((referrerActiveSub.weekly_lesson || 0) * referrerValue),
                                updated_at: now
                            }, { transaction: dbTransaction });
                        }
                    }

                    // Apply referee reward to the NEW subscription being created
                    if (currentTier) {
                        const refereeType = currentTier.referee_reward_type;
                        const refereeValue = parseInt(currentTier.referee_reward_value || 0);
                        if (refereeType === 'free_lessons' && refereeValue > 0) {
                            leftLessons = (leftLessons || 0) + refereeValue;
                        } else if (refereeType === 'free_months' && refereeValue > 0) {
                            // Extend the new subscription's renew date
                            renewDate = moment(renewDate).add(refereeValue, 'months').toDate();
                            // Add lessons equal to plan lessons per month × free months
                            const perMonthLessons = parseInt(weekly_lesson) || 0;
                            leftLessons = (leftLessons || 0) + (perMonthLessons * refereeValue);
                        }
                    }
                    // Mark referral as rewarded
                    try {
                        await referralRecord.update({ status: 'rewarded' }, { transaction: dbTransaction });
                    } catch (statusErr) {
                        console.error('Error updating referral status to rewarded:', statusErr);
                    }

                    // Create a granted reward entry for the referrer (tier-based)
                    try {
                        const nowSec = Math.floor(Date.now() / 1000);
                        if (currentTier) {
                            await ReferralReward.create({
                                referral_id: referralRecord.id,
                                user_id: referralRecord.referrer_id,
                                user_type: 'referrer',
                                reward_type: currentTier.referrer_reward_type,
                                reward_value: currentTier.referrer_reward_value,
                                tier_level: currentTier.tier_level,
                                status: 'granted',
                                created_at: nowSec,
                                granted_at: nowSec
                            }, { transaction: dbTransaction });
                            // Referee reward record
                            await ReferralReward.create({
                                referral_id: referralRecord.id,
                                user_id: referralRecord.referee_id,
                                user_type: 'referee',
                                reward_type: currentTier.referee_reward_type,
                                reward_value: currentTier.referee_reward_value,
                                tier_level: currentTier.tier_level,
                                status: 'granted',
                                created_at: nowSec,
                                granted_at: nowSec
                            }, { transaction: dbTransaction });
                        }
                    } catch (rewardErr) {
                        console.error('Error creating referral reward for referrer:', rewardErr);
                    }
                }
            }
        } catch (referralError) {
            console.error('Error crediting referrer bonus lesson:', referralError);
        }

        // NEW: Handle discount data
        let discountData = null;
        if (applied_discount && applied_discount.value > 0) {
            // Validate discount
            if (!applied_discount.reason || applied_discount.reason.trim() === '') {
                await dbTransaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Discount reason is required when applying a discount'
                });
            }

            if (applied_discount.type === 'percentage' && applied_discount.value > 100) {
                await dbTransaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Percentage discount cannot exceed 100%'
                });
            }

            // Calculate original price to validate fixed discount
            const priceResult = await calculateSubscriptionPrice(type, parseInt(weekly_lesson));
            const originalPrice = priceResult.price;
            if (applied_discount.type === 'fixed' && applied_discount.value > originalPrice) {
                await dbTransaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Fixed discount cannot exceed the original price'
                });
            }

            discountData = {
                type: applied_discount.type,
                value: parseFloat(applied_discount.value),
                reason: applied_discount.reason.trim(),
                appliedBy: req.user?.id || null,
                appliedAt: new Date().toISOString()
            };
        }

        // NEW: Find matching subscription plan and store plan_id (same as payment link generation)
        const priceResult = await calculateSubscriptionPrice(type, parseInt(weekly_lesson));
        const planId = priceResult.planId;

        // Prepare subscription data
        const subscriptionData = {
            user_id,
            type,
            weekly_lesson: parseInt(weekly_lesson),
            lesson_min: lessonDuration,
            status,
            renew_date: renewDate,
            lesson_reset_at: lessonResetAt,
            left_lessons: leftLessons,
            weekly_comp_class: 0,
            payment_status,
            offline_payment_reason: offline_payment_reason.trim(),
            offline_payment_admin_id: req.user?.id || null,
            offline_payment_date: new Date(),
            discount_data: discountData ? JSON.stringify(discountData) : null,
            plan_id: planId, // Store plan_id for future reference (same as payment link generation)
            created_at: new Date(),
            updated_at: new Date()
        };

        // Create new subscription
        const newSubscription = await UserSubscriptionDetails.create(subscriptionData, { transaction: dbTransaction });

        // Update user subscription info and rollover settings
        const userUpdateData = {
            subscription_type: type,
            trial_expired: true,
            subscription_id: newSubscription.id,
            next_month_subscription: next_month_subscription,
            next_year_subscription: next_year_subscription
        };

        await User.update(userUpdateData, {
            where: { id: user_id },
            transaction: dbTransaction
        });

        await dbTransaction.commit();

        console.log(`✅ User plan created successfully for user ${user_id} with rollover settings: next_month=${next_month_subscription}, next_year=${next_year_subscription}`);

        // Fetch the created subscription with user details for proper response
        const createdSubscription = await UserSubscriptionDetails.findByPk(newSubscription.id, {
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_id', 'status', 'next_month_subscription', 'next_year_subscription']
                },
                {
                    model: User,
                    as: 'OfflinePaymentAdmin',
                    attributes: ['id', 'full_name', 'email'],
                    required: false
                }
            ]
        });

        return res.status(201).json({
            status: 'success',
            data: await formatUserPlanResponse(createdSubscription),
            message: 'User plan created successfully'
        });
    } catch (error) {
        await dbTransaction.rollback();
        console.error('Error creating user plan:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update user plan with offline payment support and recurring payment management
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateUserPlan = async (req, res) => {
    const dbTransaction = await UserSubscriptionDetails.sequelize.transaction();

    try {
        const { id } = req.params;
        const {
            type,
            weekly_lesson,
            lesson_min,
            status,
            renew_date,
            lesson_reset_at,
            left_lessons,
            weekly_comp_class = 0,
            next_month_subscription = false,
            next_year_subscription = false,
            payment_status,
            offline_payment_reason,
            bonus_class = 0,
            bonus_expire_date,
            bonus_class_reason = '', // New field for bonus reason
            cancellation_reason_category_id,
            cancellation_reason,
            cancelled_by_user_id,
            cancellation_type,
            manual_renewal_date, // NEW
            applied_discount // NEW: Discount field
        } = req.body;

        console.log('req.body', req.body);

        const subscription = await UserSubscriptionDetails.findByPk(id, { transaction: dbTransaction });

        if (!subscription) {
            await dbTransaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'User plan not found'
            });
        }

        // Enhanced bonus class validation with reason
        if (bonus_class > 0) {
            if (!bonus_expire_date) {
                await dbTransaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Bonus expire date is required when bonus class is greater than 0'
                });
            }

            if (!bonus_class_reason || bonus_class_reason.trim() === '') {
                await dbTransaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Bonus class reason is required when bonus class is greater than 0'
                });
            }
        }

        // Store original status for recurring payment logic
        const originalStatus = subscription.status;
        const newStatus = status || originalStatus;

        // Validate offline payment if status is being changed to offline
        if (payment_status === 'offline') {
            if (!offline_payment_reason || offline_payment_reason.trim() === '') {
                await dbTransaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Offline payment reason is required when payment status is offline'
                });
            }
        }

        // NEW: HANDLE PAST DUE PAYMENTS WHEN SUBSCRIPTION IS CANCELLED
        let pastDueHandlingResult = null;

        if (originalStatus === 'active' && (newStatus === 'inactive' || newStatus === 'inactive_after_renew')) {
            // Find all active past due payments for this user
            const activePastDuePayments = await PastDuePayment.findAll({
                where: {
                    user_id: subscription.user_id,
                    subscription_id: subscription.id,
                    status: 'past_due'
                },
                transaction: dbTransaction
            });

            if (activePastDuePayments.length > 0) {
                const cancelledPaymentIds = [];
                const disabledDunningIds = [];

                for (const pastDuePayment of activePastDuePayments) {
                    try {
                        // Update past due payment status to canceled
                        const cancelNote = `[${new Date().toISOString()}] Automatically cancelled due to subscription cancellation by admin. ${
                            cancellation_reason ? 'Reason: ' + cancellation_reason : ''
                        }`;

                        await pastDuePayment.update(
                            {
                                status: 'canceled',
                                canceled_at: new Date(),
                                notes: `${pastDuePayment.notes || ''}\n${cancelNote}`
                            },
                            { transaction: dbTransaction }
                        );

                        cancelledPaymentIds.push(pastDuePayment.id);

                        // Disable associated dunning schedule
                        const dunningSchedule = await DunningSchedule.findOne({
                            where: { past_due_payment_id: pastDuePayment.id },
                            transaction: dbTransaction
                        });

                        if (dunningSchedule) {
                            await dunningSchedule.update(
                                {
                                    is_enabled: false,
                                    is_paused: true,
                                    next_reminder_at: null,
                                    paused_reason: `Subscription cancelled by admin. ${cancellation_reason || ''}`
                                },
                                { transaction: dbTransaction }
                            );

                            disabledDunningIds.push(dunningSchedule.id);
                        }
                    } catch (error) {
                        console.error(`❌ Error processing past due payment ${pastDuePayment.id}:`, error);
                    }
                }

                pastDueHandlingResult = {
                    cancelled_payments: cancelledPaymentIds.length,
                    disabled_dunning_schedules: disabledDunningIds.length,
                    payment_ids: cancelledPaymentIds,
                    dunning_ids: disabledDunningIds
                };
            } else {
                pastDueHandlingResult = {
                    cancelled_payments: 0,
                    disabled_dunning_schedules: 0,
                    message: 'No active past due payments found'
                };
            }
        }

        // Handle recurring payment cancellation/reactivation based on status changes
        let recurringPaymentResult = null;

        if (originalStatus === 'active' && (newStatus === 'inactive' || newStatus === 'inactive_after_renew')) {
            // Cancel recurring payments when subscription becomes inactive
            console.log(`🔄 Subscription ${id} status changing from active to ${newStatus} - cancelling recurring payments`);

            recurringPaymentResult = await cancelUserRecurringPayments(
                subscription.user_id,
                `Subscription status changed to ${newStatus} by admin. ${cancellation_reason ? 'Reason: ' + cancellation_reason : ''}`,
                req.user?.id || cancelled_by_user_id || null,
                dbTransaction
            );

            console.log(`Recurring payment cancellation result:`, recurringPaymentResult);

            // ONLY cancel classes for IMMEDIATE cancellation (status = 'inactive')
            // NOT for end-of-month cancellation (status = 'inactive_after_renew')
            if (newStatus === 'inactive') {
                console.log(`Cancelling pending classes and regular schedules for immediate cancellation of subscription ${id}`);

                try {
                    // Get student info for logging
                    const student = await User.findByPk(subscription.user_id, {
                        attributes: ['id', 'full_name'],
                        transaction: dbTransaction
                    });

                    // Cancel all pending future classes
                    const cancelledClassesCount = await Class.update(
                        {
                            status: 'canceled',
                            canceled_by: 'Admin',
                            cancel_reason: cancellation_reason ? `Subscription inactivated immediately by admin. Reason: ${cancellation_reason}` : `Subscription inactivated immediately by admin`,
                            updated_at: Math.floor(Date.now() / 1000)
                        },
                        {
                            where: {
                                student_id: subscription.user_id,
                                meeting_start: {
                                    [Op.gt]: new Date()
                                },
                                status: 'pending'
                            },
                            transaction: dbTransaction
                        }
                    );

                    console.log(`Cancelled ${cancelledClassesCount[0] || 0} pending classes for immediate cancellation`);

                    // Get classes before deletion for logging
                    const regularClassesToDelete = await RegularClass.findAll({
                        where: { student_id: subscription.user_id },
                        attributes: ['id', 'student_id', 'teacher_id', 'day', 'start_time'],
                        transaction: dbTransaction
                    });

                    const hiddenClassesToDelete = await Class.findAll({
                        where: {
                            student_id: subscription.user_id,
                            is_regular_hide: 1
                        },
                        attributes: ['id', 'student_id', 'teacher_id', 'meeting_start', 'meeting_end', 'status'],
                        transaction: dbTransaction
                    });

                    // Delete regular class schedules
                    const deletedRegularCount = await RegularClass.destroy({
                        where: {
                            student_id: subscription.user_id
                        },
                        transaction: dbTransaction
                    });

                    console.log(`Deleted ${deletedRegularCount} regular class schedules`);

                    // Log bulk class deletion before cancellation
                    const totalDeleted = deletedRegularCount + hiddenClassesToDelete.length;
                    if (totalDeleted > 0) {
                        const classesDeleted = [
                            ...regularClassesToDelete.map((rc) => ({
                                class_id: rc.id,
                                class_type: 'regular_class_pattern',
                                student_id: rc.student_id,
                                teacher_id: rc.teacher_id,
                                day: rc.day,
                                start_time: rc.start_time,
                                status: 'deleted'
                            })),
                            ...hiddenClassesToDelete.map((hc) => ({
                                class_id: hc.id,
                                class_type: 'regular',
                                student_id: hc.student_id,
                                teacher_id: hc.teacher_id,
                                meeting_start: hc.meeting_start,
                                status: hc.status
                            }))
                        ];

                        classDeletionLogger.logBulkClassDeletion({
                            deletion_source: 'admin_panel',
                            deleted_by: req.user?.id || cancelled_by_user_id || null,
                            deleted_by_role: 'admin',
                            deletion_reason: `Subscription cancelled immediately (status: inactive). ${cancellation_reason ? 'Reason: ' + cancellation_reason : ''}`,
                            total_deleted: totalDeleted,
                            classes_deleted: classesDeleted,
                            subscription_updates: [
                                {
                                    subscription_id: subscription.id,
                                    student_id: subscription.user_id,
                                    subscription_type: subscription.type,
                                    cancellation_type: cancellation_type || 'immediate'
                                }
                            ],
                            lessons_refunded_total: 0
                        });
                    }

                    // Cancel next month lessons that are hidden
                    const cancelledHiddenCountResult = await Class.update(
                        {
                            status: 'canceled',
                            cancelled_by: req.user?.id || cancelled_by_user_id || null,
                            cancelled_at: moment.utc().toDate(),
                            cancellation_reason: 'Subscription cancelled immediately - hidden classes cancelled',
                            join_url: null,
                            updated_at: moment.utc().toDate()
                        },
                        {
                            where: {
                                student_id: subscription.user_id,
                                is_regular_hide: 1
                            },
                            transaction: dbTransaction
                        }
                    );
                    const cancelledHiddenCount = cancelledHiddenCountResult[0] || 0;
                    console.log(`Cancelled ${cancelledHiddenCount} hidden next-month lessons`);
                } catch (classError) {
                    console.error('Error cancelling classes:', classError);

                    // Log deletion error
                    classDeletionLogger.logBulkClassDeletion({
                        deletion_source: 'admin_panel',
                        deleted_by: req.user?.id || cancelled_by_user_id || null,
                        deleted_by_role: 'admin',
                        deletion_reason: `Error during subscription cancellation for subscription ${id}`,
                        total_deleted: 0,
                        classes_deleted: [],
                        errors: [
                            {
                                error_type: 'deletion_exception',
                                error_message: classError.message,
                                error_stack: classError.stack,
                                subscription_id: id,
                                student_id: subscription.user_id
                            }
                        ]
                    });

                    // Don't fail the entire operation, but log the error
                }
            } else {
                console.log(`Status is 'inactive_after_renew' - classes will NOT be cancelled until renewal date`);
            }
        } else if ((originalStatus === 'inactive' || originalStatus === 'inactive_after_renew') && newStatus === 'active') {
            // When reactivating subscription, note that new payment setup may be needed
            console.log(`🔄 Subscription ${id} status changing from ${originalStatus} to active - checking for reactivation`);

            recurringPaymentResult = await reactivateUserRecurringPayments(subscription.user_id, { type, weekly_lesson, lesson_min }, req.user?.id || null, dbTransaction);

            console.log(`📊 Recurring payment reactivation result:`, recurringPaymentResult);
        }

        // ----------------- LEFT LESSONS CALCULATION -----------------
        
        const currentBonusClass = subscription.bonus_class || 0;
        const newBonusClass = bonus_class !== undefined ? parseInt(bonus_class) : currentBonusClass;
        
        // Get request left_lessons value (required field, use 0 as fallback)
        const requestLeftLessons = left_lessons !== undefined && left_lessons !== null && left_lessons !== "" 
            ? Number(left_lessons) 
            : subscription.left_lessons || 0;

        let calculatedLeftLessons = 0;

        // If weekly_lesson is changed
        if (weekly_lesson !== undefined && parseInt(weekly_lesson) !== subscription.weekly_lesson) {
            const oldWeeklyLesson = subscription.weekly_lesson || 0;
            const newWeeklyLesson = parseInt(weekly_lesson);
            
            const remainingClasses = oldWeeklyLesson - requestLeftLessons;
            
            calculatedLeftLessons = newWeeklyLesson - remainingClasses - currentBonusClass + newBonusClass;
        } 
        else {
            calculatedLeftLessons = requestLeftLessons - currentBonusClass + newBonusClass;
        }

        
        if (calculatedLeftLessons < 0) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Left lesson is not available more than booking class.'
            });
        }

        // ----------------- MANUAL RENEWAL DATE (Offline only) -----------------
        let updatedRenewDate = renew_date;

        if (subscription.payment_status === 'offline' && manual_renewal_date) {
            updatedRenewDate = moment(manual_renewal_date).format('YYYY-MM-DD HH:mm:ss');
            console.log('🔥 Manual renewal date applied:', updatedRenewDate);
        }

        // ----------------- Prepare final update data -----------------
        const updateData = {
            updated_at: new Date(),
            renew_date: updatedRenewDate || subscription.renew_date
        };

        // Only update fields that are provided
        if (type !== undefined) updateData.type = type;
        if (weekly_lesson !== undefined) updateData.weekly_lesson = parseInt(weekly_lesson);
        if (lesson_min !== undefined) updateData.lesson_min = parseInt(lesson_min);
        if (status !== undefined) updateData.status = status;
        if (renew_date !== undefined && !manual_renewal_date) updateData.renew_date = renew_date;
        if (lesson_reset_at !== undefined) updateData.lesson_reset_at = lesson_reset_at;
        if (subscription.left_lessons !== undefined) updateData.left_lessons = calculatedLeftLessons;
        if (weekly_comp_class !== undefined) updateData.weekly_comp_class = parseInt(weekly_comp_class);
        if (payment_status !== undefined) updateData.payment_status = payment_status;

        // Handle bonus class updates with reason
        if (bonus_class !== undefined) {
            updateData.bonus_class = parseInt(bonus_class);

            if (bonus_class == 0) {
                updateData.bonus_expire_date = null;
                updateData.bonus_completed_class = 0;
            } else {
                updateData.bonus_expire_date = moment(bonus_expire_date).format('YYYY-MM-DD HH:mm:ss');
            }

            // Handle bonus class data JSON with reason
            await handleBonusClassDataWithReason(subscription, bonus_class, bonus_expire_date, bonus_class_reason, req.user?.id, dbTransaction);
        }

        // Handle offline payment details
        if (payment_status === 'offline') {
            updateData.offline_payment_reason = offline_payment_reason.trim();
            updateData.offline_payment_admin_id = req.user?.id || null;
            updateData.offline_payment_date = new Date();
        }

        // NEW: Handle discount data
        if (applied_discount !== undefined) {
            if (applied_discount === null || (applied_discount.value === 0 || !applied_discount.value)) {
                // Remove discount
                updateData.discount_data = null;
            } else {
                // Validate discount
                if (!applied_discount.reason || applied_discount.reason.trim() === '') {
                    await dbTransaction.rollback();
                    return res.status(400).json({
                        status: 'error',
                        message: 'Discount reason is required when applying a discount'
                    });
                }

                if (applied_discount.type === 'percentage' && applied_discount.value > 100) {
                    await dbTransaction.rollback();
                    return res.status(400).json({
                        status: 'error',
                        message: 'Percentage discount cannot exceed 100%'
                    });
                }

                // Calculate original price to validate fixed discount
                const subscriptionType = type || subscription.type;
                const weeklyLessons = weekly_lesson || subscription.weekly_lesson;
                const priceResult = await calculateSubscriptionPrice(subscriptionType, parseInt(weeklyLessons));
                const originalPrice = priceResult.price;
                
                if (applied_discount.type === 'fixed' && applied_discount.value > originalPrice) {
                    await dbTransaction.rollback();
                    return res.status(400).json({
                        status: 'error',
                        message: 'Fixed discount cannot exceed the original price'
                    });
                }

                const discountData = {
                    type: applied_discount.type,
                    value: parseFloat(applied_discount.value),
                    reason: applied_discount.reason.trim(),
                    appliedBy: req.user?.id || null,
                    appliedAt: new Date().toISOString()
                };

                updateData.discount_data = JSON.stringify(discountData);
            }
        }

        // NEW: Update plan_id if subscription type or lessons changed (same as payment link generation)
        if (type !== undefined || weekly_lesson !== undefined) {
            const subscriptionType = type || subscription.type;
            const weeklyLessons = weekly_lesson || subscription.weekly_lesson;
            const priceResult = await calculateSubscriptionPrice(subscriptionType, parseInt(weeklyLessons));
            if (priceResult.planId) {
                updateData.plan_id = priceResult.planId;
            }
        }

        // Handle cancellation details if status becomes inactive
        if (status === 'inactive' || status === 'inactive_after_renew') {
            updateData.cancellation_date = new Date();
            updateData.cancelled_by_user_id = req.user?.id || cancelled_by_user_id || null;

            if (cancellation_reason_category_id) {
                updateData.cancellation_reason_category_id = cancellation_reason_category_id;
            }
            if (cancellation_reason) {
                updateData.cancellation_reason = cancellation_reason;
            }
            // ✅ Log cancellation reason (subscription)
            await logCancelReason({
                student_id: subscription.user_id,
                cancellation_type: 'subscription',
                reason: cancellation_reason_category_id,
                note: cancellation_reason
            });
        }
        if (status === 'inactive_after_renew') {
            // updateData.is_cancel = 1;
            updateData.status = 'active';
            updateData.inactive_after_renew = 1;
        }

        console.log(`🔄 Updating user plan ${id} with data:`, updateData);

        // Update subscription
        await subscription.update(updateData, { transaction: dbTransaction });

        // Update user rollover settings and subscription type if changed
        const userUpdateData = {
            next_month_subscription: next_month_subscription,
            next_year_subscription: next_year_subscription
        };

        if (type !== undefined) {
            userUpdateData.subscription_type = type;
        }

        await User.update(userUpdateData, {
            where: { id: subscription.user_id },
            transaction: dbTransaction
        });

        // Clear user's subscription info only for immediate cancellation
        if (status === 'inactive') {
            await User.update(
                {
                    subscription_id: null,
                    subscription_type: null
                },
                {
                    where: { id: subscription.user_id },
                    transaction: dbTransaction
                }
            );
        }

        await dbTransaction.commit();

        console.log(`✅ User plan ${id} updated successfully with bonus classes, reason, and rollover settings`);

        // Fetch updated subscription with user details
        const updatedSubscription = await UserSubscriptionDetails.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_id', 'status', 'next_month_subscription', 'next_year_subscription']
                },
                {
                    model: User,
                    as: 'OfflinePaymentAdmin',
                    attributes: ['id', 'full_name', 'email'],
                    required: false
                },
                {
                    model: CancellationReasonCategory,
                    as: 'CancellationReasonCategory',
                    attributes: ['id', 'name'],
                    required: false
                }
            ]
        });

        // Build response data with all fields
        const responseData = {
            status: 'success',
            data: {
                ...(await formatUserPlanResponse(updatedSubscription)),
                // Include cancellation details if present
                ...(updatedSubscription.cancellation_date && {
                    cancellation_date: updatedSubscription.cancellation_date,
                    cancelled_by_user_id: updatedSubscription.cancelled_by_user_id,
                    cancellation_reason_category: updatedSubscription.cancellation_reason_category,
                    cancellation_reason: updatedSubscription.cancellation_reason
                })
            },
            message: 'User plan updated successfully'
        };

        // Include recurring payment action result if any
        if (recurringPaymentResult) {
            responseData.recurring_payment_action = recurringPaymentResult;
            if (recurringPaymentResult.total > 0) {
                responseData.message += `. ${recurringPaymentResult.successful} recurring payment(s) processed.`;
            }
        }

        // Include past due handling result if any
        if (pastDueHandlingResult) {
            responseData.past_due_handling = pastDueHandlingResult;
            if (pastDueHandlingResult.cancelled_payments > 0) {
                responseData.message += ` ${pastDueHandlingResult.cancelled_payments} past due payment(s) cancelled.`;
            }
        }

        return res.status(200).json(responseData);
    } catch (error) {
        await dbTransaction.rollback();
        console.error('Error updating user plan:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Delete user plan
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteUserPlan = async (req, res) => {
    const dbTransaction = await UserSubscriptionDetails.sequelize.transaction();

    try {
        const { id } = req.params;

        const subscription = await UserSubscriptionDetails.findByPk(id, { transaction: dbTransaction });

        if (!subscription) {
            await dbTransaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'User plan not found'
            });
        }

        // Cancel all recurring payments before deleting the subscription
        console.log(`🔄 Deleting subscription ${id} - cancelling all recurring payments first`);

        const recurringPaymentResult = await cancelUserRecurringPayments(subscription.user_id, 'Subscription deleted by admin', req.user?.id || null, dbTransaction);

        // ✅ Log cancellation reason for deletion
        await logCancelReason({
            student_id: subscription.user_id,
            cancellation_type: 'subscription',
            reason: 'deleted_by_admin',
            note: 'Subscription deleted by admin action'
        });

        console.log(`📊 Recurring payment cancellation result for deleted subscription:`, recurringPaymentResult);

        // Update user's subscription info
        await User.update(
            {
                subscription_id: null,
                subscription_type: null
            },
            {
                where: { id: subscription.user_id },
                transaction: dbTransaction
            }
        );

        // Delete the subscription
        await subscription.destroy({ transaction: dbTransaction });

        await dbTransaction.commit();

        return res.status(200).json({
            status: 'success',
            message: `User plan deleted successfully. ${recurringPaymentResult.successful} recurring payment(s) cancelled.`,
            recurring_payment_action: recurringPaymentResult
        });
    } catch (error) {
        await dbTransaction.rollback();
        console.error('Error deleting user plan:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get user plan statistics
 * @param {number} userId - User ID
 * @param {number} subscriptionId - Subscription ID
 * @returns {Object} Statistics object
 */
const getUserPlanStats = async (userId, subscriptionId) => {
    try {
        const subscription = await UserSubscriptionDetails.findByPk(subscriptionId);

        if (!subscription) {
            return {
                lessonCount: 0,
                lessonTaken: 0,
                notUseLesson: 0
            };
        }

        const startMonth = moment(subscription.created_at);
        const endMonth = moment(subscription.lesson_reset_at);
        const diffMonths = endMonth.diff(startMonth, 'months') || 1;

        const totalLessons = diffMonths * subscription.weekly_lesson;

        let lessonTaken = 0;

        if (['Yearly', 'Quarterly'].includes(subscription.type)) {
            lessonTaken = await Class.count({
                where: {
                    student_id: userId,
                    meeting_end: {
                        [Op.gt]: moment(subscription.created_at).startOf('day').toDate(),
                        [Op.lt]: moment(subscription.lesson_reset_at).endOf('day').toDate()
                    },
                    status: { [Op.ne]: 'cancelled' }
                }
            });
        } else {
            lessonTaken = totalLessons - (subscription.left_lessons || 0);
        }

        const notUseLesson = Math.max(0, totalLessons - lessonTaken);

        return {
            lessonCount: totalLessons,
            lessonTaken,
            notUseLesson
        };
    } catch (error) {
        console.error('Error calculating user plan stats:', error);
        return {
            lessonCount: 0,
            lessonTaken: 0,
            notUseLesson: 0
        };
    }
};

/**
 * Get analytics for user plans
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getUserPlanAnalytics = async (req, res) => {
  try {
    const { period = "30d", startDate: customStartDate, endDate: customEndDate } = req.query;

    const now = moment();
    let startDate;
    let endDate;

    switch (period) {
      case "7d":
        startDate = now.clone().subtract(7, "days").startOf("day").toDate();
        endDate = now.endOf("day").toDate();
        break;
      case "30d":
        startDate = now.clone().subtract(30, "days").startOf("day").toDate();
        endDate = now.endOf("day").toDate();
        break;
      case "90d":
        startDate = now.clone().subtract(90, "days").startOf("day").toDate();
        endDate = now.endOf("day").toDate();
        break;
      case "1y":
        startDate = now.clone().subtract(1, "year").startOf("day").toDate();
        endDate = now.endOf("day").toDate();
        break;
      case "custom":
        if (!customStartDate || !customEndDate) {
          return res.status(400).json({
            status: "error",
            message: "Start date and end date are required for custom period"
          });
        }
        if (moment(customEndDate).isBefore(moment(customStartDate))) {
          return res.status(400).json({
            status: "error",
            message: "End date must be after start date"
          });
        }
        startDate = moment(customStartDate, "YYYY-MM-DD").startOf("day").toDate();
        endDate = moment(customEndDate, "YYYY-MM-DD").endOf("day").toDate();
        break;
      default:
        startDate = now.clone().subtract(30, "days").startOf("day").toDate();
        endDate = now.endOf("day").toDate();
    }

    // FETCH UNIQUE USERS WITH THEIR MOST RECENT SUBSCRIPTION
    const [rows] = await UserSubscriptionDetails.sequelize.query(
      `
      WITH RankedSubscriptions AS (
        SELECT 
          user_id,
          LOWER(type) AS type,
          weekly_lesson,
          lesson_min,
          status,
          inactive_after_renew,
          created_at,
          ROW_NUMBER() OVER (
            PARTITION BY user_id 
            ORDER BY created_at DESC
          ) as rn
        FROM user_subscription_details
        WHERE created_at >= :startDate
        AND created_at <= :endDate
      )
      SELECT 
        user_id,
        type,
        weekly_lesson,
        lesson_min,
        status,
        inactive_after_renew,
        created_at
      FROM RankedSubscriptions
      WHERE rn = 1
      `,
      { replacements: { startDate, endDate } }
    );

    const totalPlans = rows.length;

    const [allRecords] = await UserSubscriptionDetails.sequelize.query(
      `
      SELECT COUNT(*) as total_records
      FROM user_subscription_details
      WHERE created_at >= :startDate
        AND created_at <= :endDate
      `,
      { replacements: { startDate, endDate } }
    );

    const totalRecords = allRecords[0]?.total_records || 0;

    let activePlans = 0;
    let inactive_after_renewPlans = 0;
    let cancelledPlans = 0;

    rows.forEach((row) => {
      if (row.status === 'active' && row.inactive_after_renew === 0) {
        activePlans++;
      } else if (row.status === 'active' && row.inactive_after_renew === 1) {
        inactive_after_renewPlans++;
      } else if (row.status === 'inactive') {
        cancelledPlans++;
      }
    });

    const getPlanGroup = (type) => {
      if (type.includes("monthly")) return "Monthly";
      if (type.includes("quarter")) return "Quarterly";
      if (type.includes("year")) return "Yearly";
      return "Others";
    };

    const structure = { Monthly: {}, Quarterly: {}, Yearly: {}, Others: {} };

    rows.forEach((row) => {
      const planGroup = getPlanGroup(row.type);
      const minutes = row.lesson_min || 0;
      const subtype = `${planGroup}_${minutes}`;

      if (!structure[planGroup][subtype]) {
        structure[planGroup][subtype] = {
          type: subtype,
          lesson_min: minutes,
          count: 0,
          percentage: 0,
          lessons: {}
        };
      }

      const sub = structure[planGroup][subtype];
      sub.count++;

      if (!sub.lessons[row.weekly_lesson]) {
        sub.lessons[row.weekly_lesson] = {
          monthly_lesson: row.weekly_lesson,
          count: 0,
          percentage: 0
        };
      }
      sub.lessons[row.weekly_lesson].count++;
    });

    const finalSubscriptionTypes = Object.keys(structure).map((planGroup) => {
      const typesArr = Object.values(structure[planGroup]);
      const planTotal = typesArr.reduce((sum, t) => sum + t.count, 0);

      const cleanedTypes = typesArr.map((t) => {
        t.percentage = totalPlans > 0 ? Number(((t.count / totalPlans) * 100).toFixed(1)) : 0;
        t.lessons = Object.values(t.lessons).map((lesson) => {
          lesson.percentage = totalPlans > 0 ? Number(((lesson.count / totalPlans) * 100).toFixed(1)) : 0;
          return lesson;
        });
        return t;
      });

      return {
        plan: planGroup,
        plan_count: planTotal,
        plan_percentage: totalPlans > 0 ? Number(((planTotal / totalPlans) * 100).toFixed(1)) : 0,
        types: cleanedTypes
      };
    });

    const statusDistribution = [
      { status: 'active', count: activePlans, percentage: Number(((activePlans / totalPlans) * 100).toFixed(1)) },
      { status: 'inactive_after_renew', count: inactive_after_renewPlans, percentage: Number(((inactive_after_renewPlans / totalPlans) * 100).toFixed(1)) },
      { status: 'cancelled', count: cancelledPlans, percentage: Number(((cancelledPlans / totalPlans) * 100).toFixed(1)) }
    ];

    const periodDuration = moment(endDate).diff(moment(startDate), 'days');
    const previousPeriodStart = moment(startDate).subtract(periodDuration, 'days').toDate();
    const previousPeriodEnd = moment(startDate).toDate();

    const [previousRows] = await UserSubscriptionDetails.sequelize.query(
      `
      WITH RankedSubscriptions AS (
        SELECT 
          user_id,
          status,
          inactive_after_renew,
          created_at,
          ROW_NUMBER() OVER (
            PARTITION BY user_id 
            ORDER BY created_at DESC
          ) as rn
        FROM user_subscription_details
        WHERE created_at >= :previousPeriodStart 
          AND created_at < :previousPeriodEnd
      )
      SELECT 
        COUNT(CASE WHEN status = 'active' AND inactive_after_renew = 0 THEN 1 END) as previous_active_count
      FROM RankedSubscriptions
      WHERE rn = 1
      `,
      { replacements: { previousPeriodStart, previousPeriodEnd } }
    );

    const previousActiveCount = previousRows[0]?.previous_active_count || 0;
    const monthlyGrowth = previousActiveCount > 0 
      ? Number((((activePlans - previousActiveCount) / previousActiveCount) * 100).toFixed(1))
      : 0;

    return res.status(200).json({
      status: "success",
      data: {
        overview: {
          totalPlans,
          totalRecords,
          activePlans,
          inactive_after_renewPlans,
          cancelledPlans,
          monthlyGrowth,
          duplicateRecords: totalRecords - totalPlans,
          startDate: moment(startDate).format("YYYY-MM-DD"),
          endDate: moment(endDate).format("YYYY-MM-DD")
        },
        subscriptionTypes: finalSubscriptionTypes,
        statusDistribution
      }
    });
  } catch (error) {
    console.error("Error fetching user plan analytics:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      details: error.message,
    });
  }
};



/**
 * Get list of users for dropdown (with caching)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getUsersForDropdown = async (req, res) => {
    try {
        const users = await User.findAll({
            where: {
                status: 'active',
                role_name: 'user'
            },
            attributes: ['id', 'full_name', 'email', 'mobile'],
            order: [['full_name', 'ASC']]
        });

        return res.status(200).json({
            status: 'success',
            data: users.map((user) => ({
                id: user.id,
                name: user.full_name,
                email: user.email,
                mobile: user.mobile
            }))
        });
    } catch (error) {
        console.error('Error fetching users for dropdown:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Cancel user recurring payments manually (Admin endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const cancelUserRecurringPaymentsManually = async (req, res) => {
    const dbTransaction = await UserSubscriptionDetails.sequelize.transaction();

    try {
        const { user_id } = req.params;
        const { reason = 'Manually cancelled by admin' } = req.body;

        if (!user_id) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'User ID is required'
            });
        }

        // Verify user exists
        const user = await User.findByPk(user_id);
        if (!user) {
            await dbTransaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        console.log(`🔄 Manual cancellation of recurring payments for user ${user_id} requested by admin ${req.user?.id}`);

        const result = await cancelUserRecurringPayments(user_id, reason, req.user?.id || null, dbTransaction);

        await dbTransaction.commit();

        // ✅ Log cancellation reason (manual recurring cancel)
        await logCancelReason({
            student_id: parseInt(user_id),
            cancellation_type: 'subscription',
            reason: 'manual_recurring_cancel',
            note: reason || 'Manually cancelled recurring payments by admin'
        });

        return res.status(200).json({
            status: 'success',
            data: result,
            message: `Successfully processed ${result.total} recurring payment(s). ${result.successful} cancelled, ${result.failed} failed.`
        });
    } catch (error) {
        await dbTransaction.rollback();
        console.error('Error manually cancelling recurring payments:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get recurring payment status for a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getUserRecurringPaymentStatus = async (req, res) => {
    try {
        const { user_id } = req.params;

        if (!user_id) {
            return res.status(400).json({
                status: 'error',
                message: 'User ID is required'
            });
        }

        // Get all recurring payments for the user
        const recurringPayments = await RecurringPayment.findAll({
            where: { student_id: user_id },
            attributes: [
                'id',
                'payplus_transaction_uid',
                'payplus_page_request_uid',
                'amount',
                'currency',
                'payment_date',
                'status',
                'is_active',
                'cancelled_at',
                'cancelled_by',
                'remarks',
                'webhook_data',
                'created_at'
            ],
            include: [
                {
                    model: User,
                    as: 'CancelledBy',
                    attributes: ['id', 'full_name', 'email'],
                    required: false
                }
            ],
            order: [['created_at', 'DESC']]
        });

        // Get current subscription
        const currentSubscription = await UserSubscriptionDetails.findOne({
            where: { user_id: user_id },
            order: [['created_at', 'DESC']],
            attributes: ['id', 'type', 'status', 'payment_status', 'created_at']
        });

        // Calculate summary
        const activePayments = recurringPayments.filter((p) => p.is_active && p.status !== 'cancelled');
        const cancelledPayments = recurringPayments.filter((p) => !p.is_active || p.status === 'cancelled');

        return res.status(200).json({
            status: 'success',
            data: {
                summary: {
                    total_recurring_payments: recurringPayments.length,
                    active_payments: activePayments.length,
                    cancelled_payments: cancelledPayments.length,
                    current_subscription_status: currentSubscription?.status || 'none'
                },
                current_subscription: currentSubscription,
                recurring_payments: recurringPayments,
                active_payments: activePayments,
                cancelled_payments: cancelledPayments
            },
            message: 'Recurring payment status retrieved successfully'
        });
    } catch (error) {
        console.error('Error getting recurring payment status:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

// Helper Functions

/**
 * Calculate renewal date based on subscription type
 * @param {string} type - Subscription type
 * @param {Date} createdAt - Creation date (optional)
 * @returns {Date} Renewal date
 */
function calculateRenewDate(type, createdAt = null) {
    const baseDate = createdAt ? moment(createdAt) : moment();

    switch (type) {
        case 'Yearly':
            return baseDate.add(1, 'year').toDate();
        case 'Quarterly':
            return baseDate.add(3, 'months').toDate();
        default:
            return baseDate.add(1, 'month').toDate();
    }
}

/**
 * Format user plan response for API with offline payment details
 * @param {Object} subscription - Subscription object from database
 * @returns {Promise<Object>} Formatted response
 */
async function formatUserPlanResponse(subscription) {
    // Handle both association aliases for backward compatibility
    const user = subscription.SubscriptionUser || subscription.User || subscription.user;
    const offlineAdmin = subscription.OfflinePaymentAdmin;

    // Parse bonus data to get current reason
    let currentBonusReason = '';
    if (subscription.data_of_bonus_class) {
        try {
            const bonusData = JSON.parse(subscription.data_of_bonus_class);
            if (bonusData.length > 0 && !bonusData[0].refresh) {
                currentBonusReason = bonusData[0].bonus_reason || '';
            }
        } catch (error) {
            console.error('Error parsing bonus data for response:', error);
        }
    }

    // UPDATED: Calculate current price using database pricing (same as payment link generation)
    const priceResult = await calculateSubscriptionPrice(subscription.type, subscription.weekly_lesson, subscription.plan_id);
    const currentPrice = priceResult.price;

    // NEW: Parse discount data and calculate final price
    let discountInfo = null;
    let finalPrice = currentPrice;
    let discountAmount = 0;

    if (subscription.discount_data) {
        try {
            const discountData = typeof subscription.discount_data === 'string' 
                ? JSON.parse(subscription.discount_data) 
                : subscription.discount_data;
            
            if (discountData && discountData.value > 0) {
                discountInfo = {
                    type: discountData.type,
                    value: discountData.value,
                    reason: discountData.reason,
                    appliedBy: discountData.appliedBy,
                    appliedAt: discountData.appliedAt
                };

                const priceCalculation = calculateFinalPriceWithDiscount(currentPrice, discountData);
                finalPrice = priceCalculation.finalPrice;
                discountAmount = priceCalculation.discountAmount;
            }
        } catch (error) {
            console.error('Error parsing discount data:', error);
        }
    }

    // ... rest of the function remains the same
    const response = {
        id: subscription.id,
        studentName: user?.full_name || '',
        email: user?.email || '',
        mobile: user?.mobile || '',
        country_code: user?.country_code || null,
        subscriptionType: subscription.type,
        renewDate: subscription.renew_date ? moment(subscription.renew_date).format('DD-MM-YYYY HH:mm') : '',
        monthlyCompletedClass: subscription.weekly_comp_class || 0,
        totalMonthlyClass: `${subscription.weekly_lesson} lessons/month`,
        lessonPeriod: `${subscription.lesson_min} min`,
        subscriptionStatus: subscription.status,
        leftLessons: subscription.left_lessons || 0,
        weeklyLesson: subscription.weekly_lesson,
        lessonMin: subscription.lesson_min,
        lessonResetAt: subscription.lesson_reset_at,
        userId: subscription.user_id,
        paymentStatus: subscription.payment_status || 'pending',
        nextMonthSubscription: user?.next_month_subscription || false,
        nextYearSubscription: user?.next_year_subscription || false,
        inactive_after_renew: subscription.inactive_after_renew || 0,
        bonusClass: subscription.bonus_class || 0,
        bonusCompletedClass: subscription.bonus_completed_class || 0,
        bonusExpireDate: subscription.bonus_expire_date ? moment(subscription.bonus_expire_date).format('DD-MM-YYYY HH:mm') : null,
        bonusClassReason: currentBonusReason,
        bonusClassHistory: subscription.data_of_bonus_class ? JSON.parse(subscription.data_of_bonus_class) : [],
        createdAt: subscription.created_at,
        updatedAt: subscription.updated_at,
        currentCalculatedPrice: currentPrice, // Original price from database
        originalPrice: currentPrice, // Alias for clarity
        finalPrice: finalPrice, // Final price after discount
        discountAmount: discountAmount, // Discount amount applied
        appliedDiscount: discountInfo, // Discount information object
        cancellation_date: subscription.cancellation_date,
        cancelled_by_user_id: subscription.cancelled_by_user_id,
        cancellation_reason_category: subscription.cancellation_reason_category,
        cancellation_reason: subscription.cancellation_reason
    };

    // Add offline payment details if present
    if (subscription.payment_status === 'offline') {
        response.offlinePaymentDetails = {
            reason: subscription.offline_payment_reason,
            adminName: offlineAdmin?.full_name || 'Unknown Admin',
            adminEmail: offlineAdmin?.email,
            adminId: subscription.offline_payment_admin_id,
            date: subscription.offline_payment_date ? moment(subscription.offline_payment_date).format('DD-MM-YYYY HH:mm:ss') : null
        };
    }

    return response;
}

/**
 * Parse webhook data specifically for the format you're using
 * This handles the case where webhook data is stored as JSON string in the database
 * @param {String|Object} webhookDataFromDB - Webhook data from RecurringPayment.webhook_data field
 * @returns {Object} - Parsed webhook data with extracted fields
 */
const parseWebhookDataFromDB = (webhookDataFromDB) => {
    try {
        let parsedData = webhookDataFromDB;

        // If it's a string, parse it first
        if (typeof webhookDataFromDB === 'string') {
            parsedData = JSON.parse(webhookDataFromDB);
        }

        console.log(`📋 Parsing webhook data structure...`);

        // Extract key fields based on your data structure
        const result = {
            // Transaction details
            transaction_uid: parsedData.transaction_uid || '',
            page_request_uid: parsedData.original_webhook?.page_request_uid || '',

            // Recurring payment details from original_webhook
            recurring_payment_uid: parsedData.original_webhook?.recurring_payment_uid || null,
            recurring_id: parsedData.original_webhook?.recurring_id || null,
            recurring_number: parsedData.original_webhook?.recurring_number || null,

            // Terminal information
            terminal_uid: parsedData.original_webhook?.terminal_uid || '',
            terminal_name: parsedData.original_webhook?.terminal_name || '',

            // Customer information
            customer_name: parsedData.customer_name || parsedData.original_webhook?.customer_name || '',
            customer_email: parsedData.customer_email || parsedData.original_webhook?.customer_email || '',

            // Payment details
            amount: parseFloat(parsedData.amount || parsedData.original_webhook?.amount || 0),
            currency: parsedData.currency_code || parsedData.original_webhook?.currency || 'ILS',
            payment_method: parsedData.payment_method || 'credit_card',
            four_digits: parsedData.four_digits || parsedData.original_webhook?.four_digits || '',

            // Approval details
            approval_number: parsedData.original_webhook?.approval_num || '',
            voucher_number: parsedData.original_webhook?.voucher_num || '',

            // Additional fields
            more_info_1: parsedData.more_info_1 || parsedData.original_webhook?.more_info_1 || '',
            more_info_2: parsedData.more_info_2 || parsedData.original_webhook?.more_info_2 || '',
            more_info_3: parsedData.more_info_3 || parsedData.original_webhook?.more_info_3 || '',
            more_info_4: parsedData.more_info_4 || parsedData.original_webhook?.more_info_4 || '',
            more_info_5: parsedData.more_info_5 || parsedData.original_webhook?.more_info_5 || '',

            // Card details
            card_holder_name: parsedData.original_webhook?.card_holder_name || '',
            expiry_month: parsedData.original_webhook?.expiry_month || '',
            expiry_year: parsedData.original_webhook?.expiry_year || '',
            brand_name: parsedData.original_webhook?.brand_name || '',

            // Status
            status: parsedData.original_webhook?.status || '',
            status_code: parsedData.original_webhook?.status_code || '',
            status_description: parsedData.original_webhook?.status_description || '',

            // Full original webhook for reference
            original_webhook: parsedData.original_webhook || {},

            // Processing metadata
            processed_at: parsedData.processed_at || new Date().toISOString(),

            // Lesson details if available
            lesson_details: parsedData.lesson_details || {}
        };

        console.log(`✅ Successfully parsed webhook data with recurring UID: ${result.recurring_payment_uid}, terminal UID: ${result.terminal_uid}`);

        return result;
    } catch (error) {
        console.error(`❌ Error parsing webhook data from DB:`, error);
        return {
            recurring_payment_uid: null,
            terminal_uid: null,
            transaction_uid: '',
            page_request_uid: '',
            error: error.message
        };
    }
};

/**
 * Get recurring payment UID specifically from your webhook data format
 * @param {Object} recurringPaymentRecord - RecurringPayment record from database
 * @returns {String|null} - The actual recurring payment UID to use for cancellation
 */
const getRecurringPaymentUidForCancellation = (recurringPaymentRecord) => {
    try {
        console.log(`🔍 Getting recurring payment UID for cancellation from record ${recurringPaymentRecord.id}`);

        // First priority: Parse webhook_data to get recurring_payment_uid
        if (recurringPaymentRecord.webhook_data) {
            const parsedWebhookData = parseWebhookDataFromDB(recurringPaymentRecord.webhook_data);

            if (parsedWebhookData.recurring_payment_uid) {
                console.log(`✅ Found recurring_payment_uid in webhook data: ${parsedWebhookData.recurring_payment_uid}`);
                return parsedWebhookData.recurring_payment_uid;
            }
        }

        // Second priority: Use payplus_transaction_uid if available
        if (recurringPaymentRecord.payplus_transaction_uid && recurringPaymentRecord.payplus_transaction_uid !== 'N/A' && recurringPaymentRecord.payplus_transaction_uid !== '') {
            console.log(`⚠️ Using payplus_transaction_uid as fallback: ${recurringPaymentRecord.payplus_transaction_uid}`);
            return recurringPaymentRecord.payplus_transaction_uid;
        }

        console.log(`❌ No valid recurring payment UID found for record ${recurringPaymentRecord.id}`);
        return null;
    } catch (error) {
        console.error(`❌ Error getting recurring payment UID for cancellation:`, error);
        return null;
    }
};

/**
 * Get terminal UID specifically from your webhook data format
 * @param {Object} recurringPaymentRecord - RecurringPayment record from database
 * @returns {String|null} - The terminal UID to use for API calls
 */
const getTerminalUidFromRecord = (recurringPaymentRecord) => {
    try {
        console.log(`🔍 Getting terminal UID from record ${recurringPaymentRecord.id}`);

        if (recurringPaymentRecord.webhook_data) {
            const parsedWebhookData = parseWebhookDataFromDB(recurringPaymentRecord.webhook_data);

            if (parsedWebhookData.terminal_uid) {
                console.log(`✅ Found terminal_uid in webhook data: ${parsedWebhookData.terminal_uid}`);
                return parsedWebhookData.terminal_uid;
            }
        }

        console.log(`⚠️ No terminal UID found in webhook data for record ${recurringPaymentRecord.id}`);
        return null;
    } catch (error) {
        console.error(`❌ Error getting terminal UID from record:`, error);
        return null;
    }
};

/**
 * Download invoice for a user plan (based on payment-callback.controller.js implementation)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const downloadUserPlanInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const { type = 'original', format = 'pdf' } = req.query;

        console.log(`📥 Downloading ${type} invoice for user plan: ${id}`);

        // Validate user plan ID
        if (!id || isNaN(id)) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid user plan ID is required'
            });
        }

        // Validate type parameter
        if (!['original', 'copy'].includes(type)) {
            return res.status(400).json({
                status: 'error',
                message: 'Type must be either "original" or "copy"'
            });
        }

        // Get user plan details
        const userPlan = await UserSubscriptionDetails.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    attributes: ['id', 'full_name', 'email']
                }
            ]
        });

        if (!userPlan) {
            return res.status(404).json({
                status: 'error',
                message: 'User plan not found'
            });
        }

        // Check if this is an online payment
        if (userPlan.payment_status !== 'online') {
            return res.status(400).json({
                status: 'error',
                message: 'Invoice download is only available for online payments',
                payment_status: userPlan.payment_status
            });
        }

        // Find the associated payment transaction to get the transaction UID
        const paymentTransaction = await PaymentTransaction.findOne({
            where: {
                student_id: userPlan.user_id,
                status: 'success'
            },
            order: [['created_at', 'DESC']],
            attributes: ['transaction_id', 'token', 'student_name', 'amount', 'currency']
        });

        if (!paymentTransaction) {
            return res.status(404).json({
                status: 'error',
                message: 'No successful payment transaction found for this user plan'
            });
        }

        // Use transaction_id or token as the transaction UID
        const transactionUid = paymentTransaction.transaction_id || paymentTransaction.token;

        if (!transactionUid || transactionUid === 'undefined' || transactionUid === '') {
            return res.status(404).json({
                status: 'error',
                message: 'Valid transaction UID not found for this payment'
            });
        }

        console.log(`🔍 Found transaction UID: ${transactionUid} for user plan ${id}`);

        // PayPlus API configuration
        const PAYPLUS_CONFIG = {
            apiKey: process.env.PAYPLUS_API_KEY || '',
            secretKey: process.env.PAYPLUS_SECRET_KEY || '',
            baseUrl: process.env.PAYPLUS_BASE_URL || 'https://restapidev.payplus.co.il/api/v1.0'
        };

        // Validate PayPlus configuration
        if (!PAYPLUS_CONFIG.apiKey || !PAYPLUS_CONFIG.secretKey) {
            console.error('❌ PayPlus API credentials not configured');
            return res.status(500).json({
                status: 'error',
                message: 'Payment system configuration error'
            });
        }

        // Get invoice documents from PayPlus
        const payplusUrl = `${PAYPLUS_CONFIG.baseUrl}/Invoice/GetDocuments`;
        const requestData = {
            transaction_uid: transactionUid,
            filter: {}
        };

        const headers = {
            accept: 'application/json',
            'content-type': 'application/json',
            'api-key': PAYPLUS_CONFIG.apiKey,
            'secret-key': PAYPLUS_CONFIG.secretKey
        };

        console.log(`🔗 Requesting invoice documents from PayPlus for transaction: ${transactionUid}`);

        // Get invoice documents
        const response = await axios.post(payplusUrl, requestData, {
            headers,
            timeout: 30000
        });

        if (response.status !== 200 || !response.data || !response.data.invoices || response.data.invoices.length === 0) {
            console.error(`❌ No invoice documents found for transaction: ${transactionUid}`);
            return res.status(404).json({
                status: 'error',
                message: 'No invoice documents found for this payment',
                transaction_uid: transactionUid,
                user_plan_id: id
            });
        }

        // Find the first successful invoice
        const invoice = response.data.invoices.find((inv) => inv.status === 'success');
        if (!invoice) {
            console.error(`❌ No successful invoice found for transaction: ${transactionUid}`);
            return res.status(404).json({
                status: 'error',
                message: 'No successful invoice found for this payment',
                transaction_uid: transactionUid,
                user_plan_id: id
            });
        }

        // Get the appropriate download URL
        const downloadUrl = type === 'original' ? invoice.original_doc_url : invoice.copy_doc_url;

        if (!downloadUrl) {
            console.error(`❌ ${type} document URL not available for invoice`);
            return res.status(404).json({
                status: 'error',
                message: `${type} document URL not available for this invoice`,
                transaction_uid: transactionUid,
                user_plan_id: id,
                available_types: {
                    original: !!invoice.original_doc_url,
                    copy: !!invoice.copy_doc_url
                }
            });
        }

        console.log(`🔗 Found ${type} document URL: ${downloadUrl}`);

        // Download the document from PayPlus
        const documentResponse = await axios.get(downloadUrl, {
            responseType: 'stream',
            timeout: 60000, // 60 second timeout for file download
            headers: {
                'api-key': PAYPLUS_CONFIG.apiKey,
                'secret-key': PAYPLUS_CONFIG.secretKey
            }
        });

        if (documentResponse.status !== 200) {
            throw new Error(`Failed to download document: HTTP ${documentResponse.status}`);
        }

        // Determine content type and filename
        const contentType = documentResponse.headers['content-type'] || 'application/pdf';
        const customerName = userPlan.SubscriptionUser?.full_name || paymentTransaction.student_name || 'customer';
        const sanitizedName = customerName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const filename = `invoice_${sanitizedName}_${id}_${type}.${format}`;

        // Set response headers for file download
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-User-Plan-ID', id);
        res.setHeader('X-Transaction-UID', transactionUid);

        console.log(`📥 Streaming invoice document: ${filename}`);

        // Stream the document to the client
        documentResponse.data.pipe(res);

        // Handle stream errors
        documentResponse.data.on('error', (error) => {
            console.error(`❌ Error streaming invoice document for user plan ${id}:`, error);
            if (!res.headersSent) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error streaming invoice document',
                    details: error.message,
                    user_plan_id: id
                });
            }
        });

        // Log successful download
        documentResponse.data.on('end', () => {
            console.log(`✅ Successfully downloaded invoice for user plan ${id} (transaction: ${transactionUid})`);
        });
    } catch (error) {
        console.error(`❌ Error downloading invoice for user plan ${req.params.id}:`, error);

        // Prevent sending response if headers already sent
        if (res.headersSent) {
            return;
        }

        // Handle specific errors
        if (error.response) {
            const statusCode = error.response.status;
            const errorData = error.response.data;

            if (statusCode === 404) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Invoice document not found',
                    user_plan_id: req.params.id
                });
            }

            if (statusCode === 401 || statusCode === 403) {
                return res.status(401).json({
                    status: 'error',
                    message: 'Authentication failed with PayPlus API'
                });
            }

            return res.status(500).json({
                status: 'error',
                message: 'PayPlus API error during download',
                details: errorData || error.message,
                status_code: statusCode,
                user_plan_id: req.params.id
            });
        }

        return res.status(500).json({
            status: 'error',
            message: 'Error downloading invoice',
            details: error.message,
            user_plan_id: req.params.id
        });
    }
};

/**
 * Get bonus class history for a user plan with enhanced admin info
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getBonusClassHistory = async (req, res) => {
    try {
        const { id } = req.params;

        const subscription = await UserSubscriptionDetails.findByPk(id, {
            attributes: ['id', 'bonus_class', 'bonus_completed_class', 'data_of_bonus_class', 'bonus_expire_date'],
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    attributes: ['id', 'full_name', 'email']
                }
            ]
        });

        if (!subscription) {
            return res.status(404).json({
                status: 'error',
                message: 'User plan not found'
            });
        }

        let bonusHistory = [];

        if (subscription.data_of_bonus_class) {
            try {
                bonusHistory = JSON.parse(subscription.data_of_bonus_class);

                for (let bonus of bonusHistory) {
                    // Add is_current flag based on refresh status
                    bonus.is_current = bonus.refresh === false;

                    // Fetch admin who assigned the bonus
                    if (bonus.admin_id) {
                        const admin = await User.findByPk(bonus.admin_id, {
                            attributes: ['id', 'full_name', 'email']
                        });
                        if (admin) {
                            bonus.admin_name = admin.full_name;
                            bonus.admin_email = admin.email;
                        }
                    }

                    // Fetch admin who refreshed the bonus
                    if (bonus.refreshed_by_admin_id) {
                        const refreshAdmin = await User.findByPk(bonus.refreshed_by_admin_id, {
                            attributes: ['id', 'full_name', 'email']
                        });
                        if (refreshAdmin) {
                            bonus.refreshed_by_admin_name = refreshAdmin.full_name;
                            bonus.refreshed_by_admin_email = refreshAdmin.email;
                        }
                    }
                }
            } catch (error) {
                console.error('Error parsing bonus class history:', error);
                bonusHistory = [];
            }
        }

        return res.status(200).json({
            status: 'success',
            data: {
                current_bonus_class: subscription.bonus_class || 0,
                current_bonus_completed: subscription.bonus_completed_class || 0,
                bonus_expire_date: subscription.bonus_expire_date,
                student_info: {
                    id: subscription.SubscriptionUser?.id,
                    name: subscription.SubscriptionUser?.full_name,
                    email: subscription.SubscriptionUser?.email
                },
                bonus_history: bonusHistory
            },
            message: 'Bonus class history retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching bonus class history:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Enhanced refresh bonus classes - FIXED to match PHP behavior
 * Updates the current active bonus to refreshed and saves history (never null)
 */
const refreshBonusClasses = async (req, res) => {
    const dbTransaction = await UserSubscriptionDetails.sequelize.transaction();

    try {
        const { id } = req.params;
        const { refresh_reason = 'Bonus classes refreshed by admin' } = req.body;

        const subscription = await UserSubscriptionDetails.findByPk(id, { transaction: dbTransaction });

        if (!subscription) {
            await dbTransaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'User plan not found'
            });
        }

        // Parse existing bonus data safely
        let bonusData = [];
        if (subscription.data_of_bonus_class) {
            try {
                const parsed = JSON.parse(subscription.data_of_bonus_class);
                bonusData = Array.isArray(parsed) ? parsed : [];
            } catch (error) {
                console.error('Error parsing bonus class data:', error);
                bonusData = [];
            }
        }

        // Update current active bonus to refreshed status (MATCH PHP LOGIC)
        if (subscription.bonus_class > 0) {
            if (bonusData.length > 0) {
                // FIXED: Safe findIndex with array check
                const currentBonusIndex = Array.isArray(bonusData) ? bonusData.findIndex((bonus) => !bonus.refresh) : -1;

                if (currentBonusIndex !== -1) {
                    // Mark current bonus as refreshed with the exact format you want
                    bonusData[currentBonusIndex] = {
                        ...bonusData[currentBonusIndex],
                        refresh: true,
                        bonus_completed_class: subscription.bonus_completed_class || 0,
                        refresh_reason: refresh_reason.trim(),
                        refresh_date: moment().format('YYYY-MM-DD HH:mm'),
                        refreshed_by_admin_id: req.user?.id
                    };
                } else {
                    // Create new entry if no active bonus found
                    const newBonusData = {
                        refresh: true,
                        bonus_class: subscription.bonus_class.toString(),
                        bonus_completed_class: subscription.bonus_completed_class || 0,
                        bonus_expire_date: subscription.bonus_expire_date ? moment(subscription.bonus_expire_date).format('YYYY-MM-DD HH:mm') : moment().format('YYYY-MM-DD HH:mm'),
                        bonus_created_at: moment().format('YYYY-MM-DD HH:mm'),
                        refresh_reason: refresh_reason.trim(),
                        refresh_date: moment().format('YYYY-MM-DD HH:mm'),
                        refreshed_by_admin_id: req.user?.id
                    };
                    bonusData.unshift(newBonusData);
                }
            } else {
                // No existing data, create new refreshed entry
                const newBonusData = {
                    refresh: true,
                    bonus_class: subscription.bonus_class.toString(),
                    bonus_completed_class: subscription.bonus_completed_class || 0,
                    bonus_expire_date: subscription.bonus_expire_date ? moment(subscription.bonus_expire_date).format('YYYY-MM-DD HH:mm') : moment().format('YYYY-MM-DD HH:mm'),
                    bonus_created_at: moment().format('YYYY-MM-DD HH:mm'),
                    refresh_reason: refresh_reason.trim(),
                    refresh_date: moment().format('YYYY-MM-DD HH:mm'),
                    refreshed_by_admin_id: req.user?.id
                };
                bonusData.push(newBonusData);
            }
        }

        // Calculate new left lessons after refresh
        const unusedBonusClasses = (subscription.bonus_class || 0) - (subscription.bonus_completed_class || 0);
        const newLeftLessons = Math.max(0, (subscription.left_lessons || 0) - unusedBonusClasses);

        // Update subscription - NEVER SET TO NULL, always preserve the history
        await subscription.update(
            {
                left_lessons: newLeftLessons,
                bonus_class: 0,
                bonus_completed_class: 0,
                bonus_expire_date: null,
                // FIXED: Always save the data, never null (like PHP)
                data_of_bonus_class: JSON.stringify(bonusData),
                updated_at: new Date()
            },
            { transaction: dbTransaction }
        );

        await dbTransaction.commit();

        console.log(`✅ Bonus classes refreshed for user plan ${id} with reason: ${refresh_reason}`);
        console.log(`📋 Preserved bonus data:`, JSON.stringify(bonusData, null, 2));

        // Fetch updated subscription
        const updatedSubscription = await UserSubscriptionDetails.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_id', 'status', 'next_month_subscription', 'next_year_subscription']
                },
                {
                    model: User,
                    as: 'OfflinePaymentAdmin',
                    attributes: ['id', 'full_name', 'email'],
                    required: false
                }
            ]
        });

        return res.status(200).json({
            status: 'success',
            data: await formatUserPlanResponse(updatedSubscription),
            message: 'Bonus classes refreshed successfully'
        });
    } catch (error) {
        await dbTransaction.rollback();
        console.error('Error refreshing bonus classes:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Enhanced handle bonus class data JSON updates - FIXED to never set null
 */
const handleBonusClassDataWithReason = async (subscription, bonusClass, bonusExpireDate, bonusReason, adminId, transaction) => {
    try {
        let bonusData = [];

        // Safe parsing of existing bonus data
        if (subscription.data_of_bonus_class) {
            try {
                const parsed = JSON.parse(subscription.data_of_bonus_class);
                bonusData = Array.isArray(parsed) ? parsed : [];
            } catch (error) {
                console.error('Error parsing existing bonus data:', error);
                bonusData = [];
            }
        }

        // If bonus class or expire date changed
        if (bonusClass !== subscription.bonus_class || bonusExpireDate !== subscription.bonus_expire_date) {
            // Case 1: Refresh flag is true and new bonus > 0
            if (bonusData.length > 0 && bonusData[0]?.refresh === true && bonusClass > 0) {
                const newBonusData = {
                    refresh: false,
                    bonus_class: bonusClass.toString(),
                    bonus_created_at: moment().format('YYYY-MM-DD HH:mm'),
                    bonus_expire_date: moment(bonusExpireDate).format('YYYY-MM-DD HH:mm'),
                    bonus_completed_class: 0,
                    bonus_reason: bonusReason.trim(),
                    admin_id: adminId
                };
                bonusData.unshift(newBonusData);
                console.log('Created new bonus data after refresh');
            }
            // Case 2: No previous bonus data
            else if (bonusData.length === 0 && bonusClass > 0) {
                const newBonusData = {
                    refresh: false,
                    bonus_class: bonusClass.toString(),
                    bonus_created_at: moment().format('YYYY-MM-DD HH:mm'),
                    bonus_expire_date: moment(bonusExpireDate).format('YYYY-MM-DD HH:mm'),
                    bonus_completed_class: 0,
                    bonus_reason: bonusReason.trim(),
                    admin_id: adminId
                };
                bonusData.push(newBonusData);
                console.log('Created first bonus data entry');
            }
            // Case 3: Update existing bonus (current active bonus)
            else if (bonusData.length > 0 && bonusClass > 0) {
                const currentBonusIndex = Array.isArray(bonusData) ? bonusData.findIndex((bonus) => !bonus.refresh) : -1;

                if (currentBonusIndex !== -1) {
                    bonusData[currentBonusIndex].bonus_class = bonusClass.toString();
                    bonusData[currentBonusIndex].bonus_expire_date = moment(bonusExpireDate).format('YYYY-MM-DD HH:mm');
                    bonusData[currentBonusIndex].bonus_reason = bonusReason.trim();
                    bonusData[currentBonusIndex].admin_id = adminId;
                    bonusData[currentBonusIndex].updated_at = moment().format('YYYY-MM-DD HH:mm');
                } else {
                    // No current active bonus, create new one
                    const newBonusData = {
                        refresh: false,
                        bonus_class: bonusClass.toString(),
                        bonus_created_at: moment().format('YYYY-MM-DD HH:mm'),
                        bonus_expire_date: moment(bonusExpireDate).format('YYYY-MM-DD HH:mm'),
                        bonus_completed_class: 0,
                        bonus_reason: bonusReason.trim(),
                        admin_id: adminId
                    };
                    bonusData.unshift(newBonusData);
                }
                console.log('Updated existing bonus data');
            }
            // Case 4: Bonus class set to 0, mark current as refreshed (PRESERVE DATA)
            else if (bonusClass === 0 && bonusData.length > 0) {
                const currentBonusIndex = Array.isArray(bonusData) ? bonusData.findIndex((bonus) => !bonus.refresh) : -1;

                if (currentBonusIndex !== -1) {
                    bonusData[currentBonusIndex].refresh = true;
                    bonusData[currentBonusIndex].refresh_reason = 'Bonus classes set to 0';
                    bonusData[currentBonusIndex].refresh_date = moment().format('YYYY-MM-DD HH:mm');
                    bonusData[currentBonusIndex].refreshed_by_admin_id = adminId;
                }
                console.log('Marked bonus as refreshed (set to 0)');
            }

            console.log('------------Final bonusData----------', JSON.stringify(bonusData, null, 2));

            // FIXED: Always save data, never set to null (like PHP behavior)
            await subscription.update(
                {
                    data_of_bonus_class: JSON.stringify(bonusData)
                },
                { transaction }
            );
        }
    } catch (error) {
        console.error('Error handling bonus class data with reason:', error);
        throw error;
    }
};

/**
 * Get overview statistics for user plans dashboard
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */


const getOverviewStats = async (req, res) => {
    try {
        console.log('📊 Fetching overview statistics...');

        const sequelize = UserSubscriptionDetails.sequelize;

        // ✅ OPTIMIZED: Use a single SQL query with CTE to get all stats at database level
        // This avoids loading all records into memory
        const statsQuery = `
            WITH LatestPlans AS (
                SELECT 
                    usd.*,
                    ROW_NUMBER() OVER (PARTITION BY usd.user_id ORDER BY usd.created_at DESC) as rn
                FROM user_subscription_details usd
                INNER JOIN users u ON usd.user_id = u.id
            ),
            LatestPlansOnly AS (
                SELECT * FROM LatestPlans WHERE rn = 1
            )
            SELECT 
                COUNT(*) as total_plans,
                SUM(CASE WHEN status = 'active' AND inactive_after_renew = 0 THEN 1 ELSE 0 END) as active_plans,
                SUM(CASE WHEN status = 'inactive' AND is_cancel = 1 THEN 1 ELSE 0 END) as cancelled_plans,
                SUM(CASE WHEN status = 'active' AND inactive_after_renew = 1 THEN 1 ELSE 0 END) as cancelling_at_renewal_plans
            FROM LatestPlansOnly
        `;

        const [statsResult] = await sequelize.query(statsQuery, {
            type: sequelize.QueryTypes.SELECT
        });

        // Calculate total credits (unused lessons) - using raw query for efficiency
        const totalCreditsQuery = `
            SELECT 
                COALESCE(SUM(left_lessons), 0) as total_credits,
                COALESCE(SUM(bonus_class - COALESCE(bonus_completed_class, 0)), 0) as total_bonus_credits
            FROM user_subscription_details usd
            INNER JOIN users u ON usd.user_id = u.id
            WHERE usd.status IN ('active', 'inactive_after_renew')
        `;

        const [creditsResult] = await sequelize.query(totalCreditsQuery, {
            type: sequelize.QueryTypes.SELECT
        });

        const stats = {
            totalPlans: parseInt(statsResult?.total_plans || 0),
            activePlans: parseInt(statsResult?.active_plans || 0),
            cancelledPlans: parseInt(statsResult?.cancelled_plans || 0),
            cancellingAtRenewalPlans: parseInt(statsResult?.cancelling_at_renewal_plans || 0),
            totalCredits: parseInt(creditsResult?.total_credits || 0) + parseInt(creditsResult?.total_bonus_credits || 0)
        };

        console.log('✅ Overview statistics calculated:', stats);

        return res.status(200).json({
            status: 'success',
            data: stats,
            message: 'Overview statistics retrieved successfully'
        });
    } catch (error) {
        console.error('❌ Error fetching overview statistics:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};


/**
 * Calculate subscription price - Database first, then fallback to payment generator logic
 * @param {String} subscriptionType - Subscription type (e.g., "Monthly_25", "Yearly")
 * @param {Number} lessonsPerMonth - Number of lessons per month
 * @returns {Object|null} - Plan object with id and price, or null if not found
 */
const findMatchingSubscriptionPlan = async (subscriptionType, lessonsPerMonth) => {
    try {
        console.log(`🔍 Finding matching subscription plan for ${subscriptionType} with ${lessonsPerMonth} lessons/month`);

        // Parse subscription type to extract duration and lesson length
        // Handle both "Monthly_25" format and "Monthly" format
        let durationName, lessonMinutes;

        if (subscriptionType.includes('Monthly_') || subscriptionType.includes('monthly_')) {
            // Extract lesson minutes from type (e.g., "Monthly_25" -> 25)
            const parts = subscriptionType.split('_');
            lessonMinutes = parseInt(parts[1]) || 25;
            durationName = 'monthly'; // Use lowercase to match database
        } else if (subscriptionType.includes('Quarterly') || subscriptionType.includes('quarterly')) {
            durationName = 'quarterly';
            lessonMinutes = 25; // Default for Quarterly
        } else if (subscriptionType.includes('Yearly') || subscriptionType.includes('yearly')) {
            durationName = 'yearly';
            lessonMinutes = 25; // Default for Yearly
        } else {
            console.warn(`⚠️ Unknown subscription type: ${subscriptionType}, defaulting to monthly`);
            durationName = 'monthly';
            lessonMinutes = 25;
        }

        let plan = await SubscriptionPlan.findOne({
            where: {
                status: 'active'
            },
            include: [
                {
                    model: SubscriptionDuration,
                    as: 'Duration',
                    where: {
                        name: durationName,
                        status: 'active'
                    },
                    attributes: ['id', 'name', 'months'],
                    required: true
                },
                {
                    model: LessonLength,
                    as: 'LessonLength',
                    where: {
                        minutes: lessonMinutes,
                        status: 'active'
                    },
                    attributes: ['id', 'minutes'],
                    required: true
                },
                {
                    model: LessonsPerMonth,
                    as: 'LessonsPerMonth',
                    where: {
                        lessons: lessonsPerMonth,
                        status: 'active'
                    },
                    attributes: ['id', 'lessons'],
                    required: true
                }
            ],
            order: [['id', 'DESC']] // Get the latest plan if multiple exist
        });

        // If not found, try without status checks on related tables (more flexible)
        if (!plan) {
            console.log(`⚠️ Plan not found with strict status checks, trying flexible search (without related table status filters)...`);
            plan = await SubscriptionPlan.findOne({
                where: {
                    status: 'active'
                },
                include: [
                    {
                        model: SubscriptionDuration,
                        as: 'Duration',
                        where: {
                            name: durationName
                        },
                        attributes: ['id', 'name', 'months'],
                        required: true
                    },
                    {
                        model: LessonLength,
                        as: 'LessonLength',
                        where: {
                            minutes: lessonMinutes
                        },
                        attributes: ['id', 'minutes'],
                        required: true
                    },
                    {
                        model: LessonsPerMonth,
                        as: 'LessonsPerMonth',
                        where: {
                            lessons: lessonsPerMonth
                        },
                        attributes: ['id', 'lessons'],
                        required: true
                    }
                ],
                order: [['id', 'DESC']]
            });
        }

        // If still not found, try case-insensitive duration name search
        if (!plan) {
            console.log(`⚠️ Plan not found with exact duration name, trying case-insensitive search...`);
            const allDurations = await SubscriptionDuration.findAll({
                attributes: ['id', 'name'],
                raw: true
            });
            
            const matchingDuration = allDurations.find(d => 
                d.name.toLowerCase() === durationName.toLowerCase()
            );

            if (matchingDuration) {
                plan = await SubscriptionPlan.findOne({
                    where: {
                        status: 'active',
                        duration_id: matchingDuration.id
                    },
                    include: [
                        {
                            model: LessonLength,
                            as: 'LessonLength',
                            where: {
                                minutes: lessonMinutes
                            },
                            attributes: ['id', 'minutes'],
                            required: true
                        },
                        {
                            model: LessonsPerMonth,
                            as: 'LessonsPerMonth',
                            where: {
                                lessons: lessonsPerMonth
                            },
                            attributes: ['id', 'lessons'],
                            required: true
                        }
                    ],
                    order: [['id', 'DESC']]
                });
            }
        }

        if (plan) {
            // Price comes directly from database (subscription_plans table), not static data
            const priceFromDB = parseFloat(plan.price);
            console.log(`✅ Found matching subscription plan (ID: ${plan.id}) with price from database: ${priceFromDB} ILS`);
            console.log(`   Plan details: ${plan.Duration?.name || 'N/A'} - ${plan.LessonLength?.minutes || 'N/A'}min - ${plan.LessonsPerMonth?.lessons || 'N/A'} lessons/month`);
            console.log(`   Plan name: ${plan.name || 'N/A'}`);
            console.log(`   Price source: DATABASE (subscription_plans table)`);
            return {
                id: plan.id,
                price: priceFromDB,
                plan: plan
            };
        }

        // Log more details for debugging
        console.warn(`⚠️ No matching subscription plan found for ${subscriptionType} with ${lessonsPerMonth} lessons/month`);
        console.warn(`   Searched for: Duration=${durationName}, LessonLength=${lessonMinutes}min, LessonsPerMonth=${lessonsPerMonth}`);
        console.warn(`   Will fallback to payment generator logic (static calculation)`);
        
        // Try to find any plans with similar criteria for debugging
        const allPlans = await SubscriptionPlan.findAll({
            where: { status: 'active' },
            include: [
                { model: SubscriptionDuration, as: 'Duration', attributes: ['id', 'name'], required: false },
                { model: LessonLength, as: 'LessonLength', attributes: ['id', 'minutes'], required: false },
                { model: LessonsPerMonth, as: 'LessonsPerMonth', attributes: ['id', 'lessons'], required: false }
            ],
            limit: 10
        });
        
        if (allPlans.length > 0) {
            console.warn(`   Available plans in database (showing first 10):`);
            allPlans.forEach(p => {
                console.warn(`     - ID: ${p.id}, Price: ${p.price} ILS, Duration: ${p.Duration?.name || 'N/A'}, LessonLength: ${p.LessonLength?.minutes || 'N/A'}min, LessonsPerMonth: ${p.LessonsPerMonth?.lessons || 'N/A'}`);
            });
        } else {
            console.warn(`   No active plans found in database at all!`);
        }
        
        return null;
    } catch (error) {
        console.error('Error finding matching subscription plan:', error);
        return null;
    }
};

/**
 * Calculate subscription price - Database first (using plan price directly like payment link generation), then fallback to payment generator logic
 * @param {String} subscriptionType - Subscription type (e.g., "Monthly_25", "Yearly")
 * @param {Number} lessonsPerMonth - Number of lessons per month
 * @param {Number} planId - Optional plan ID to use directly
 * @returns {Object} - {price: number, planId: number|null}
 */
const calculateSubscriptionPrice = async (subscriptionType, lessonsPerMonth, planId = null) => {
    try {
        console.log(`💰 Calculating price for ${subscriptionType} with ${lessonsPerMonth} lessons/month`);

        // If plan_id is provided, use it directly (same as payment link generation)
        if (planId) {
            try {
                const plan = await SubscriptionPlan.findByPk(planId, {
                    where: { status: 'active' }
                });
                if (plan && plan.status === 'active') {
                    const priceFromDB = parseFloat(plan.price);
                    console.log(`✅ Using provided plan_id ${planId} with price from DATABASE: ${priceFromDB} ILS`);
                    console.log(`   Price source: DATABASE (subscription_plans table)`);
                    return {
                        price: priceFromDB,
                        planId: plan.id
                    };
                }
            } catch (error) {
                console.warn(`⚠️ Plan with ID ${planId} not found or inactive, searching for match:`, error.message);
            }
        }

        // Find matching subscription plan (same logic as payment link generation)
        console.log(`🔍 Searching for matching subscription plan in database...`);
        const planMatch = await findMatchingSubscriptionPlan(subscriptionType, lessonsPerMonth);
        
        if (planMatch) {
            console.log(`✅ Using price from DATABASE: ${planMatch.price} ILS (Plan ID: ${planMatch.id})`);
            console.log(`   Price source: DATABASE (subscription_plans table)`);
            return {
                price: planMatch.price,
                planId: planMatch.id
            };
        }

        // FALLBACK TO PAYMENT GENERATOR LOGIC (only if no plan found in database)
        console.warn(`🔄 No database plan found, using PAYMENT GENERATOR LOGIC (static calculation)`);
        console.warn(`   ⚠️ This means the price is calculated from static rules, not from database!`);
        const calculatedPrice = calculatePaymentGeneratorPrice(subscriptionType, lessonsPerMonth);
        console.log(`   Calculated static price: ${calculatedPrice} ILS`);
        return {
            price: calculatedPrice,
            planId: null
        };
    } catch (error) {
        console.error('❌ Error calculating subscription price:', error);
        // Final fallback to payment generator logic
        const calculatedPrice = calculatePaymentGeneratorPrice(subscriptionType, lessonsPerMonth);
        return {
            price: calculatedPrice,
            planId: null
        };
    }
};

/**
 * Calculate final price with discount applied
 * @param {Number} originalPrice - Original subscription price
 * @param {Object} discount - Discount object {type: 'percentage'|'fixed', value: number, reason: string}
 * @returns {Object} - {finalPrice: number, discountAmount: number}
 */
function calculateFinalPriceWithDiscount(originalPrice, discount) {
    if (!discount || discount.value === 0 || !discount.value) {
        return {
            finalPrice: originalPrice,
            discountAmount: 0
        };
    }

    let discountAmount = 0;
    if (discount.type === 'percentage') {
        discountAmount = (originalPrice * discount.value) / 100;
    } else if (discount.type === 'fixed') {
        discountAmount = discount.value;
    }

    // Ensure discount doesn't exceed original price
    discountAmount = Math.min(discountAmount, originalPrice);
    const finalPrice = Math.max(0, originalPrice - discountAmount);

    return {
        finalPrice: parseFloat(finalPrice.toFixed(2)),
        discountAmount: parseFloat(discountAmount.toFixed(2))
    };
}

/**
 * Payment generator pricing logic (fallback)
 * @param {String} subscriptionType - Subscription type
 * @param {Number} lessonsPerMonth - Number of lessons per month
 * @returns {Number} - Calculated price
 */
function calculatePaymentGeneratorPrice(subscriptionType, lessonsPerMonth) {
    try {
        // Base price and configuration (matching payment generator)
        const basePrice = 99;
        const baseLessons = 4;
        const baseLessonLength = 25;

        // Parse subscription type to get lesson length and duration
        let lessonMinutes = baseLessonLength;
        let durationMonths = 1;

        if (subscriptionType.includes('_25')) {
            lessonMinutes = 25;
        } else if (subscriptionType.includes('_40')) {
            lessonMinutes = 40;
        } else if (subscriptionType.includes('_55')) {
            lessonMinutes = 55;
        }

        if (subscriptionType.includes('Yearly')) {
            durationMonths = 12;
        } else if (subscriptionType.includes('Quarterly')) {
            durationMonths = 3;
        } else {
            durationMonths = 1; // Monthly
        }

        // Calculate price per lesson based on duration (matching payment generator logic)
        const pricePerLesson = (basePrice / baseLessons) * (lessonMinutes / baseLessonLength);

        // Calculate total price
        const totalPrice = pricePerLesson * lessonsPerMonth * durationMonths;

        const finalPrice = parseFloat(totalPrice.toFixed(2));
        console.log(`💰 Payment generator price: ${finalPrice} ILS (Base: ${basePrice}, Lessons: ${lessonsPerMonth}, Duration: ${lessonMinutes}min, Months: ${durationMonths})`);

        return finalPrice;
    } catch (error) {
        console.error('Error in payment generator price calculation:', error);
        return 0;
    }
}

// NEW FUNCTION - Audit logging
const logSubscriptionPriceChange = async (subscriptionId, userId, changeData, adminId, transaction) => {
    try {
        const currentSubscription = await UserSubscriptionDetails.findByPk(subscriptionId, { transaction });
        if (currentSubscription) {
            const auditLog = `\n[${new Date().toISOString()}] PRICE CHANGE by Admin ${adminId}: ${changeData.old_type}(${changeData.old_weekly_lesson} lessons) ${changeData.old_price}ILS → ${
                changeData.new_type
            }(${changeData.new_weekly_lesson} lessons) ${changeData.new_price}ILS (${changeData.new_price - changeData.old_price > 0 ? '+' : ''}${changeData.new_price - changeData.old_price}ILS)`;

            await currentSubscription.update(
                {
                    remarks: (currentSubscription.remarks || '') + auditLog
                },
                { transaction }
            );
        }
        return true;
    } catch (error) {
        console.error('Error logging subscription price change:', error);
        return false;
    }
};

// // NEW FUNCTION - PayPlus API integration
// const updatePayPlusRecurringPaymentAPI = async (userId, newAmount, subscriptionType) => {
//     try {
//         console.log(`Making PayPlus API call to update recurring payment for user ${userId}`);

//         const paymentTransaction = await PaymentTransaction.findOne({
//             where: { student_id: userId, status: 'success' },
//             order: [['created_at', 'DESC']],
//             attributes: ['transaction_id', 'token', 'response_data', 'amount', 'currency']
//         });

//         if (!paymentTransaction) {
//             throw new Error('No successful payment transaction found for user');
//         }

//         let payplusData = {};
//         if (paymentTransaction.response_data) {
//             try {
//                 const responseData = typeof paymentTransaction.response_data === 'string'
//                     ? JSON.parse(paymentTransaction.response_data)
//                     : paymentTransaction.response_data;

//                 payplusData = {
//                     recurringPaymentUid: responseData.recurring_payment_uid || responseData.recurring_uid,
//                     terminalUid: responseData.terminal_uid || PAYPLUS_CONFIG.terminalUid,
//                     customerUid: responseData.customer_uid,
//                     cardToken: responseData.card_token,
//                     cashierUid: responseData.cashier_uid || 'e2943027-94da-455e-9921-54f3bb7b8cb7'
//                 };
//             } catch (parseError) {
//                 throw new Error('Invalid payment transaction data');
//             }
//         }

//         if (!payplusData.recurringPaymentUid) {
//             throw new Error('No recurring payment UID found in transaction data');
//         }

//         const payplusUrl = `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/Update/${payplusData.recurringPaymentUid}`;
//         const requestData = {
//             terminal_uid: payplusData.terminalUid,
//             customer_uid: payplusData.customerUid,
//             card_token: payplusData.cardToken,
//             cashier_uid: payplusData.cashierUid,
//             currency_code: paymentTransaction.currency || 'ILS',
//             instant_first_payment: false,
//             recurring_type: 2,
//             recurring_range: 1,
//             number_of_charges: 0,
//             start_date: moment().add(1, 'month').format('YYYY-MM-DD'),
//             items: [{
//                 name: `Updated ${subscriptionType} Plan`,
//                 quantity: 1,
//                 price: parseFloat(newAmount)
//             }],
//             successful_invoice: true,
//             send_customer_success_email: true,
//             valid: true
//         };

//         const headers = {
//             'accept': 'application/json',
//             'content-type': 'application/json',
//             'api-key': PAYPLUS_CONFIG.apiKey,
//             'secret-key': PAYPLUS_CONFIG.secretKey
//         };

//         const response = await axios.post(payplusUrl, requestData, { headers, timeout: 30000 });

//         if (response.status === 200 && response.data) {
//             return {
//                 success: true,
//                 data: response.data,
//                 message: 'PayPlus recurring payment updated successfully'
//             };
//         } else {
//             throw new Error('PayPlus API returned unsuccessful response');
//         }

//     } catch (error) {
//         console.error('Error updating PayPlus recurring payment:', error);

//         let errorMessage = 'Failed to update PayPlus recurring payment';
//         if (error.response) {
//             errorMessage += `: ${error.response.data || error.response.statusText}`;
//         } else if (error.message) {
//             errorMessage += `: ${error.message}`;
//         }

//         return {
//             success: false,
//             error: errorMessage,
//             details: {
//                 status: error.response?.status,
//                 data: error.response?.data,
//                 message: error.message
//             }
//         };
//     }
// };

/**
 * Get PayPlus recurring type based on duration type (same as payment.controller.js)
 * @param {String} durationType - Duration type (monthly, quarterly, yearly, etc.)
 * @returns {Number} - PayPlus recurring type
 */
const getPayPlusRecurringType = (durationType) => {
    switch (durationType.toLowerCase()) {
        case 'daily':
            return 0;
        case 'weekly':
            return 1;
        case 'monthly':
        case 'quarterly':
        case 'yearly':
            return 2; // Monthly (quarterly will use recurring_range = 3)
        default:
            return 2; // Default to monthly
    }
};

/**
 * Get PayPlus recurring range based on duration type (same as payment.controller.js)
 * @param {String} durationType - Duration type (monthly, quarterly, yearly, etc.)
 * @param {Number} customMonths - Optional custom months value
 * @returns {Number} - PayPlus recurring range
 */
const getPayPlusRecurringRange = (durationType, customMonths) => {
    // Use customMonths if provided and valid
    const months = parseInt(customMonths, 10);
    if (!isNaN(months) && months > 0) {
        return months;
    }

    switch (durationType.toLowerCase()) {
        case 'daily':
        case 'weekly':
        case 'monthly':
            return 1;
        case 'quarterly':
            return 3; // Every 3 months
        case 'yearly':
            return 12;
        default:
            return 1;
    }
};

/**
 * Extract duration type from subscription type (e.g., "Monthly_25" -> "monthly", "Yearly" -> "yearly")
 * @param {String} subscriptionType - Subscription type from database
 * @returns {String} - Duration type (monthly, quarterly, yearly)
 */
const extractDurationTypeFromSubscription = (subscriptionType) => {
    if (!subscriptionType) return 'monthly';
    
    const typeLower = subscriptionType.toLowerCase();
    if (typeLower.includes('yearly') || typeLower.includes('year')) {
        return 'yearly';
    } else if (typeLower.includes('quarterly') || typeLower.includes('quarter')) {
        return 'quarterly';
    } else {
        return 'monthly'; // Default to monthly for Monthly_25, Monthly_40, etc.
    }
};

// Update PayPlus recurring by amount/type, with robust UID & token extraction
const updatePayPlusRecurringPaymentAPI = async (userId, newAmount, subscriptionType) => {
    try {
        console.log(`🔄 Updating PayPlus recurring payment for user ${userId} with subscription type: ${subscriptionType}, amount: ${newAmount}`);

        // 1) Find the latest successful PayPlus transaction for this user
        const paymentTransaction = await PaymentTransaction.findOne({
            where: { student_id: userId, status: 'success', payment_processor: 'payplus' },
            order: [['created_at', 'DESC']],
            attributes: ['response_data', 'currency', 'created_at']
        });

        if (!paymentTransaction) {
            throw new Error('No successful PayPlus transaction found for user');
        }

        // 2) Parse response_data safely (handles JSON object, plain JSON string, or double-encoded string)
        const tx = safeParseJSON(paymentTransaction.response_data) || {};

        // 3) Primary extraction from transaction
        let recurringPaymentUid = pickRecurringUid(tx);
        const terminalUid = tx?.terminal_uid || PAYPLUS_CONFIG.terminalUid;
        const customerUid = tx?.customer_uid || null;
        const cardToken = tx?.card_token || tx?.token_uid || null; // accept token_uid as well
        const cashierUid = tx?.cashier_uid || 'e2943027-94da-455e-9921-54f3bb7b8cb7';

        // 4) Fallback: pull from recurring_payments.webhook_data if missing from the transaction
        if (!recurringPaymentUid) {
            const rp = await RecurringPayment.findOne({
                where: { student_id: userId, is_active: true },
                order: [['created_at', 'DESC']],
                attributes: ['webhook_data', 'id']
            });
            const webhook = safeParseJSON(rp?.webhook_data) || {};
            recurringPaymentUid = pickRecurringUid(webhook) || pickRecurringUid(webhook?.data) || pickRecurringUid(webhook?.payload);
        }

        if (!recurringPaymentUid) {
            throw new Error('No recurring payment UID found in transaction or webhook data');
        }

        // 5) Extract duration type from subscription type (same logic as generatePaymentLink)
        const durationType = extractDurationTypeFromSubscription(subscriptionType);
        const recurringType = getPayPlusRecurringType(durationType);
        const recurringRange = getPayPlusRecurringRange(durationType, null);

        // 6) Calculate jump_payments based on duration (same as generatePaymentLink)
        let jumpPaymentValue = 30;
        if (durationType === 'quarterly') {
            jumpPaymentValue = 90;
        } else if (durationType === 'yearly') {
            jumpPaymentValue = 365;
        } else {
            jumpPaymentValue = 30; // monthly
        }

        console.log(`📊 Recurring payment settings:`, {
            durationType,
            recurringType,
            recurringRange,
            jumpPaymentValue,
            recurringPaymentUid
        });

        // 7) Build the request (matching generatePaymentLink recurring_settings structure)
        const payplusUrl = `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/Update/${recurringPaymentUid}`;
        const requestData = {
            terminal_uid: terminalUid,
            customer_uid: customerUid,
            ...(cardToken ? { card_token: cardToken } : {}),
            cashier_uid: cashierUid,
            currency_code: paymentTransaction.currency || 'ILS',
            instant_first_payment: false,
            recurring_type: recurringType, 
            recurring_range: recurringRange, // Use calculated value instead of hardcoded 1
            number_of_charges: 0,
            start_date: moment().add(1, 'month').format('YYYY-MM-DD'),
            jump_payments: jumpPaymentValue,
            send_failure_callback: true,
            ref_url_callback: `${process.env.API_BASE_URL}/api/sales/payment-callback/payplus-webhook`, // Match generatePaymentLink
            items: [
                {
                    name: `Updated ${subscriptionType} Plan`,
                    quantity: 1,
                    price: parseFloat(newAmount),
                    vat_type: 0 // No VAT (match generatePaymentLink)
                }
            ],
            successful_invoice: true,
            send_customer_success_email: true,
            customer_failure_email: true, // Match generatePaymentLink
            valid: true
        };

        console.log(`📤 PayPlus Update Request:`, {
            url: payplusUrl,
            recurring_uid: recurringPaymentUid,
            amount: newAmount,
            recurring_type: recurringType,
            recurring_range: recurringRange,
            jump_payments: jumpPaymentValue
        });

        const headers = {
            accept: 'application/json',
            'content-type': 'application/json',
            'api-key': PAYPLUS_CONFIG.apiKey,
            'secret-key': PAYPLUS_CONFIG.secretKey
        };

        const response = await axios.post(payplusUrl, requestData, { headers, timeout: 30000 });

        if (response.status === 200 && response.data) {
            console.log(`✅ PayPlus recurring payment updated successfully for user ${userId}`);
            return {
                success: true,
                data: response.data,
                message: 'PayPlus recurring payment updated successfully'
            };
        }

        throw new Error(`PayPlus API returned unsuccessful response (HTTP ${response.status})`);
    } catch (error) {
        console.error('❌ Error updating PayPlus recurring payment:', error);

        let errorMessage = 'Failed to update PayPlus recurring payment';
        if (error.response) {
            errorMessage += `: ${error.response.data || error.response.statusText}`;
        } else if (error.message) {
            errorMessage += `: ${error.message}`;
        }

        return {
            success: false,
            error: errorMessage,
            details: {
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            }
        };
    }
};

// NEW CONTROLLER FUNCTION - Check recurring payment status
const checkRecurringPaymentStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const subscription = await UserSubscriptionDetails.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    attributes: ['id', 'full_name', 'email']
                }
            ]
        });

        if (!subscription) {
            return res.status(404).json({
                status: 'error',
                message: 'User plan not found'
            });
        }

        const hasRecurringPayment = subscription.payment_status === 'online';
        let paymentMethod = 'Unknown';

        if (hasRecurringPayment) {
            const paymentTransaction = await PaymentTransaction.findOne({
                where: { student_id: subscription.user_id, status: 'success' },
                order: [['created_at', 'DESC']],
                attributes: ['response_data']
            });

            if (paymentTransaction && paymentTransaction.response_data) {
                try {
                    const responseData = typeof paymentTransaction.response_data === 'string' ? JSON.parse(paymentTransaction.response_data) : paymentTransaction.response_data;

                    paymentMethod = responseData.payment_method || responseData.brand_name || 'Credit Card';
                } catch (error) {
                    paymentMethod = 'Credit Card';
                }
            }
        }

        return res.status(200).json({
            status: 'success',
            data: {
                hasRecurringPayment,
                paymentMethod: hasRecurringPayment ? paymentMethod : null,
                paymentStatus: subscription.payment_status,
                subscriptionStatus: subscription.status
            },
            message: 'Recurring payment status retrieved successfully'
        });
    } catch (error) {
        console.error('Error checking recurring payment status:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

// NEW CONTROLLER FUNCTION - Update with PayPlus integration
const updateUserPlanWithPayPlus = async (req, res) => {
    const dbTransaction = await UserSubscriptionDetails.sequelize.transaction();

    try {
        const { id } = req.params;
        const updateData = req.body;

        const subscription = await UserSubscriptionDetails.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    attributes: ['id', 'full_name', 'email']
                }
            ],
            transaction: dbTransaction
        });

        if (!subscription) {
            await dbTransaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'User plan not found'
            });
        }

        // Check if pricing changed
        const subscriptionChanged = updateData.type && updateData.type !== subscription.type;
        const lessonsChanged = updateData.weekly_lesson && updateData.weekly_lesson !== subscription.weekly_lesson;
        const pricingChanged = subscriptionChanged || lessonsChanged;

        let payplusUpdateResult = null;

        // Update PayPlus if pricing changed and payment is online
        if (pricingChanged && subscription.payment_status === 'online') {
            console.log('💰 Pricing changed for online payment - updating PayPlus');

            const newPriceResult = await calculateSubscriptionPrice(updateData.type || subscription.type, updateData.weekly_lesson || subscription.weekly_lesson);
            const originalPrice = newPriceResult.price;

            // Apply discount if there is one (from updateData first, then existing subscription)
            let appliedDiscount = null;
            if (updateData.applied_discount !== undefined) {
                // If explicitly set (can be null to remove), use it
                appliedDiscount = updateData.applied_discount;
            } else if (subscription.discount_data) {
                // Use existing discount from subscription
                try {
                    appliedDiscount = typeof subscription.discount_data === 'string' 
                        ? JSON.parse(subscription.discount_data) 
                        : subscription.discount_data;
                } catch (error) {
                    console.error('Error parsing existing discount data:', error);
                }
            }

            // Calculate final price with discount
            const { finalPrice } = calculateFinalPriceWithDiscount(originalPrice, appliedDiscount);

            console.log(`💰 PayPlus Update Calculation:`);
            console.log(`   Original Price: ${originalPrice} ILS`);
            console.log(`   Discount: ${appliedDiscount ? (appliedDiscount.type === 'percentage' ? `${appliedDiscount.value}%` : `${appliedDiscount.value} ILS`) : 'None'}`);
            console.log(`   Final Price (with discount): ${finalPrice} ILS`);

            try {
                payplusUpdateResult = await updatePayPlusRecurringPaymentAPI(subscription.user_id, finalPrice, updateData.type || subscription.type);

                if (payplusUpdateResult.success) {
                    // Update RecurringPayment record with new amount
                    try {
                        // First try with subscription_id
                        let activeRecurringPayment = await RecurringPayment.findOne({
                            where: {
                                student_id: subscription.user_id,
                                subscription_id: subscription.id,
                                status: { [Op.in]: ['pending', 'paid'] },
                                is_active: true
                            },
                            order: [['created_at', 'DESC']],
                            transaction: dbTransaction
                        });

                        // If not found, try with student_id only
                        if (!activeRecurringPayment) {
                            console.log(`⚠️ No recurring payment found with subscription_id ${subscription.id}, trying with student_id only`);
                            activeRecurringPayment = await RecurringPayment.findOne({
                                where: {
                                    student_id: subscription.user_id,
                                    status: { [Op.in]: ['pending', 'paid'] },
                                    is_active: true
                                },
                                order: [['created_at', 'DESC']],
                                transaction: dbTransaction
                            });
                        }

                        if (activeRecurringPayment) {
                            const oldAmount = activeRecurringPayment.amount;
                            
                            // Store pricing information in new pricing_info field
                            const pricingInfo = {
                                original_price: originalPrice,
                                final_price: finalPrice,
                                discount: appliedDiscount,
                                discount_amount: originalPrice - finalPrice,
                                subscription_type: updateData.type || subscription.type,
                                weekly_lesson: updateData.weekly_lesson || subscription.weekly_lesson,
                                updated_at: new Date().toISOString(),
                                updated_by: req.user?.id || null
                            };
                            
                            await activeRecurringPayment.update({
                                amount: finalPrice,
                                subscription_id: subscription.id, // Ensure subscription_id is set
                                pricing_info: pricingInfo
                            }, { transaction: dbTransaction });
                            console.log(`✅ Updated RecurringPayment record ${activeRecurringPayment.id}: ${oldAmount} → ${finalPrice} ILS`);
                            console.log(`   Original Price: ${originalPrice} ILS, Discount: ${appliedDiscount ? (appliedDiscount.type === 'percentage' ? `${appliedDiscount.value}%` : `${appliedDiscount.value} ILS`) : 'None'}`);
                        } else {
                            console.log(`⚠️ No active recurring payment found to update for user ${subscription.user_id}, subscription ${subscription.id}`);
                        }
                    } catch (error) {
                        console.error('❌ Error updating RecurringPayment record:', error);
                        // Don't fail the entire operation if this update fails
                    }

                    await logSubscriptionPriceChange(
                        subscription.id,
                        subscription.user_id,
                        {
                            old_type: subscription.type,
                            new_type: updateData.type || subscription.type,
                            old_weekly_lesson: subscription.weekly_lesson,
                            new_weekly_lesson: updateData.weekly_lesson || subscription.weekly_lesson,
                            old_price: (await calculateSubscriptionPrice(subscription.type, subscription.weekly_lesson, subscription.plan_id)).price,
                            new_price: finalPrice // Use final price with discount applied
                        },
                        req.user?.id || null,
                        dbTransaction
                    );
                }
            } catch (error) {
                console.error('Error updating PayPlus:', error);
                payplusUpdateResult = { success: false, error: error.message };
            }
        }

        // Get current and new bonus class values
        const currentBonusClass = subscription.bonus_class || 0;
        const newBonusClass = updateData.bonus_class !== undefined ? parseInt(updateData.bonus_class) : currentBonusClass;
        
        // Get request left_lessons value (required field, use 0 as fallback)
        const requestLeftLessons = updateData.left_lessons !== undefined && updateData.left_lessons !== null && updateData.left_lessons !== "" 
            ? Number(updateData.left_lessons) 
            : 0;

        let updatedLeftLessons = 0;

        // If weekly_lesson is changed
        if (updateData.weekly_lesson !== undefined && parseInt(updateData.weekly_lesson) !== subscription.weekly_lesson) {
            const oldWeeklyLesson = subscription.weekly_lesson || 0;
            const newWeeklyLesson = parseInt(updateData.weekly_lesson);
            
            const remainingClasses = oldWeeklyLesson - requestLeftLessons;
            
            updatedLeftLessons = newWeeklyLesson - remainingClasses - currentBonusClass + newBonusClass;
        } 
        else {
            updatedLeftLessons = requestLeftLessons - currentBonusClass + newBonusClass;
        }

        if (updatedLeftLessons < 0) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Left lesson is not available more than booking class.'
            });
        }

        // Validate bonus class data
        const bonusClass = parseInt(updateData.bonus_class) || 0;
        if (bonusClass > 0) {
            if (!updateData.bonus_expire_date) {
                await dbTransaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Bonus expire date is required when bonus class is greater than 0'
                });
            }

            if (!updateData.bonus_class_reason || updateData.bonus_class_reason.trim() === '') {
                await dbTransaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Bonus class reason is required when bonus class is greater than 0'
                });
            }
        }

        // Update subscription with provided data
        const subscriptionUpdateData = { 
            updated_at: new Date()
        };

        if (updateData.type !== undefined) subscriptionUpdateData.type = updateData.type;
        if (updateData.weekly_lesson !== undefined) subscriptionUpdateData.weekly_lesson = parseInt(updateData.weekly_lesson);
        if (updateData.lesson_min !== undefined) subscriptionUpdateData.lesson_min = parseInt(updateData.lesson_min);
        if (updateData.status !== undefined) subscriptionUpdateData.status = updateData.status;
        if (subscription.left_lessons !== undefined) subscriptionUpdateData.left_lessons = updatedLeftLessons;

        if (updateData.bonus_class !== undefined) {
            subscriptionUpdateData.bonus_class = parseInt(updateData.bonus_class);

            if (updateData.bonus_class == 0) {
                subscriptionUpdateData.bonus_expire_date = null;
                subscriptionUpdateData.bonus_completed_class = 0;
            } else {
                subscriptionUpdateData.bonus_expire_date = moment(updateData.bonus_expire_date).format('YYYY-MM-DD HH:mm:ss');
            }

            // Handle bonus class data JSON with reason
            await handleBonusClassDataWithReason(subscription, updateData.bonus_class, updateData.bonus_expire_date, updateData.bonus_class_reason, req.user?.id, dbTransaction);
        }

        await subscription.update(subscriptionUpdateData, { transaction: dbTransaction });

        // Update user rollover settings
        if (updateData.next_month_subscription !== undefined || updateData.next_year_subscription !== undefined) {
            const userUpdateData = {};
            if (updateData.next_month_subscription !== undefined) {
                userUpdateData.next_month_subscription = updateData.next_month_subscription;
            }
            if (updateData.next_year_subscription !== undefined) {
                userUpdateData.next_year_subscription = updateData.next_year_subscription;
            }
            if (updateData.type !== undefined) {
                userUpdateData.subscription_type = updateData.type;
            }

            await User.update(userUpdateData, {
                where: { id: subscription.user_id },
                transaction: dbTransaction
            });
        }

        await dbTransaction.commit();

        // Fetch updated data
        const updatedSubscription = await UserSubscriptionDetails.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_id', 'status', 'next_month_subscription', 'next_year_subscription']
                },
                {
                    model: User,
                    as: 'OfflinePaymentAdmin',
                    attributes: ['id', 'full_name', 'email'],
                    required: false
                }
            ]
        });

        const response = {
            status: 'success',
            data: await formatUserPlanResponse(updatedSubscription),
            message: 'User plan updated successfully',
            payplus_update: payplusUpdateResult
        };

        if (payplusUpdateResult && !payplusUpdateResult.success) {
            response.message += ' (Warning: PayPlus update failed - manual intervention required)';
        }

        return res.status(200).json(response);
    } catch (error) {
        await dbTransaction.rollback();
        console.error('Error updating user plan with PayPlus:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

// NEW CONTROLLER FUNCTION - Direct PayPlus update
const updatePayPlusRecurringPayment = async (req, res) => {
    try {
        const { id } = req.params;
        const { new_amount, subscription_type } = req.body;

        if (!new_amount || !subscription_type) {
            return res.status(400).json({
                status: 'error',
                message: 'New amount and subscription type are required'
            });
        }

        const subscription = await UserSubscriptionDetails.findByPk(id);

        if (!subscription) {
            return res.status(404).json({
                status: 'error',
                message: 'User plan not found'
            });
        }

        if (subscription.payment_status !== 'online') {
            return res.status(400).json({
                status: 'error',
                message: 'PayPlus update only available for online payments'
            });
        }

        const result = await updatePayPlusRecurringPaymentAPI(subscription.user_id, new_amount, subscription_type);

        if (result.success) {
            const auditLog = `\n[${new Date().toISOString()}] PAYPLUS DIRECT UPDATE by Admin ${req.user?.id}: Amount changed to ${new_amount} ILS for ${subscription_type}`;
            await subscription.update({
                remarks: (subscription.remarks || '') + auditLog
            });

            return res.status(200).json({
                status: 'success',
                data: result.data,
                message: 'PayPlus recurring payment updated successfully'
            });
        } else {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to update PayPlus recurring payment',
                details: result.error
            });
        }
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

// MODIFIED FUNCTION - Updated formatUserPlanResponse to include calculated price

function safeParseJSON(input) {
    if (!input) return null;
    if (typeof input === 'object') return input;
    try {
        const once = JSON.parse(input);
        if (typeof once === 'string' && once.trim().startsWith('{')) {
            try {
                return JSON.parse(once);
            } catch {
                /* ignore */
            }
        }
        return once;
    } catch {
        return null;
    }
}

function pickRecurringUid(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const candidates = [
        obj.recurring_payment_uid,
        obj.recurring_uid,
        obj.recurringPaymentUid,
        obj?.recurring?.uid,
        obj?.recurring_payment?.uid,
        obj?.data?.recurring_payment_uid,
        obj?.data?.recurring_uid
    ];
    for (const uid of candidates) {
        if (uid && String(uid).trim()) return String(uid).trim();
    }
    // last resort: scan keys
    for (const [k, v] of Object.entries(obj)) {
        if (/recurring.*uid/i.test(k) && v) return String(v).trim();
    }
    return null;
}

/**
 * Calculate price - Database first, then payment generator logic
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const calculatePriceFromDatabase = async (req, res) => {
    try {
        const { subscription_type, lessons_per_month } = req.body;

        console.log(`📊 Calculate price request: ${subscription_type} with ${lessons_per_month} lessons/month`);

        if (!subscription_type || !lessons_per_month) {
            return res.status(400).json({
                status: 'error',
                message: 'Subscription type and lessons per month are required'
            });
        }

        const lessonsPerMonthInt = parseInt(lessons_per_month);
        if (isNaN(lessonsPerMonthInt) || lessonsPerMonthInt <= 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Lessons per month must be a valid positive number'
            });
        }

        const result = await calculateSubscriptionPrice(subscription_type, lessonsPerMonthInt);

        // Ensure we always return a valid price (even if it's from fallback)
        if (result.price <= 0) {
            console.warn(`⚠️ Price calculation returned 0 or negative value. Using fallback calculation.`);
            // Force fallback calculation
            const fallbackPrice = calculatePaymentGeneratorPrice(subscription_type, lessonsPerMonthInt);
            return res.status(200).json({
                status: 'success',
                data: {
                    price: fallbackPrice,
                    plan_id: null,
                    subscription_type,
                    lessons_per_month: lessonsPerMonthInt,
                    pricing_method: 'payment_generator_fallback'
                },
                message: 'Price calculated using fallback method'
            });
        }

        return res.status(200).json({
            status: 'success',
            data: {
                price: result.price,
                plan_id: result.planId,
                subscription_type,
                lessons_per_month: lessonsPerMonthInt,
                pricing_method: result.planId ? 'database_plan' : (result.price > 0 ? 'payment_generator' : 'unknown')
            },
            message: 'Price calculated successfully'
        });
    } catch (error) {
        console.error('❌ Error in calculatePriceFromDatabase:', error);
        console.error('Error stack:', error.stack);
        
        // Try to return fallback price even on error
        try {
            const { subscription_type, lessons_per_month } = req.body;
            const fallbackPrice = calculatePaymentGeneratorPrice(subscription_type, parseInt(lessons_per_month) || 4);
            return res.status(200).json({
                status: 'success',
                data: {
                    price: fallbackPrice,
                    plan_id: null,
                    subscription_type: subscription_type || 'Monthly_25',
                    lessons_per_month: parseInt(lessons_per_month) || 4,
                    pricing_method: 'payment_generator_error_fallback'
                },
                message: 'Price calculated using fallback method due to error'
            });
        } catch (fallbackError) {
            return res.status(500).json({
                status: 'error',
                message: 'Internal server error',
                details: error.message
            });
        }
    }
};

module.exports = {
    getUserPlans,
    getUserPlanById,
    createUserPlan,
    updateUserPlan,
    // ADD these new exports:
    updateUserPlanWithPayPlus,
    updatePayPlusRecurringPayment,
    checkRecurringPaymentStatus,
    // ... rest of existing exports
    deleteUserPlan,
    getUserPlanAnalytics,
    getUsersForDropdown,
    getUserPlanStats,
    downloadUserPlanInvoice,
    refreshBonusClasses,
    getBonusClassHistory,
    getOverviewStats,
    calculatePriceFromDatabase,
    exportUserPlansCSV,
    getMarch2026OnlineSubscriptionsPlanMismatch,
    fixMarch2026OnlineSubscriptionsPlanMismatch
};
