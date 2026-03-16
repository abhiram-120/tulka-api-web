const moment = require('moment');
const sendEmail = require('../../utils/sendEmail');
const User = require('../../models/users');
const axios = require('axios');

async function sendAisensyWhatsappMessage(userDetails, message, template) {
    try {
        const result = await sendAisensyNotification(userDetails, template, message);
        return result.success;
    } catch (error) {
        return false;
    }
}

async function sendAisensyNotification(userDetails, template, options) {
    try {
       
        if (!Array.isArray(options)) {
            return { success: false, error: 'options should be an array' };
        }

        const apiKey = process.env.AISENSY_API_KEY;
        const campaignName = `${template}_${userDetails.language || 'EN'}`;
        const destination = userDetails.country_code.replace('+', '') + userDetails.mobile.trim();
        const userName = userDetails.full_name;

       
        const payload = {
            apiKey: apiKey,
            campaignName: campaignName,
            destination: destination,
            userName: userName,
            templateParams: options,
            source: "class-reminder",
            media: {},
            buttons: [],
            carouselCards: [],
            location: {},
            paramsFallbackValue: {
              FirstName: userName
            }
        };

        console.log('payload :',payload);
       
        const response = await axios({
            method: 'post',
            url: 'https://backend.aisensy.com/campaign/t1/api/v2',
            data: JSON.stringify(payload, null, 2),
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        if (response.status >= 200 && response.status < 300) {
            return { success: true, data: response.data };
        } else {
            return { success: false, error: response.data };
        }

    } catch (error) {
        return { success: false, error: error.response?.data || error.message };
    }
}


async function whatsappReminderAddClass(templateName, userInfo, userId) {
    try {
        // Retrieve user details from the database
        const user = await User.findOne({
            where: { id: userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // Parse notification options
        const notificationOptions = JSON.parse(user.notification_channels || '[]');
        // const emailNotifyEnabled = notificationOptions.includes('email');
        const whatsappNotifyEnabled = notificationOptions.includes('whatsapp');
        // Get notification content
        const whatsappNotification =templateName;
        // const emailNotification = templateName;

        // Send WhatsApp notification if enabled
        if (whatsappNotification && whatsappNotifyEnabled) {

            let userMobile = user.mobile;

            const indexOfPlus = userMobile.indexOf('+');
            if (indexOfPlus !== -1) {
                userMobile = userMobile.slice(0, indexOfPlus);
            }

            const userDetails = {
                country_code: user.country_code,
                mobile: userMobile.trim(),
                full_name: user.full_name || '',
                language: user.language || 'EN'
            };

            try {
                messageSent = await sendAisensyWhatsappMessage(
                    userDetails,
                    userInfo,
                    templateName // Use the provided template name
                );

                if (!messageSent) {
                    console.error('Failed to send WhatsApp notification');
                }
            } catch (error) {
                console.error('Error sending WhatsApp message:', error);
            }
        }

        return true;
    } catch (error) {
        return false; 
    }
}

async function whatsappReminderTrailClass(templateName, userInfo, studentDetails) {
    try {
       
        const whatsappNotification =templateName;

        if (whatsappNotification) {

            try {
                messageSent = await sendAisensyWhatsappMessage(
                    studentDetails,
                    userInfo,
                    templateName
                );

                if (!messageSent) {
                    console.error('Failed to send WhatsApp notification');
                }
            } catch (error) {
                console.error('Error sending WhatsApp message:', error);
            }
        }

        return true;
    } catch (error) {
        return false; 
    }
}

module.exports = {
    whatsappReminderAddClass,
    whatsappReminderTrailClass
};
