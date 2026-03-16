// utils/timezone.utils.js
const moment = require('moment-timezone');

/**
 * Get timezone abbreviation
 * @param {string} timezone - Full timezone name (e.g., 'Asia/Jerusalem')
 * @returns {string} Timezone abbreviation or name
 */
const getTimezoneAbbreviation = (timezone) => {
    const TIMEZONE_ABBREVIATIONS = {
        'Asia/Jerusalem': 'IST',
        'Asia/Kolkata': 'IST',
        'America/Los_Angeles': 'PST',
        'America/New_York': 'EST',
        'Europe/London': 'GMT',
        'Asia/Tokyo': 'JST',
        'Australia/Sydney': 'AEST',
        'Europe/Paris': 'CET',
        'Asia/Kamchatka': 'PETT',
        'Asia/Jayapura': 'WIT'
    };
    
    return TIMEZONE_ABBREVIATIONS[timezone] || timezone.split('/')[1] || timezone;
};

/**
 * Convert time from one timezone to another
 * @param {string} time - Time in HH:mm format
 * @param {string} fromTimezone - Source timezone
 * @param {string} toTimezone - Target timezone
 * @returns {string} Converted time in HH:mm format
 */
const convertTime = (time, fromTimezone, toTimezone) => {
    // If same timezone, return the time as is
    if (fromTimezone === toTimezone) {
        return time;
    }
    
    // Create a moment object for today with the given time in the from timezone
    const date = moment().format('YYYY-MM-DD');
    const momentObj = moment.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', fromTimezone);
    
    // Convert to target timezone
    const convertedTime = momentObj.clone().tz(toTimezone).format('HH:mm');
    
    return convertedTime;
};

module.exports = {
    getTimezoneAbbreviation,
    convertTime
};