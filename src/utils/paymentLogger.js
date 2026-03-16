// utils/paymentLogger.js
const fs = require('fs');
const path = require('path');
const moment = require('moment');

// Setup logging directories
const logsDir = path.join(__dirname, '../logs');
const webhookLogsDir = path.join(logsDir, 'webhooks');
const paymentLinksDir = path.join(logsDir, 'payment-links');

/**
 * Enhanced logging utility for payment operations
 */
class PaymentLogger {
    constructor() {
        this.logLevels = {
            ERROR: 'ERROR',
            WARN: 'WARN',
            INFO: 'INFO',
            SUCCESS: 'SUCCESS',
            DEBUG: 'DEBUG'
        };
        
        // Initialize directories
        this.initializeDirectories();
    }

    /**
     * Initialize and create all required directories
     */
    initializeDirectories() {
        const directories = [logsDir, webhookLogsDir, paymentLinksDir];
        
        directories.forEach(dir => {
            try {
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                    console.log(`Created directory: ${dir}`);
                }
            } catch (error) {
                console.error(`Failed to create directory ${dir}:`, error);
            }
        });
    }

    /**
     * Ensure directory exists before writing file
     */
    ensureDirectoryExists(filePath) {
        const directory = path.dirname(filePath);
        
        try {
            if (!fs.existsSync(directory)) {
                fs.mkdirSync(directory, { recursive: true });
                console.log(`Created missing directory: ${directory}`);
            }
            return true;
        } catch (error) {
            console.error(`Failed to create directory ${directory}:`, error);
            return false;
        }
    }

    /**
     * Get log file path based on type and date
     */
    getLogFilePath(logType, date = null) {
        const logDate = date || moment().format('YYYY-MM-DD');
        
        switch (logType) {
            case 'webhook':
                return path.join(webhookLogsDir, `webhook-events-${logDate}.log`);
            case 'payment-link':
                return path.join(paymentLinksDir, `payment-links-${logDate}.log`);
            case 'payment-verification':
                return path.join(logsDir, `payment-verification-${logDate}.log`);
            case 'monthly-classes':
                return path.join(logsDir, `monthly-classes-${logDate}.log`);
            default:
                return path.join(logsDir, `general-${logDate}.log`);
        }
    }

    /**
     * Write log entry to file with proper error handling
     */
    writeLog(logType, level, message, metadata = null) {
        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss.SSS');
        const logFile = this.getLogFilePath(logType);
        
        // Ensure directory exists before writing
        if (!this.ensureDirectoryExists(logFile)) {
            console.error(`Cannot write log - directory creation failed for: ${logFile}`);
            return;
        }
        
        // Create structured log entry
        const logEntry = {
            timestamp: timestamp,
            level: level,
            message: message,
            metadata: metadata,
            process_id: process.pid,
            memory_usage: process.memoryUsage()
        };

        // Format for file output
        const fileLogEntry = `[${timestamp}] [${level}] ${message}${metadata ? '\nMETADATA: ' + JSON.stringify(metadata, null, 2) : ''}\n${'='.repeat(80)}\n`;

        try {
            // Use appendFileSync with explicit error handling
            fs.appendFileSync(logFile, fileLogEntry, { encoding: 'utf8' });
            
            // Also log to console with appropriate level
            this.logToConsole(logType, level, message, metadata);
            
        } catch (error) {
            console.error(`Failed to write to log file ${logFile}:`, error);
            // Fallback: try to log to general log file
            this.fallbackLog(logType, level, message, metadata, error);
        }
    }

    /**
     * Log to console with appropriate formatting
     */
    logToConsole(logType, level, message, metadata) {
        const logPrefix = `[PAYMENT ${logType.toUpperCase()}]`;
        
        switch (level) {
            case this.logLevels.ERROR:
                console.error(`${logPrefix} ${message}`, metadata || '');
                break;
            case this.logLevels.WARN:
                console.warn(`${logPrefix} ${message}`, metadata || '');
                break;
            case this.logLevels.SUCCESS:
                console.log(`✅ ${logPrefix} ${message}`, metadata || '');
                break;
            default:
                console.log(`${logPrefix} ${message}`, metadata || '');
        }
    }

    /**
     * Fallback logging when primary log file fails
     */
    fallbackLog(originalLogType, level, message, metadata, originalError) {
        try {
            const fallbackFile = path.join(logsDir, `fallback-${moment().format('YYYY-MM-DD')}.log`);
            this.ensureDirectoryExists(fallbackFile);
            
            const fallbackEntry = `[${moment().format('YYYY-MM-DD HH:mm:ss')}] [FALLBACK] [${level}] ` +
                                  `Original log type: ${originalLogType}\n` +
                                  `Original error: ${originalError.message}\n` +
                                  `Message: ${message}\n` +
                                  `Metadata: ${metadata ? JSON.stringify(metadata) : 'None'}\n` +
                                  `${'='.repeat(80)}\n`;
            
            fs.appendFileSync(fallbackFile, fallbackEntry, { encoding: 'utf8' });
            console.log(`✅ Logged to fallback file: ${fallbackFile}`);
            
        } catch (fallbackError) {
            console.error('Even fallback logging failed:', fallbackError);
            // Last resort: just console log everything
            console.error('CRITICAL - All file logging failed. Original message:', { 
                logType: originalLogType, 
                level, 
                message, 
                metadata, 
                originalError: originalError.message 
            });
        }
    }

    /**
     * Log webhook events with detailed tracking
     */
    logWebhookEvent(eventData) {
        const {
            event_type,
            transaction_uid,
            status,
            amount,
            currency,
            customer_email,
            customer_name,
            payment_method,
            error_details = null,
            processing_result = null,
            webhook_payload = null
        } = eventData;

        const level = status === 'success' ? this.logLevels.SUCCESS : 
                     status === 'failed' ? this.logLevels.ERROR : this.logLevels.INFO;

        const message = `WEBHOOK ${event_type?.toUpperCase() || 'UNKNOWN'}: ${transaction_uid} - ${status?.toUpperCase() || 'UNKNOWN'}`;
        
        const metadata = {
            event_details: {
                transaction_uid: transaction_uid,
                event_type: event_type,
                status: status,
                processing_timestamp: moment().toISOString()
            },
            payment_info: {
                amount: amount,
                currency: currency,
                payment_method: payment_method
            },
            customer_info: {
                email: customer_email,
                name: customer_name
            },
            processing_result: processing_result,
            error_details: error_details,
            raw_webhook: webhook_payload ? {
                size_bytes: JSON.stringify(webhook_payload).length,
                keys_count: Object.keys(webhook_payload).length,
                has_data: !!webhook_payload.data,
                has_transaction: !!webhook_payload.transaction
            } : null
        };

        this.writeLog('webhook', level, message, metadata);
    }

    /**
     * Log payment link generation with comprehensive details
     */
    logPaymentLinkGeneration(linkData) {
        const {
            success,
            student_id,
            student_email,
            student_name,
            plan_details,
            amount,
            currency,
            is_recurring,
            payment_url = null,
            page_request_uid = null,
            trial_payment_link_id = null,
            error_details = null,
            request_details = null,
            generated_by = null
        } = linkData;

        const level = success ? this.logLevels.SUCCESS : this.logLevels.ERROR;
        const status = success ? 'SUCCESS' : 'FAILED';
        
        const message = `PAYMENT LINK ${status}: Student ${student_id || 'N/A'} (${student_email || 'N/A'}) - Amount: ${amount} ${currency}`;
        
        const metadata = {
            link_generation: {
                success: success,
                generated_at: moment().toISOString(),
                generated_by: generated_by
            },
            student_details: {
                student_id: student_id,
                student_email: student_email,
                student_name: student_name
            },
            payment_details: {
                amount: parseFloat(amount || 0),
                currency: currency || 'ILS',
                is_recurring: is_recurring,
                plan_details: plan_details
            },
            result_data: success ? {
                payment_url: payment_url,
                page_request_uid: page_request_uid,
                trial_payment_link_id: trial_payment_link_id,
                url_length: payment_url ? payment_url.length : 0
            } : null,
            error_details: error_details,
            request_metadata: request_details
        };

        this.writeLog('payment-link', level, message, metadata);
    }

    /**
     * Log payment verification events during monthly class creation
     */
    logPaymentVerification(verificationData) {
        const {
            student_id,
            student_name,
            subscription_id,
            verification_type,
            verification_result,
            subscription_details = null,
            payment_history = null,
            error_details = null,
            regular_class_id = null
        } = verificationData;

        const level = verification_result ? this.logLevels.SUCCESS : this.logLevels.WARN;
        
        const message = `PAYMENT VERIFICATION ${verification_type}: Student ${student_id} (${student_name}) - Result: ${verification_result ? 'PASSED' : 'FAILED'}`;
        
        const metadata = {
            verification_details: {
                student_id: student_id,
                student_name: student_name,
                subscription_id: subscription_id,
                verification_type: verification_type,
                verification_result: verification_result,
                verified_at: moment().toISOString(),
                regular_class_id: regular_class_id
            },
            subscription_status: subscription_details,
            payment_history_summary: payment_history,
            error_details: error_details
        };

        this.writeLog('payment-verification', level, message, metadata);
    }

    /**
     * Log subscription status changes
     */
    logSubscriptionChange(changeData) {
        const {
            user_id,
            subscription_id,
            change_type,
            previous_status,
            new_status,
            triggered_by,
            payment_transaction_id = null,
            additional_details = null
        } = changeData;

        const level = this.logLevels.INFO;
        const message = `SUBSCRIPTION CHANGE: User ${user_id} - ${change_type} - ${previous_status} → ${new_status}`;
        
        const metadata = {
            subscription_change: {
                user_id: user_id,
                subscription_id: subscription_id,
                change_type: change_type,
                previous_status: previous_status,
                new_status: new_status,
                triggered_by: triggered_by,
                changed_at: moment().toISOString(),
                payment_transaction_id: payment_transaction_id
            },
            additional_details: additional_details
        };

        this.writeLog('payment-verification', level, message, metadata);
    }

    /**
     * Log trial class status changes with payment context
     */
    logTrialClassStatusChange(statusData) {
        const {
            trial_class_id,
            student_id,
            previous_status,
            new_status,
            changed_by,
            payment_context = null,
            trial_payment_link_id = null
        } = statusData;

        const level = this.logLevels.INFO;
        const message = `TRIAL STATUS CHANGE: Class ${trial_class_id} - ${previous_status} → ${new_status}`;
        
        const metadata = {
            status_change: {
                trial_class_id: trial_class_id,
                student_id: student_id,
                previous_status: previous_status,
                new_status: new_status,
                changed_by: changed_by,
                changed_at: moment().toISOString(),
                trial_payment_link_id: trial_payment_link_id
            },
            payment_context: payment_context
        };

        this.writeLog('payment-verification', level, message, metadata);
    }

    /**
     * Log monthly class creation results with payment verification
     */
    logMonthlyClassCreation(classData) {
        const {
            regular_class_id,
            student_id,
            teacher_id,
            classes_created,
            classes_failed,
            batch_id,
            subscription_verification,
            payment_verification,
            failure_reasons = []
        } = classData;

        const level = classes_created > 0 ? this.logLevels.SUCCESS : this.logLevels.WARN;
        const message = `MONTHLY CLASS CREATION: Regular Class ${regular_class_id} - Created: ${classes_created}, Failed: ${classes_failed}`;
        
        const metadata = {
            class_creation: {
                regular_class_id: regular_class_id,
                student_id: student_id,
                teacher_id: teacher_id,
                classes_created: classes_created,
                classes_failed: classes_failed,
                batch_id: batch_id,
                processed_at: moment().toISOString()
            },
            verification_results: {
                subscription_verification: subscription_verification,
                payment_verification: payment_verification
            },
            failure_analysis: failure_reasons
        };

        this.writeLog('monthly-classes', level, message, metadata);
    }

    /**
     * Test logging functionality
     */
    testLogging() {
        console.log('Testing PaymentLogger functionality...');
        
        // Test each log type
        this.writeLog('webhook', this.logLevels.INFO, 'Testing webhook logging');
        this.writeLog('payment-link', this.logLevels.INFO, 'Testing payment link logging');
        this.writeLog('payment-verification', this.logLevels.INFO, 'Testing payment verification logging');
        this.writeLog('monthly-classes', this.logLevels.INFO, 'Testing monthly classes logging');
        
        console.log('✅ PaymentLogger test completed');
    }

    /**
     * Clean up old log files (keep last 30 days)
     */
    cleanupOldLogs() {
        const cutoffDate = moment().subtract(30, 'days');
        const logDirectories = [webhookLogsDir, paymentLinksDir, logsDir];

        logDirectories.forEach(dir => {
            try {
                if (!fs.existsSync(dir)) {
                    console.log(`Directory does not exist, skipping cleanup: ${dir}`);
                    return;
                }
                
                const files = fs.readdirSync(dir);
                files.forEach(file => {
                    if (file.endsWith('.log')) {
                        const filePath = path.join(dir, file);
                        const stats = fs.statSync(filePath);
                        const fileDate = moment(stats.birthtime);
                        
                        if (fileDate.isBefore(cutoffDate)) {
                            fs.unlinkSync(filePath);
                            console.log(`Cleaned up old log file: ${file}`);
                        }
                    }
                });
            } catch (error) {
                console.error(`Error cleaning up logs in ${dir}:`, error);
            }
        });
    }

    /**
     * Generate daily summary report
     */
    generateDailySummary(date = null) {
        const reportDate = date || moment().format('YYYY-MM-DD');
        
        try {
            // Read webhook logs
            const webhookLogFile = this.getLogFilePath('webhook', reportDate);
            const paymentLinkLogFile = this.getLogFilePath('payment-link', reportDate);
            
            const summary = {
                date: reportDate,
                webhook_events: {
                    total: 0,
                    successful: 0,
                    failed: 0
                },
                payment_links: {
                    total: 0,
                    successful: 0,
                    failed: 0
                },
                generated_at: moment().toISOString()
            };

            // Count webhook events
            if (fs.existsSync(webhookLogFile)) {
                const webhookContent = fs.readFileSync(webhookLogFile, 'utf8');
                const webhookLines = webhookContent.split('\n').filter(line => line.includes('[SUCCESS]') || line.includes('[ERROR]'));
                summary.webhook_events.total = webhookLines.length;
                summary.webhook_events.successful = webhookLines.filter(line => line.includes('[SUCCESS]')).length;
                summary.webhook_events.failed = webhookLines.filter(line => line.includes('[ERROR]')).length;
            }

            // Count payment link generation
            if (fs.existsSync(paymentLinkLogFile)) {
                const linkContent = fs.readFileSync(paymentLinkLogFile, 'utf8');
                const linkLines = linkContent.split('\n').filter(line => line.includes('[SUCCESS]') || line.includes('[ERROR]'));
                summary.payment_links.total = linkLines.length;
                summary.payment_links.successful = linkLines.filter(line => line.includes('[SUCCESS]')).length;
                summary.payment_links.failed = linkLines.filter(line => line.includes('[ERROR]')).length;
            }

            // Ensure summary directory exists
            this.ensureDirectoryExists(path.join(logsDir, 'temp'));
            
            // Write summary to file
            const summaryFile = path.join(logsDir, `daily-summary-${reportDate}.json`);
            fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
            
            return summary;
        } catch (error) {
            console.error('Error generating daily summary:', error);
            return null;
        }
    }
}

// Create singleton instance
const paymentLogger = new PaymentLogger();

// Export both the class and instance
module.exports = {
    PaymentLogger,
    paymentLogger
};