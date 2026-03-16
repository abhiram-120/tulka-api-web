const validateProfileData = (data) => {
    const {
        full_name,
        email,
        mobile,
        country_code,
        language,
        native_language,
        timezone,
        city
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

    // Validate native language
    if (native_language && typeof native_language !== 'string') {
        return 'Invalid native language format';
    }

    // Validate timezone
    if (timezone && typeof timezone !== 'string') {
        return 'Invalid timezone format';
    }

    // Validate city
    if (city && (typeof city !== 'string' || city.length < 2)) {
        return 'City must be at least 2 characters long';
    }

    return null;
};

module.exports = {
    validateProfileData
};
