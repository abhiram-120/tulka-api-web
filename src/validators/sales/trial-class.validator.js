// validators/trial-class.validator.js
const moment = require('moment');

/**
 * Validates the trial class registration data
 * @param {Object} data - The trial class data to validate
 * @returns {string|null} Error message if validation fails, null if validation passes
 */
const validateTrialClassData = (data) => {
    const {
        student_name,
        parent_name,
        country_code,
        mobile,
        email,
        age,
        teacher_id,
        meeting_start,
        meeting_end,
        description,
        language
    } = data;

    // Required fields check
    if (!student_name || typeof student_name !== 'string' || student_name.trim().length === 0) {
        return 'Student name is required and must be a non-empty string';
    }

    if (!country_code || typeof country_code !== 'string' || !/^\+?\d{1,4}$/.test(country_code)) {
        return 'Valid country code is required (e.g., +1, +44, +972)';
    }

    if (!mobile || typeof mobile !== 'string' || !/^\d{7,15}$/.test(mobile)) {
        return 'Valid mobile number is required (7-15 digits)';
    }

    if (!age || isNaN(age) || age < 3 || age > 120) {
        return 'Valid age is required (between 3 and 120)';
    }

    if (!teacher_id || isNaN(teacher_id) || teacher_id <= 0) {
        return 'Valid teacher ID is required';
    }

    // Optional fields validation
    if (parent_name && (typeof parent_name !== 'string' || parent_name.trim().length === 0)) {
        return 'Parent name must be a non-empty string if provided';
    }

    if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return 'Invalid email format';
        }
    }

    if (description && typeof description !== 'string') {
        return 'Description must be a string if provided';
    }

    if (language && !['HE', 'EN', 'AR'].includes(language)) {
        return 'Language must be one of: HE, EN, AR';
    }

    // UTC time validation
    if (!meeting_start || !meeting_end) {
        return 'Meeting start and end times are required';
    }

    // Parse times as UTC
    const startTime = moment.utc(meeting_start);
    const endTime = moment.utc(meeting_end);

    if (!startTime.isValid() || !endTime.isValid()) {
        return 'Invalid UTC datetime format. Expected format: YYYY-MM-DD HH:mm:ss';
    }

    if (endTime.isSameOrBefore(startTime)) {
        return 'Meeting end time must be after start time';
    }

    // Check if meeting time is in the past (using UTC)
    if (startTime.isBefore(moment.utc())) {
        return 'Meeting cannot be scheduled in the past';
    }

    // Validate 25-minute duration
    const duration = moment.duration(endTime.diff(startTime)).asMinutes();
    if (duration !== 25) {
        return 'Trial class must be exactly 25 minutes long';
    }

    // Validate if meeting is within working hours (8 AM to 8 PM UTC)
    // const startHour = startTime.hour();
    // const endHour = endTime.hour();
    // if (startHour < 8 || endHour > 20 || (endHour === 20 && endTime.minute() > 0)) {
    //     return 'Trial classes must be scheduled between 8 AM to 8 PM UTC';
    // }

    // Validate notification preferences if provided
    if (data.notification_preferences) {
        if (typeof data.notification_preferences !== 'object') {
            return 'Notification preferences must be an object';
        }

        const { whatsapp, email: emailNotif } = data.notification_preferences;
        if (typeof whatsapp !== 'boolean' || typeof emailNotif !== 'boolean') {
            return 'Notification preferences must specify boolean values for whatsapp and email';
        }
    }

    // All validations passed
    return null;
};

/**
 * Validates the trial class update data
 * @param {Object} data - The trial class update data to validate
 * @returns {string|null} Error message if validation fails, null if validation passes
 */
const validateTrialClassUpdateData = (data) => {
    // Skip validation if no data provided
    if (Object.keys(data).length === 0) {
        return 'No update data provided';
    }

    // For fields that are provided, apply the same validation rules
    const fieldsToValidate = Object.keys(data);
    const mockData = { ...data };

    // If updating time, need both start and end
    if (fieldsToValidate.includes('meeting_start') || fieldsToValidate.includes('meeting_end')) {
        if (!data.meeting_start || !data.meeting_end) {
            return 'Both meeting start and end times must be provided when updating schedule';
        }
    }

    // Validate provided fields
    return validateTrialClassData(mockData);
};

/**
 * Validates the trial class conversion data
 * @param {Object} data - The conversion data to validate
 * @returns {string|null} Error message if validation fails, null if validation passes
 */
const validateTrialClassConversion = (data) => {
    const { regular_class_id } = data;

    if (!regular_class_id || isNaN(regular_class_id) || regular_class_id <= 0) {
        return 'Valid regular class ID is required for conversion';
    }

    return null;
};

module.exports = {
    validateTrialClassData,
    validateTrialClassUpdateData,
    validateTrialClassConversion
};