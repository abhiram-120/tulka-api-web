// utils/familyPaymentLogger.js
const fs = require('fs');
const path = require('path');
const moment = require('moment');

// Setup logging directories
const logsDir = path.join(__dirname, '../logs');
const familyWebhookLogsDir = path.join(logsDir, 'family-webhooks');
const familyPaymentLinksDir = path.join(logsDir, 'family-payment-links');
const familyTransactionsDir = path.join(logsDir, 'family-transactions');

/**
 * Enhanced logging utility for family payment operations
 */
class FamilyPaymentLogger {
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
        const directories = [
            logsDir, 
            familyWebhookLogsDir, 
            familyPaymentLinksDir,
            familyTransactionsDir
        ];
        
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
            case 'family-webhook':
                return path.join(familyWebhookLogsDir, `family-webhook-events-${logDate}.log`);
            case 'family-payment-link':
                return path.join(familyPaymentLinksDir, `family-payment-links-${logDate}.log`);
            case 'family-transaction':
                return path.join(familyTransactionsDir, `family-transactions-${logDate}.log`);
            case 'family-recurring':
                return path.join(logsDir, `family-recurring-${logDate}.log`);
            case 'family-notification':
                return path.join(logsDir, `family-notifications-${logDate}.log`);
            default:
                return path.join(logsDir, `family-general-${logDate}.log`);
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
        const logPrefix = `[FAMILY ${logType.toUpperCase()}]`;
        
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
            const fallbackFile = path.join(logsDir, `family-fallback-${moment().format('YYYY-MM-DD')}.log`);
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
     * Log family payment link generation events
     */
    logFamilyPaymentLinkGeneration(linkData) {
        const {
            success,
            link_token,
            sales_user_id,
            children_count,
            families_count,
            total_amount,
            currency,
            payment_type,
            children_details,
            payment_url,
            page_request_uid,
            error_details = null,
            processing_time_ms = null
        } = linkData;

        const level = success ? this.logLevels.SUCCESS : this.logLevels.ERROR;
        const status = success ? 'SUCCESS' : 'FAILED';
        
        const message = `FAMILY PAYMENT LINK ${status}: Token ${link_token} - ${children_count} children, ${families_count} families - Amount: ${total_amount} ${currency}`;
        
        const metadata = {
            link_generation: {
                success: success,
                generated_at: moment().toISOString(),
                generated_by: sales_user_id,
                processing_time_ms: processing_time_ms
            },
            family_details: {
                link_token: link_token,
                children_count: children_count,
                families_count: families_count,
                payment_type: payment_type
            },
            payment_details: {
                total_amount: parseFloat(total_amount || 0),
                currency: currency || 'ILS',
                individual_children: children_details?.map(child => ({
                    child_id: child.childId,
                    child_name: child.childName,
                    amount: child.amount,
                    plan_type: child.planType
                })) || []
            },
            result_data: success ? {
                payment_url: payment_url,
                page_request_uid: page_request_uid,
                url_length: payment_url ? payment_url.length : 0
            } : null,
            error_details: error_details
        };

        this.writeLog('family-payment-link', level, message, metadata);
    }

    /**
     * Log family webhook events
     */
    logFamilyWebhookEvent(eventData) {
        const {
            event_type,
            transaction_uid,
            link_token,
            status,
            amount,
            currency,
            payment_type,
            children_count,
            families_count,
            metadata_decoded,
            error_details = null,
            processing_result = null,
            webhook_payload = null
        } = eventData;

        const level = status === 'success' ? this.logLevels.SUCCESS : 
                     status === 'failed' ? this.logLevels.ERROR : this.logLevels.INFO;

        const message = `FAMILY WEBHOOK ${event_type?.toUpperCase() || 'UNKNOWN'}: ${transaction_uid} - Token: ${link_token} - ${status?.toUpperCase() || 'UNKNOWN'}`;
        
        const metadata = {
            event_details: {
                transaction_uid: transaction_uid,
                link_token: link_token,
                event_type: event_type,
                status: status,
                processing_timestamp: moment().toISOString()
            },
            family_payment_info: {
                amount: amount,
                currency: currency,
                payment_type: payment_type,
                children_count: children_count,
                families_count: families_count
            },
            decoded_metadata: metadata_decoded,
            processing_result: processing_result,
            error_details: error_details,
            raw_webhook: webhook_payload ? {
                size_bytes: JSON.stringify(webhook_payload).length,
                keys_count: Object.keys(webhook_payload).length,
                has_metadata: !!webhook_payload.more_info_5
            } : null
        };

        this.writeLog('family-webhook', level, message, metadata);
    }

    /**
     * Log family transaction processing
     */
    logFamilyTransactionProcessing(transactionData) {
        const {
            transaction_id,
            link_token,
            payment_link_id,
            paid_children_ids,
            paid_children_details,
            amount,
            currency,
            payment_type,
            status,
            payment_method,
            processing_stage,
            success,
            error_details = null,
            metadata_extracted = null
        } = transactionData;

        const level = success ? this.logLevels.SUCCESS : this.logLevels.ERROR;
        const message = `FAMILY TRANSACTION ${processing_stage?.toUpperCase()}: ${transaction_id} - ${paid_children_ids?.length || 0} children - ${status}`;
        
        const metadata = {
            transaction_details: {
                transaction_id: transaction_id,
                link_token: link_token,
                payment_link_id: payment_link_id,
                processing_stage: processing_stage,
                processed_at: moment().toISOString()
            },
            children_processing: {
                paid_children_count: paid_children_ids?.length || 0,
                paid_children_ids: paid_children_ids,
                children_details: paid_children_details?.map(child => ({
                    child_id: child.childId,
                    child_name: child.childName,
                    amount: child.amount,
                    family_id: child.familyId
                })) || []
            },
            payment_info: {
                amount: amount,
                currency: currency,
                payment_type: payment_type,
                status: status,
                payment_method: payment_method
            },
            extracted_metadata: metadata_extracted,
            processing_result: {
                success: success,
                error_details: error_details
            }
        };

        this.writeLog('family-transaction', level, message, metadata);
    }

    /**
     * Log individual child recurring payment setup
     */
    logChildRecurringPaymentSetup(childData) {
        const {
            child_id,
            child_name,
            family_id,
            parent_token,
            customer_uid,
            subscription_id,
            amount,
            duration_months,
            recurring_type,
            recurring_range,
            success,
            error_message = null,
            payplus_response = null
        } = childData;

        const level = success ? this.logLevels.SUCCESS : this.logLevels.ERROR;
        const message = `CHILD RECURRING SETUP ${success ? 'SUCCESS' : 'FAILED'}: Child ${child_id} (${child_name}) - ${amount} every ${recurring_range} months`;
        
        const metadata = {
            child_details: {
                child_id: child_id,
                child_name: child_name,
                family_id: family_id,
                setup_at: moment().toISOString()
            },
            recurring_config: {
                parent_token: parent_token ? `${parent_token.substring(0, 8)}...` : null,
                customer_uid: customer_uid,
                subscription_id: subscription_id,
                amount: amount,
                duration_months: duration_months,
                recurring_type: recurring_type,
                recurring_range: recurring_range
            },
            processing_result: {
                success: success,
                error_message: error_message,
                payplus_response_status: payplus_response?.results?.status || null
            }
        };

        this.writeLog('family-recurring', level, message, metadata);
    }

    /**
     * Log family notification sending (email/WhatsApp)
     */
    logFamilyNotification(notificationData) {
        const {
            notification_type, // 'email' | 'whatsapp'
            template_name,
            recipient_email,
            recipient_phone,
            parent_name,
            children_count,
            total_amount,
            payment_link,
            success,
            error_details = null
        } = notificationData;

        const level = success ? this.logLevels.SUCCESS : this.logLevels.ERROR;
        const message = `FAMILY ${notification_type?.toUpperCase()} ${success ? 'SENT' : 'FAILED'}: ${parent_name} - ${children_count} children`;
        
        const metadata = {
            notification_details: {
                notification_type: notification_type,
                template_name: template_name,
                sent_at: moment().toISOString(),
                recipient: notification_type === 'email' ? recipient_email : recipient_phone
            },
            family_info: {
                parent_name: parent_name,
                children_count: children_count,
                total_amount: total_amount,
                payment_link_provided: !!payment_link
            },
            delivery_result: {
                success: success,
                error_details: error_details
            }
        };

        this.writeLog('family-notification', level, message, metadata);
    }

    /**
     * Log family payment status changes
     */
    logFamilyPaymentStatusChange(statusData) {
        const {
            payment_link_id,
            link_token,
            previous_status,
            new_status,
            children_affected,
            transaction_id,
            action_type, // 'webhook_update', 'manual_update', 'expiry', etc.
            changed_by,
            additional_details = null
        } = statusData;

        const level = this.logLevels.INFO;
        const message = `FAMILY PAYMENT STATUS CHANGE: Link ${link_token} - ${previous_status} → ${new_status} - ${action_type}`;
        
        const metadata = {
            status_change: {
                payment_link_id: payment_link_id,
                link_token: link_token,
                previous_status: previous_status,
                new_status: new_status,
                action_type: action_type,
                changed_by: changed_by,
                changed_at: moment().toISOString(),
                transaction_id: transaction_id
            },
            affected_children: {
                children_count: children_affected?.length || 0,
                children_list: children_affected || []
            },
            additional_details: additional_details
        };

        this.writeLog('family-transaction', level, message, metadata);
    }

    /**
     * Log family payment link usage/access
     */
    logFamilyPaymentLinkAccess(accessData) {
        const {
            link_token,
            access_type, // 'view', 'payment_attempt', 'success', 'failure'
            user_agent,
            ip_address,
            children_details,
            payment_method = null,
            amount = null
        } = accessData;

        const level = this.logLevels.INFO;
        const message = `FAMILY LINK ACCESS: ${link_token} - ${access_type?.toUpperCase()}`;
        
        const metadata = {
            access_details: {
                link_token: link_token,
                access_type: access_type,
                accessed_at: moment().toISOString(),
                user_agent: user_agent,
                ip_address: ip_address
            },
            payment_context: {
                children_count: children_details?.length || 0,
                payment_method: payment_method,
                amount: amount
            }
        };

        this.writeLog('family-payment-link', level, message, metadata);
    }

    /**
     * Test family payment logging functionality
     */
    testFamilyLogging() {
        console.log('Testing FamilyPaymentLogger functionality...');
        
        // Test each log type
        this.writeLog('family-webhook', this.logLevels.INFO, 'Testing family webhook logging');
        this.writeLog('family-payment-link', this.logLevels.INFO, 'Testing family payment link logging');
        this.writeLog('family-transaction', this.logLevels.INFO, 'Testing family transaction logging');
        this.writeLog('family-recurring', this.logLevels.INFO, 'Testing family recurring logging');
        this.writeLog('family-notification', this.logLevels.INFO, 'Testing family notification logging');
        
        console.log('✅ FamilyPaymentLogger test completed');
    }

    /**
     * Clean up old log files (keep last 30 days)
     */
    cleanupOldLogs() {
        const cutoffDate = moment().subtract(30, 'days');
        const logDirectories = [
            familyWebhookLogsDir, 
            familyPaymentLinksDir, 
            familyTransactionsDir,
            logsDir
        ];

        logDirectories.forEach(dir => {
            try {
                if (!fs.existsSync(dir)) {
                    console.log(`Directory does not exist, skipping cleanup: ${dir}`);
                    return;
                }
                
                const files = fs.readdirSync(dir);
                files.forEach(file => {
                    if (file.endsWith('.log') && file.includes('family-')) {
                        const filePath = path.join(dir, file);
                        const stats = fs.statSync(filePath);
                        const fileDate = moment(stats.birthtime);
                        
                        if (fileDate.isBefore(cutoffDate)) {
                            fs.unlinkSync(filePath);
                            console.log(`Cleaned up old family log file: ${file}`);
                        }
                    }
                });
            } catch (error) {
                console.error(`Error cleaning up family logs in ${dir}:`, error);
            }
        });
    }

    /**
     * Generate daily family payment summary report
     */
    generateFamilyDailySummary(date = null) {
        const reportDate = date || moment().format('YYYY-MM-DD');
        
        try {
            const webhookLogFile = this.getLogFilePath('family-webhook', reportDate);
            const paymentLinkLogFile = this.getLogFilePath('family-payment-link', reportDate);
            const transactionLogFile = this.getLogFilePath('family-transaction', reportDate);
            
            const summary = {
                date: reportDate,
                family_webhooks: {
                    total: 0,
                    successful: 0,
                    failed: 0
                },
                family_payment_links: {
                    total: 0,
                    successful: 0,
                    failed: 0
                },
                family_transactions: {
                    total: 0,
                    successful: 0,
                    failed: 0
                },
                generated_at: moment().toISOString()
            };

            // Count webhook events
            if (fs.existsSync(webhookLogFile)) {
                const webhookContent = fs.readFileSync(webhookLogFile, 'utf8');
                const webhookLines = webhookContent.split('\n').filter(line => 
                    line.includes('[SUCCESS]') || line.includes('[ERROR]')
                );
                summary.family_webhooks.total = webhookLines.length;
                summary.family_webhooks.successful = webhookLines.filter(line => 
                    line.includes('[SUCCESS]')
                ).length;
                summary.family_webhooks.failed = webhookLines.filter(line => 
                    line.includes('[ERROR]')
                ).length;
            }

            // Count payment link generation
            if (fs.existsSync(paymentLinkLogFile)) {
                const linkContent = fs.readFileSync(paymentLinkLogFile, 'utf8');
                const linkLines = linkContent.split('\n').filter(line => 
                    line.includes('[SUCCESS]') || line.includes('[ERROR]')
                );
                summary.family_payment_links.total = linkLines.length;
                summary.family_payment_links.successful = linkLines.filter(line => 
                    line.includes('[SUCCESS]')
                ).length;
                summary.family_payment_links.failed = linkLines.filter(line => 
                    line.includes('[ERROR]')
                ).length;
            }

            // Count transaction processing
            if (fs.existsSync(transactionLogFile)) {
                const transactionContent = fs.readFileSync(transactionLogFile, 'utf8');
                const transactionLines = transactionContent.split('\n').filter(line => 
                    line.includes('[SUCCESS]') || line.includes('[ERROR]')
                );
                summary.family_transactions.total = transactionLines.length;
                summary.family_transactions.successful = transactionLines.filter(line => 
                    line.includes('[SUCCESS]')
                ).length;
                summary.family_transactions.failed = transactionLines.filter(line => 
                    line.includes('[ERROR]')
                ).length;
            }

            // Write summary to file
            const summaryFile = path.join(logsDir, `family-daily-summary-${reportDate}.json`);
            fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
            
            return summary;
        } catch (error) {
            console.error('Error generating family daily summary:', error);
            return null;
        }
    }
}

// Create singleton instance
const familyPaymentLogger = new FamilyPaymentLogger();

// Export both the class and instance
module.exports = {
    FamilyPaymentLogger,
    familyPaymentLogger
};