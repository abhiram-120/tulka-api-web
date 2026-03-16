// utils/classDeletionLogger.js
const fs = require('fs');
const path = require('path');
const moment = require('moment');

// Setup logging directories
const logsDir = process.env.VERCEL
    ? path.join('/tmp', 'tulkka-logs')
    : path.join(__dirname, '../logs');
const classDeletionLogsDir = path.join(logsDir, 'class-deletions');

/**
 * Enhanced logging utility for class deletion operations
 */
class ClassDeletionLogger {
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
        const directories = [logsDir, classDeletionLogsDir];
        
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
            case 'class-deletion':
                return path.join(classDeletionLogsDir, `class-deletions-${logDate}.log`);
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
        const logPrefix = `[CLASS DELETION]`;
        
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
     * Log class deletion events with detailed tracking
     */
    logClassDeletion(deletionData) {
        const {
            class_id,
            class_type = 'regular', // 'regular', 'trial', 'regular_class_pattern'
            student_id,
            student_name,
            teacher_id,
            meeting_start,
            meeting_end,
            status,
            deleted_by,
            deleted_by_role, // 'admin', 'sales', 'teacher', 'user', 'system'
            deletion_reason,
            deletion_source, // 'admin_panel', 'sales_panel', 'api', 'cronjob', 'system'
            associated_records_deleted = null,
            subscription_updated = false,
            lessons_refunded = 0,
            error_details = null,
            class_data = null
        } = deletionData;

        const level = error_details ? this.logLevels.ERROR : this.logLevels.SUCCESS;
        const statusText = error_details ? 'FAILED' : 'SUCCESS';
        
        const message = `CLASS DELETION ${statusText}: Class ${class_id} (${class_type}) - Student: ${student_id} (${student_name || 'N/A'})`;
        
        const metadata = {
            deletion_details: {
                class_id: class_id,
                class_type: class_type,
                student_id: student_id,
                student_name: student_name,
                teacher_id: teacher_id,
                meeting_start: meeting_start ? moment(meeting_start).toISOString() : null,
                meeting_end: meeting_end ? moment(meeting_end).toISOString() : null,
                status: status,
                deleted_at: moment().toISOString(),
                deleted_by: deleted_by,
                deleted_by_role: deleted_by_role,
                deletion_reason: deletion_reason,
                deletion_source: deletion_source
            },
            impact_analysis: {
                subscription_updated: subscription_updated,
                lessons_refunded: lessons_refunded,
                associated_records_deleted: associated_records_deleted
            },
            class_snapshot: class_data,
            error_details: error_details
        };

        this.writeLog('class-deletion', level, message, metadata);
    }

    /**
     * Log bulk class deletion events
     */
    logBulkClassDeletion(bulkDeletionData) {
        const {
            deletion_source,
            deleted_by,
            deleted_by_role,
            deletion_reason,
            total_deleted,
            classes_deleted = [],
            errors = [],
            subscription_updates = [],
            lessons_refunded_total = 0
        } = bulkDeletionData;

        const level = errors.length > 0 ? this.logLevels.WARN : this.logLevels.SUCCESS;
        const statusText = errors.length > 0 ? 'PARTIAL' : 'SUCCESS';
        
        const message = `BULK CLASS DELETION ${statusText}: ${total_deleted} classes deleted by ${deleted_by_role} (${deleted_by})`;
        
        const metadata = {
            bulk_deletion_details: {
                total_deleted: total_deleted,
                deleted_at: moment().toISOString(),
                deleted_by: deleted_by,
                deleted_by_role: deleted_by_role,
                deletion_reason: deletion_reason,
                deletion_source: deletion_source
            },
            classes_summary: {
                total_classes: classes_deleted.length,
                classes: classes_deleted.map(cls => ({
                    class_id: cls.class_id,
                    student_id: cls.student_id,
                    teacher_id: cls.teacher_id,
                    status: cls.status,
                    meeting_start: cls.meeting_start
                }))
            },
            impact_analysis: {
                lessons_refunded_total: lessons_refunded_total,
                subscription_updates: subscription_updates,
                errors_encountered: errors.length
            },
            errors: errors
        };

        this.writeLog('class-deletion', level, message, metadata);
    }

    /**
     * Log regular class pattern deletion
     */
    logRegularClassPatternDeletion(patternDeletionData) {
        const {
            regular_class_id,
            student_id,
            student_name,
            teacher_id,
            day,
            start_time,
            deleted_by,
            deleted_by_role,
            deletion_source,
            cancel_future_classes = false,
            future_classes_canceled = 0,
            bonus_classes_canceled = 0,
            regular_classes_canceled = 0,
            lessons_refunded = 0,
            error_details = null
        } = patternDeletionData;

        const level = error_details ? this.logLevels.ERROR : this.logLevels.SUCCESS;
        const statusText = error_details ? 'FAILED' : 'SUCCESS';
        
        const message = `REGULAR CLASS PATTERN DELETION ${statusText}: Pattern ${regular_class_id} - Student: ${student_id} (${student_name || 'N/A'})`;
        
        const metadata = {
            pattern_deletion_details: {
                regular_class_id: regular_class_id,
                student_id: student_id,
                student_name: student_name,
                teacher_id: teacher_id,
                day: day,
                start_time: start_time,
                deleted_at: moment().toISOString(),
                deleted_by: deleted_by,
                deleted_by_role: deleted_by_role,
                deletion_source: deletion_source
            },
            future_classes_impact: {
                cancel_future_classes: cancel_future_classes,
                future_classes_canceled: future_classes_canceled,
                bonus_classes_canceled: bonus_classes_canceled,
                regular_classes_canceled: regular_classes_canceled
            },
            subscription_impact: {
                lessons_refunded: lessons_refunded
            },
            error_details: error_details
        };

        this.writeLog('class-deletion', level, message, metadata);
    }

    /**
     * Log trial class deletion
     */
    logTrialClassDeletion(trialDeletionData) {
        const {
            trial_class_id,
            class_id,
            student_id,
            student_name,
            teacher_id,
            deleted_by,
            deleted_by_role,
            deletion_source,
            associated_class_deleted = false,
            associated_records_deleted = [],
            error_details = null
        } = trialDeletionData;

        const level = error_details ? this.logLevels.ERROR : this.logLevels.SUCCESS;
        const statusText = error_details ? 'FAILED' : 'SUCCESS';
        
        const message = `TRIAL CLASS DELETION ${statusText}: Trial Class ${trial_class_id} - Student: ${student_id} (${student_name || 'N/A'})`;
        
        const metadata = {
            trial_deletion_details: {
                trial_class_id: trial_class_id,
                class_id: class_id,
                student_id: student_id,
                student_name: student_name,
                teacher_id: teacher_id,
                deleted_at: moment().toISOString(),
                deleted_by: deleted_by,
                deleted_by_role: deleted_by_role,
                deletion_source: deletion_source
            },
            associated_records: {
                associated_class_deleted: associated_class_deleted,
                records_deleted: associated_records_deleted
            },
            error_details: error_details
        };

        this.writeLog('class-deletion', level, message, metadata);
    }

    /**
     * Test logging functionality
     */
    testLogging() {
        console.log('Testing ClassDeletionLogger functionality...');
        
        // Test class deletion logging
        this.logClassDeletion({
            class_id: 999,
            class_type: 'regular',
            student_id: 123,
            student_name: 'Test Student',
            teacher_id: 456,
            deleted_by: 1,
            deleted_by_role: 'admin',
            deletion_reason: 'Test deletion',
            deletion_source: 'test'
        });
        
        console.log('✅ ClassDeletionLogger test completed');
    }

    /**
     * Clean up old log files (keep last 30 days)
     */
    cleanupOldLogs() {
        const cutoffDate = moment().subtract(30, 'days');
        const logDirectories = [classDeletionLogsDir, logsDir];

        logDirectories.forEach(dir => {
            try {
                if (!fs.existsSync(dir)) {
                    console.log(`Directory does not exist, skipping cleanup: ${dir}`);
                    return;
                }
                
                const files = fs.readdirSync(dir);
                files.forEach(file => {
                    if (file.endsWith('.log') && file.includes('class-deletions')) {
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
            const deletionLogFile = this.getLogFilePath('class-deletion', reportDate);
            
            const summary = {
                date: reportDate,
                class_deletions: {
                    total: 0,
                    successful: 0,
                    failed: 0,
                    by_type: {
                        regular: 0,
                        trial: 0,
                        regular_class_pattern: 0
                    },
                    by_role: {
                        admin: 0,
                        sales: 0,
                        teacher: 0,
                        user: 0,
                        system: 0
                    }
                },
                generated_at: moment().toISOString()
            };

            // Count deletion events
            if (fs.existsSync(deletionLogFile)) {
                const logContent = fs.readFileSync(deletionLogFile, 'utf8');
                const lines = logContent.split('\n').filter(line => 
                    line.includes('[SUCCESS]') || 
                    line.includes('[ERROR]') || 
                    line.includes('[WARN]')
                );
                
                summary.class_deletions.total = lines.length;
                summary.class_deletions.successful = lines.filter(line => line.includes('[SUCCESS]')).length;
                summary.class_deletions.failed = lines.filter(line => line.includes('[ERROR]')).length;
            }

            // Ensure summary directory exists
            this.ensureDirectoryExists(path.join(logsDir, 'temp'));
            
            // Write summary to file
            const summaryFile = path.join(logsDir, `class-deletion-summary-${reportDate}.json`);
            fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
            
            return summary;
        } catch (error) {
            console.error('Error generating daily summary:', error);
            return null;
        }
    }
}

// Create singleton instance
const classDeletionLogger = new ClassDeletionLogger();

// Export both the class and instance
module.exports = {
    ClassDeletionLogger,
    classDeletionLogger
};

