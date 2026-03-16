// utils/time-converter.js
const moment = require('moment-timezone');

/**
 * Converts local time to UTC format
 * @param {string} dateTime - The date time string
 * @param {string} timezone - The source timezone
 * @returns {Object} - UTC formatted time and validation status
 */
const convertToUTC = (dateTime, timezone = 'UTC') => {
    try {
        const utcTime = moment.tz(dateTime, timezone).utc();
        if (!utcTime.isValid()) {
            return {
                isValid: false,
                error: 'Invalid date time format',
                time: null
            };
        }
        return {
            isValid: true,
            error: null,
            time: utcTime.format('YYYY-MM-DD HH:mm:ss')
        };
    } catch (error) {
        return {
            isValid: false,
            error: 'Time conversion failed',
            time: null
        };
    }
};

module.exports = {
    convertToUTC
};