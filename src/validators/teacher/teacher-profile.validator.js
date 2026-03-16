const validateProfileData = (data) => {
    const {
        full_name,
        email,
        mobile,
        country_code,
        language,
        timezone,
        city,
        teaching_name
    } = data;

    // Validate name
    if (full_name && (typeof full_name !== 'string' || full_name.length < 2)) {
        return 'Name must be at least 2 characters long';
    }

    // Validate email
    if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return 'Please enter a valid email address';
        }
    }

    // Validate phone number
    if (mobile && country_code) {
        const phoneRegex = /^\+?[1-9]\d{1,14}$/;
        if (!phoneRegex.test(mobile.replace(/\D/g, ''))) {
            return 'Please enter a valid phone number';
        }
    }

    // Validate language
    if (language && typeof language !== 'string') {
        return 'Invalid language format';
    }

    // Validate timezone
    if (timezone && typeof timezone !== 'string') {
        return 'Invalid timezone format';
    }

    // Validate city
    if (city && (typeof city !== 'string' || city.length < 2)) {
        return 'City must be at least 2 characters long';
    }

    // Validate teaching name (optional)
    if (teaching_name && typeof teaching_name !== 'string') {
        return 'Teaching name must be a valid string';
    }

    return null;
};

const validateNotificationPreferences = (data) => {
    const { email, whatsapp, notification_times } = data;

    // Validate email preference
    if (email !== undefined && typeof email !== 'boolean') {
        return 'Email notification preference must be a boolean value';
    }

    // Validate WhatsApp preference
    if (whatsapp !== undefined && typeof whatsapp !== 'boolean') {
        return 'WhatsApp notification preference must be a boolean value';
    }

    // Validate notification times
    if (notification_times !== undefined) {
        if (!Array.isArray(notification_times)) {
            return 'Notification times must be an array';
        }

        // Check valid notification times
        const validTimes = ['24hours', '4hours', '1hour', '30min'];
        const validNotificationTimes = notification_times.filter(time => validTimes.includes(time));

        if (notification_times.length > 0 && validNotificationTimes.length === 0) {
            return 'Please provide valid notification times';
        }

        if (notification_times.length > 2) {
            return 'Maximum 2 notification times allowed';
        }
    }

    return null;
};

const validateZoomSettings = (data) => {
    const { use_zoom, zoom_link, meeting_id, passcode } = data;

    // Validate use_zoom flag
    if (use_zoom !== undefined && typeof use_zoom !== 'boolean') {
        return 'Zoom setting must be a boolean value';
    }

    // Validate zoom link if provided
    if (zoom_link !== undefined && zoom_link !== null && zoom_link !== '') {
        if (typeof zoom_link !== 'string') {
            return 'Zoom link must be a valid string';
        }

        // Basic URL validation
        try {
            new URL(zoom_link);
        } catch {
            return 'Please enter a valid Zoom meeting link';
        }
    }

    // Validate meeting ID if provided
    if (meeting_id !== undefined && meeting_id !== null && meeting_id !== '') {
        if (typeof meeting_id !== 'string') {
            return 'Meeting ID must be a valid string';
        }
        
        // Meeting ID should contain only numbers and possibly spaces or hyphens
        const meetingIdRegex = /^[\d\s\-]+$/;
        if (!meetingIdRegex.test(meeting_id)) {
            return 'Please enter a valid Zoom meeting ID';
        }
    }

    // If use_zoom is true, either zoom_link or meeting_id must be provided
    if (use_zoom === true && (!zoom_link || zoom_link === '') && (!meeting_id || meeting_id === '')) {
        return 'Either Zoom link or Meeting ID is required when Zoom is enabled';
    }

    return null;
};

const validateTeachingDetails = (data) => {
    const { bio, education, experience, subject } = data;

    // Validate bio
    if (bio !== undefined && bio !== null && bio !== '') {
        if (typeof bio !== 'string') {
            return 'Bio must be a valid string';
        }
        
        if (bio.length > 500) {
            return 'Bio should not exceed 500 characters';
        }
    }

    // Validate education
    if (education !== undefined && education !== null && education !== '') {
        if (typeof education !== 'string') {
            return 'Education must be a valid string';
        }
        
        if (education.length > 1000) {
            return 'Education should not exceed 1000 characters';
        }
    }

    // Validate experience
    if (experience !== undefined && experience !== null && experience !== '') {
        if (typeof experience !== 'string') {
            return 'Experience must be a valid string';
        }
        
        if (experience.length > 1000) {
            return 'Experience should not exceed 1000 characters';
        }
    }

    // Validate subject
    if (subject !== undefined && subject !== null && subject !== '') {
        if (typeof subject !== 'string') {
            return 'Subject must be a valid string';
        }
        
        if (subject.length > 100) {
            return 'Subject should not exceed 100 characters';
        }
    }

    return null;
};

module.exports = {
    validateProfileData,
    validateNotificationPreferences,
    validateZoomSettings,
    validateTeachingDetails
};