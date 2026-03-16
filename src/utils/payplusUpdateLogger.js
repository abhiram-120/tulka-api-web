// utils/payplusUpdateLogger.js
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

// Setup logging directory
const logsDir = path.join(__dirname, '../logs');
const payplusUpdateLogsDir = path.join(logsDir, 'payplus-updates');

/**
 * Logger utility for PayPlus customer update operations
 */
class PayPlusUpdateLogger {
    constructor() {
        this.logLevels = {
            ERROR: 'ERROR',
            WARN: 'WARN',
            INFO: 'INFO',
            SUCCESS: 'SUCCESS'
        };
        
        // Initialize directory
        this.initializeDirectories();
    }

    /**
     * Initialize and create required directories
     */
    initializeDirectories() {
        try {
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            if (!fs.existsSync(payplusUpdateLogsDir)) {
                fs.mkdirSync(payplusUpdateLogsDir, { recursive: true });
            }
        } catch (error) {
            console.error(`Failed to create log directories:`, error);
        }
    }

    /**
     * Get log file path based on date
     */
    getLogFilePath(date = null) {
        const logDate = date || moment().format('YYYY-MM-DD');
        return path.join(payplusUpdateLogsDir, `payplus-updates-${logDate}.log`);
    }

    /**
     * Write log entry to file
     */
    writeLog(level, message, metadata = null) {
        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss.SSS');
        const logFile = this.getLogFilePath();
        
        // Create structured log entry
        const logEntry = {
            timestamp: timestamp,
            level: level,
            message: message,
            ...(metadata && { metadata })
        };
        
        // Format log entry as JSON line
        const logLine = JSON.stringify(logEntry) + '\n';
        
        try {
            // Append to log file
            fs.appendFileSync(logFile, logLine, 'utf8');
        } catch (error) {
            console.error(`Failed to write to log file ${logFile}:`, error);
        }
    }

    /**
     * Log PayPlus customer update
     */
    logPayPlusUpdate(data) {
        const {
            student_id,
            student_email,
            customer_uid,
            update_type,
            fields_updated,
            old_values,
            new_values,
            success,
            error_message,
            payplus_response,
            updated_by
        } = data;

        const message = success 
            ? `PayPlus customer updated successfully - Student ID: ${student_id}, Customer UID: ${customer_uid}`
            : `PayPlus customer update failed - Student ID: ${student_id}, Customer UID: ${customer_uid}`;

        const metadata = {
            student_id,
            student_email,
            customer_uid,
            update_type: update_type || 'student_update',
            fields_updated: fields_updated || [],
            old_values: old_values || {},
            new_values: new_values || {},
            success,
            error_message,
            payplus_response,
            updated_by: updated_by || 'system',
            timestamp: moment().toISOString()
        };

        const level = success ? this.logLevels.SUCCESS : this.logLevels.ERROR;
        this.writeLog(level, message, metadata);
    }

    /**
     * Log when PayPlus update is skipped
     */
    logPayPlusUpdateSkipped(data) {
        const {
            student_id,
            student_email,
            reason
        } = data;

        const message = `PayPlus update skipped - Student ID: ${student_id}, Reason: ${reason}`;

        const metadata = {
            student_id,
            student_email,
            reason,
            timestamp: moment().toISOString()
        };

        this.writeLog(this.logLevels.INFO, message, metadata);
    }
}

// Export singleton instance
const payplusUpdateLogger = new PayPlusUpdateLogger();

module.exports = { payplusUpdateLogger };

