var cron = require('node-cron');
const moment = require('moment');
const { Op } = require('sequelize');
const Reminder = require('../models/reminder');
const Users = require('../models/users');
const Classes = require('../models/classes');
const { asyncForEach } = require('../utils/general');
const { sendPushNotification, calculateReminderDates } = require('../controller/reminder.controller');
const NotificationTemplates = require('../helper/notificationTemplates');
const admin = require('firebase-admin');
const InAppNotificationService = require('../services/inapp-notification-service'); // Add this import
const twilio = require('twilio');
const config = require('../config/config');
const sendEmail = require('../utils/sendEmail');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}
const inAppService = new InAppNotificationService();

if (!admin.apps.length) {
    const inlineCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS)
        : path.resolve(__dirname, '../../tulkka-firebase-adminsdk-douvv-4b2c75eda1.json');

    try {
        if (inlineCredentials) {
            admin.initializeApp({
                credential: admin.credential.cert(JSON.parse(inlineCredentials)),
            });
        } else if (fs.existsSync(credentialPath)) {
            admin.initializeApp({
                credential: admin.credential.cert(require(credentialPath)),
            });
        } else {
            console.warn('Firebase credentials not configured; reminder push notifications will be disabled.');
        }
    } catch (error) {
        console.warn('Firebase initialization skipped:', error.message);
    }
}

function logToFile(message, type = 'info', logFileName = 'aisensy-notifications', additionalData = null) {
    const timestamp = new Date().toISOString();
    const logDate = timestamp.split('T')[0]; // YYYY-MM-DD
    const logFile = path.join(logsDir, `${logFileName}-${logDate}.log`);
    
    let logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}`;
    
    // Add additional data if provided (similar to your class logging)
    if (additionalData) {
        logEntry += `\nData: ${JSON.stringify(additionalData, null, 2)}`;
    }
    
    logEntry += '\n';
    
    fs.appendFileSync(logFile, logEntry);
    
    // Also log to console for immediate feedback (same as your pattern)
    if (type === 'error') {
        console.error(message, additionalData);
    } else if (type === 'warn') {
        console.warn(message, additionalData);
    } else {
        console.log(message, additionalData);
    }
}

async function getReminderTime(req, res) {
    try {
        logToFile('Starting getReminderTime request', 'info', 'reminder-api');
        
        let reminderTimes = await Users.findAll({
            attributes: ['id', 'lesson_notifications', 'full_name']
        });

        if (!reminderTimes || reminderTimes.length === 0) {
            logToFile('No reminder times found in database', 'warn', 'reminder-api');
            return res.status(404).json({ status: 'error', message: 'No Reminder time found' });
        }

        logToFile(`Found ${reminderTimes.length} users with reminder preferences`, 'info', 'reminder-api', {
            userCount: reminderTimes.length
        });

        res.status(200).json({
            status: 'success',
            message: 'Reminder Time',
            data: reminderTimes // Sending the structured object as data
        });
    } catch (err) {
        logToFile('Error in getReminderTime', 'error', 'reminder-api', {
            error: err.message,
            stack: err.stack
        });
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

function getNotificationPayload({ type, student_name, teacher_name }) {
    let title = 'Class Reminder';
    let body = 'Class Reminder';
    if (type === 'class_reminder_30m_before') {
        body = `Class with ${teacher_name} in 30 minutes`;
    } else if (type === 'class_reminder_1h_before') {
        body = `Class with ${teacher_name} in 1 hour`;
    } else if (type === 'class_reminder_4h_before') {
        body = `Class with ${teacher_name} in 4 hours`;
    } else if (type === 'class_reminder_24h_before') {
        body = `Class with ${teacher_name} in 24 hours`;
    }

    return { title, body };
}

async function sendAisensyWhatsappMessage(userDetails, message, template, userId = null) {
    const startTime = Date.now();
    const userDisplayName = `${userDetails.full_name} (ID: ${userId || userDetails.userId || 'N/A'})`;
    
    try {
        logToFile(`Initiating WhatsApp message for ${userDisplayName}`, 'info', 'aisensy-notifications', {
            template,
            userId: userId || userDetails.userId || 'N/A',
            userDetails: {
                userId: userId || userDetails.userId || 'N/A',
                full_name: userDetails.full_name,
                mobile: userDetails.mobile,
                country_code: userDetails.country_code,
                language: userDetails.language
            },
            messageParams: message
        });

        // Add userId to userDetails for the notification function
        const userDetailsWithId = {
            ...userDetails,
            userId: userId || userDetails.userId || 'N/A'
        };

        const result = await sendAisensyNotification(userDetailsWithId, template, message);
        
        const duration = Date.now() - startTime;
        
        if (result.success) {
            logToFile(`WhatsApp message completed successfully for ${userDisplayName} in ${duration}ms`, 'info', 'aisensy-notifications', {
                template,
                userId: userId || userDetails.userId || 'N/A',
                userName: userDetails.full_name,
                duration: `${duration}ms`,
                requestId: result.requestId
            });
        } else {
            logToFile(`WhatsApp message failed for ${userDisplayName} after ${duration}ms`, 'error', 'aisensy-notifications', {
                template,
                userId: userId || userDetails.userId || 'N/A',
                userName: userDetails.full_name,
                duration: `${duration}ms`,
                requestId: result.requestId,
                error: result.error
            });
        }
        
        return result.success;
    } catch (error) {
        const duration = Date.now() - startTime;
        
        logToFile(`WhatsApp message wrapper failed for ${userDisplayName} after ${duration}ms`, 'error', 'aisensy-notifications', {
            template,
            userId: userId || userDetails.userId || 'N/A',
            userDetails,
            duration: `${duration}ms`,
            error: error.message,
            stack: error.stack
        });
        
        return false;
    }
}

async function sendAisensyNotification(userDetails, template, options) {
    const requestId = `REQ_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {

        if (process.env.NOTIFICATIONS_ENABLED === 'false') {
            logToFile(`[SUPPRESSED] WhatsApp notification would have been sent [${requestId}]`, 'info', 'aisensy-notifications', {
                requestId,
                template,
                userId: userDetails.userId || 'N/A',
                userName: userDetails.full_name,
                destination: `${userDetails.country_code}${userDetails.mobile}`,
                reason: 'NOTIFICATIONS_ENABLED=false',
                suppressed: true
            });
            
            // Return success response to avoid breaking cron logic
            return { 
                success: true, 
                data: { suppressed: true, reason: 'Notifications disabled' }, 
                requestId 
            };
        }

        const apiKey = process.env.AISENSY_API_KEY;
        const campaignName = `${template}_${userDetails.language || 'EN'}`;
        const userName = userDetails.full_name;
        const rawNumber = userDetails.mobile.trim();
        const countryCode = userDetails.country_code.trim();
        const destinationCountryCode = countryCode.startsWith('+') ? countryCode : '+' + countryCode;
        const destination = destinationCountryCode + rawNumber;

        // Log initial request details - using your logging pattern
        logToFile(`Starting WhatsApp notification request [${requestId}] for ${userName} (ID: ${userDetails.userId || 'N/A'})`, 'info', 'aisensy-notifications', {
            requestId,
            template,
            campaignName,
            destination,
            userDetails: {
                userId: userDetails.userId || 'N/A',
                full_name: userDetails.full_name,
                mobile: userDetails.mobile,
                country_code: userDetails.country_code,
                language: userDetails.language
            }
        });

        // Validate required fields
        if (!apiKey) {
            logToFile(`Missing AISENSY_API_KEY for request [${requestId}]`, 'error', 'aisensy-notifications', {
                requestId,
                userId: userDetails.userId || 'N/A',
                userName: userName
            });
            return { success: false, error: 'Missing API key', requestId };
        }

        if (!rawNumber || !countryCode) {
            logToFile(`Missing phone number details for request [${requestId}]`, 'error', 'aisensy-notifications', {
                requestId,
                userId: userDetails.userId || 'N/A',
                userName: userName,
                mobile: rawNumber,
                country_code: countryCode
            });
            return { success: false, error: 'Missing phone number details', requestId };
        }
        
        console.log('User Details:', userDetails);
        console.log('Destination:', destination);
        console.log('campaignName:', campaignName);
        
        // Create a copy of options for template params (without pdf)
        const templateParamsOptions = { ...options };
        const hasPdf = options.pdf && options.pdf.trim() !== '';
        
        // Remove pdf from template params if it exists
        if (hasPdf) {
            delete templateParamsOptions.pdf;
            logToFile(`PDF attachment found for request [${requestId}]`, 'info', 'aisensy-notifications', {
                requestId,
                userId: userDetails.userId || 'N/A',
                pdfUrl: options.pdf
            });
        }
        
        const templateParams = Object.values(templateParamsOptions);

        const payload = {
            apiKey: apiKey,
            campaignName: campaignName,
            destination: destination,
            userName: userName,
            templateParams: templateParams,
            source: "class-reminder",
            media: {},
            buttons: [],
            carouselCards: [],
            location: {},
            paramsFallbackValue: {
              FirstName: userName
            }
        };
        
        // Add PDF to media if it exists
        if (hasPdf) {
            const pdfUrl = options.pdf;
            const pdfFilename = pdfUrl.split('/').pop();
            
            payload.media = {
                url: pdfUrl,
                filename: pdfFilename
            };
        }

        // Log the payload (without API key for security) - using your pattern
        const payloadForLogging = { ...payload };
        payloadForLogging.apiKey = '[HIDDEN]';
        
        logToFile(`Sending API request to Aisensy [${requestId}]`, 'info', 'aisensy-notifications', {
            requestId,
            userId: userDetails.userId || 'N/A',
            payload: payloadForLogging,
            templateParams,
            url: 'https://backend.aisensy.com/campaign/t1/api/v2'
        });

        const response = await axios({
            method: 'post',
            url: 'https://backend.aisensy.com/campaign/t1/api/v2',
            data: JSON.stringify(payload, null, 2),
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        // Log successful response - using your pattern
        if (response.status >= 200 && response.status < 300) {
            logToFile(`WhatsApp notification sent successfully [${requestId}] to ${userName} (ID: ${userDetails.userId || 'N/A'})`, 'info', 'aisensy-notifications', {
                requestId,
                userId: userDetails.userId || 'N/A',
                userName: userName,
                status: response.status,
                statusText: response.statusText,
                responseData: response.data,
                destination,
                template
            });
            
            return { success: true, data: response.data, requestId };
        } else {
            // Log unsuccessful but non-error response - using your pattern
            logToFile(`WhatsApp notification failed with HTTP status [${requestId}] for ${userName} (ID: ${userDetails.userId || 'N/A'})`, 'warn', 'aisensy-notifications', {
                requestId,
                userId: userDetails.userId || 'N/A',
                userName: userName,
                status: response.status,
                statusText: response.statusText,
                responseData: response.data,
                destination,
                template,
                userDetails
            });
            
            return { success: false, error: response.data, requestId };
        }

    } catch (error) {
        // Enhanced error logging - using your pattern
        const errorDetails = {
            requestId,
            userId: userDetails.userId || 'N/A',
            userDetails: {
                userId: userDetails.userId || 'N/A',
                full_name: userDetails.full_name,
                mobile: userDetails.mobile,
                country_code: userDetails.country_code,
                language: userDetails.language
            },
            template,
            options,
            errorMessage: error.message,
            errorStack: error.stack
        };

        // If it's an axios error, get more details
        if (error.response) {
            errorDetails.axiosError = {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            };
        } else if (error.request) {
            errorDetails.axiosError = {
                request: 'No response received',
                timeout: 'Request timeout or network error'
            };
        }

        logToFile(`WhatsApp notification failed with exception [${requestId}] for ${userDetails.full_name} (ID: ${userDetails.userId || 'N/A'})`, 'error', 'aisensy-notifications', errorDetails);

        return { success: false, error: error.response?.data || error.message, requestId };
    }
}

async function whatsappReminderAddClass(templateName, userInfo, userId) {
    try {
        logToFile(`Starting reminder process for user ID ${userId}`, 'info', 'class-reminders', {
            templateName,
            userId,
            userInfo
        });

        // Retrieve user details from the database
        const user = await Users.findOne({
            where: { id: userId }
        });

        if (!user) {
            logToFile(`User not found for ID ${userId}`, 'error', 'class-reminders', {
                templateName,
                userId
            });
            return false;
        }

        logToFile(`User found: ${user.full_name} (ID: ${userId})`, 'info', 'class-reminders', {
            templateName,
            userId,
            userName: user.full_name,
            userEmail: user.email,
            userMobile: user.mobile,
            userCountryCode: user.country_code,
            userLanguage: user.language
        });

        // Parse notification options
        const notificationOptions = JSON.parse(user.notification_channels || '[]');
        const emailNotifyEnabled = notificationOptions.includes('email');
        const whatsappNotifyEnabled = notificationOptions.includes('whatsapp');
        const inAppEnabled = notificationOptions.includes('inapp'); // Add in-app check
        
        logToFile(`Notification preferences for ${user.full_name} (ID: ${userId})`, 'info', 'class-reminders', {
            userId,
            userName: user.full_name,
            emailEnabled: emailNotifyEnabled,
            whatsappEnabled: whatsappNotifyEnabled,
            inAppEnabled: inAppEnabled,
            notificationChannels: notificationOptions
        });

        // Get notification content
        const whatsappNotification =
            templateName !== 'homework_received' &&
            templateName !== 'homework_completed' &&
            templateName !== 'quiz_completed' &&
            templateName !== 'feedback_received' &&
            templateName !== 'quiz_received'
                ? NotificationTemplates.getNotification(templateName, user.language, 'whatsapp', userInfo)
                : null;
        const emailNotification = NotificationTemplates.getNotification(templateName, user.language, 'email', userInfo);

        logToFile(`Template content retrieved for ${user.full_name} (ID: ${userId})`, 'info', 'class-reminders', {
            templateName,
            userId,
            userName: user.full_name,
            hasWhatsappTemplate: !!whatsappNotification,
            hasEmailTemplate: !!emailNotification,
            userLanguage: user.language
        });

        let messageSent = false;

        // Send WhatsApp notification if enabled
        if (whatsappNotification && whatsappNotifyEnabled) {
            logToFile(`Attempting WhatsApp notification for ${user.full_name} (ID: ${userId})`, 'info', 'class-reminders', {
                templateName,
                userId,
                userName: user.full_name
            });

            let userMobile = user.mobile;

            const indexOfPlus = userMobile.indexOf('+');
            if (indexOfPlus !== -1) {
                userMobile = userMobile.slice(0, indexOfPlus);
                logToFile(`Cleaned mobile number for ${user.full_name} (ID: ${userId})`, 'info', 'class-reminders', {
                    userId,
                    originalMobile: user.mobile,
                    cleanedMobile: userMobile
                });
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
                    templateName,
                    userId // Pass userId to the function
                );

                if (!messageSent) {
                    logToFile(`Failed to send WhatsApp notification to ${user.full_name} (ID: ${userId})`, 'error', 'class-reminders', {
                        templateName,
                        userId,
                        userName: user.full_name,
                        userDetails
                    });
                } else {
                    logToFile(`WhatsApp notification sent successfully to ${user.full_name} (ID: ${userId})`, 'info', 'class-reminders', {
                        templateName,
                        userId,
                        userName: user.full_name
                    });
                }
            } catch (error) {
                logToFile(`Error sending WhatsApp message to ${user.full_name} (ID: ${userId})`, 'error', 'class-reminders', {
                    templateName,
                    userId,
                    userName: user.full_name,
                    error: error.message,
                    stack: error.stack
                });
            }
        } else {
            logToFile(`WhatsApp notification skipped for ${user.full_name} (ID: ${userId})`, 'info', 'class-reminders', {
                templateName,
                userId,
                userName: user.full_name,
                reason: !whatsappNotifyEnabled ? 'WhatsApp not enabled' : 'No WhatsApp template available',
                hasTemplate: !!whatsappNotification,
                isEnabled: whatsappNotifyEnabled
            });
        }

        // Send email notification if enabled
        if (emailNotifyEnabled && emailNotification && user.email) {
            logToFile(`Attempting email notification for ${user.full_name} (ID: ${userId})`, 'info', 'class-reminders', {
                templateName,
                userId,
                userName: user.full_name,
                email: user.email
            });

            try {
                let email = user.email;
                const indexOfPlus = email.indexOf('+');

                if (indexOfPlus !== -1) {
                    // Remove the substring starting from the '+' character to the end of the email address
                    email = email.slice(0, indexOfPlus) + email.slice(email.indexOf('@'));
                    logToFile(`Cleaned email address for ${user.full_name} (ID: ${userId})`, 'info', 'class-reminders', {
                        userId,
                        originalEmail: user.email,
                        cleanedEmail: email
                    });
                }

                await sendEmail(email, emailNotification.title, emailNotification.content);
                messageSent = true;
            } catch (error) {
                logToFile(`Error sending email notification to ${user.full_name} (ID: ${userId})`, 'error', 'class-reminders', {
                    error: error.message
                });
            }
        }

        // Send in-app notification if enabled (NEW FUNCTIONALITY)
        if (inAppEnabled || user.isAdmin) {
            logToFile(`Attempting in-app notification for ${user.full_name} (ID: ${userId})`, 'info', 'class-reminders', {
                templateName,
                userId,
                userName: user.full_name
            });

            try {
                const inAppSent = await inAppService.sendInAppNotification(templateName, userInfo, userId, user);
                
                if (inAppSent) {
                    logToFile(`In-app notification sent successfully to ${user.full_name} (ID: ${userId})`, 'info', 'class-reminders', {
                        templateName,
                        userId,
                        userName: user.full_name
                    });
                    messageSent = true;
                } else {
                    logToFile(`Failed to send in-app notification to ${user.full_name} (ID: ${userId})`, 'warn', 'class-reminders', {
                        templateName,
                        userId,
                        userName: user.full_name
                    });
                }
            } catch (error) {
                logToFile(`Error sending email notification to ${user.full_name} (ID: ${userId})`, 'error', 'class-reminders', {
                    templateName,
                    userId,
                    userName: user.full_name,
                    email: user.email,
                    error: error.message,
                    stack: error.stack
                });
                return false;
            }
        } else {
            logToFile(`In-app notification skipped for ${user.full_name} (ID: ${userId}) - not enabled`, 'info', 'class-reminders', {
                templateName,
                userId,
                userName: user.full_name,
                inAppEnabled: inAppEnabled,
                isAdmin: user.isAdmin
            });
        }

        logToFile(`Reminder process completed for ${user.full_name} (ID: ${userId})`, 'info', 'class-reminders', {
            templateName,
            userId,
            userName: user.full_name,
            success: messageSent
        });

        return messageSent;
    } catch (error) {
        logToFile(`Error in reminder process for user ID ${userId}`, 'error', 'class-reminders', {
            templateName,
            userId,
            error: error.message,
            stack: error.stack
        });
        return false;
    }
}

/**
 * Send WhatsApp and email notifications for trial class registrations
 * @param {string} templateName - The notification template name
 * @param {Array} messageParams - Parameters for the notification template
 * @param {Object} studentDetails - Student details for notification
 * @returns {Promise<boolean>} - Success status of the notification
 */
async function whatsappReminderTrailClass(templateName, messageParams, studentDetails) {
    try {
        logToFile(`Starting trial class reminder for ${studentDetails.full_name || 'Unknown Student'}`, 'info', 'trial-reminders', {
            templateName,
            studentDetails: {
                full_name: studentDetails.full_name,
                mobile: studentDetails.mobile,
                email: studentDetails.email,
                country_code: studentDetails.country_code,
                language: studentDetails.language
            },
            messageParams
        });

        // Get notification content from template
        const whatsappNotification = NotificationTemplates.getNotification(
            templateName, 
            studentDetails.language || 'EN', 
            'whatsapp', 
            messageParams
        );
        
        const emailNotification = NotificationTemplates.getNotification(
            templateName, 
            studentDetails.language || 'EN', 
            'email', 
            messageParams
        );

        logToFile(`Template content retrieved for trial student ${studentDetails.full_name || 'Unknown'}`, 'info', 'trial-reminders', {
            templateName,
            studentName: studentDetails.full_name,
            hasWhatsappTemplate: !!whatsappNotification,
            hasEmailTemplate: !!emailNotification,
            language: studentDetails.language || 'EN'
        });

        let messageSent = false;

        // Send WhatsApp notification if enabled
        if (whatsappNotification && studentDetails.mobile) {
            logToFile(`Attempting WhatsApp notification for trial student ${studentDetails.full_name || 'Unknown'}`, 'info', 'trial-reminders', {
                templateName,
                studentName: studentDetails.full_name,
                mobile: studentDetails.mobile
            });

            // Clean up mobile number
            let userMobile = studentDetails.mobile;
            if (userMobile.indexOf('+') !== -1) {
                userMobile = userMobile.replace(/\+/g, '');
                logToFile(`Cleaned mobile number for trial student ${studentDetails.full_name || 'Unknown'}`, 'info', 'trial-reminders', {
                    originalMobile: studentDetails.mobile,
                    cleanedMobile: userMobile
                });
            }
            
            // Prepare user details for Aisensy
            const userForNotification = {
                country_code: studentDetails.country_code,
                mobile: userMobile.trim(),
                full_name: studentDetails.full_name || '',
                language: studentDetails.language || 'EN'
            };

            try {
                messageSent = await sendAisensyWhatsappMessage(
                    userForNotification,
                    messageParams,
                    templateName
                );

                if (!messageSent) {
                    logToFile(`Failed to send WhatsApp notification to trial class student ${studentDetails.full_name || 'Unknown'}`, 'error', 'trial-reminders', {
                        templateName,
                        studentName: studentDetails.full_name,
                        userForNotification
                    });
                } else {
                    logToFile(`WhatsApp notification sent successfully to trial student ${studentDetails.full_name || 'Unknown'}`, 'info', 'trial-reminders', {
                        templateName,
                        studentName: studentDetails.full_name
                    });
                }
            } catch (error) {
                logToFile(`Error sending WhatsApp message to trial class student ${studentDetails.full_name || 'Unknown'}`, 'error', 'trial-reminders', {
                    templateName,
                    studentName: studentDetails.full_name,
                    error: error.message,
                    stack: error.stack
                });
            }
        } else {
            logToFile(`WhatsApp notification skipped for trial student ${studentDetails.full_name || 'Unknown'}`, 'info', 'trial-reminders', {
                templateName,
                studentName: studentDetails.full_name,
                reason: !studentDetails.mobile ? 'No mobile number' : 'No WhatsApp template',
                hasTemplate: !!whatsappNotification,
                hasMobile: !!studentDetails.mobile
            });
        }

        // Send email notification if email is provided
        if (emailNotification && studentDetails.email) {
            logToFile(`Attempting email notification for trial student ${studentDetails.full_name || 'Unknown'}`, 'info', 'trial-reminders', {
                templateName,
                studentName: studentDetails.full_name,
                email: studentDetails.email
            });

            try {
                let email = studentDetails.email;
                const indexOfPlus = email.indexOf('+');

                if (indexOfPlus !== -1) {
                    // Remove the substring starting from the '+' character to the end of the email address
                    email = email.slice(0, indexOfPlus) + email.slice(email.indexOf('@'));
                    logToFile(`Cleaned email address for trial student ${studentDetails.full_name || 'Unknown'}`, 'info', 'trial-reminders', {
                        originalEmail: studentDetails.email,
                        cleanedEmail: email
                    });
                }

                await sendEmail(email, emailNotification.title, emailNotification.content);
                
                logToFile(`Email notification sent successfully to trial student ${studentDetails.full_name || 'Unknown'}`, 'info', 'trial-reminders', {
                    templateName,
                    studentName: studentDetails.full_name,
                    email: email,
                    emailTitle: emailNotification.title
                });

                messageSent = true;
            } catch (error) {
                logToFile(`Error sending email notification to trial class student ${studentDetails.full_name || 'Unknown'}`, 'error', 'trial-reminders', {
                    templateName,
                    studentName: studentDetails.full_name,
                    email: studentDetails.email,
                    error: error.message,
                    stack: error.stack
                });
            }
        } else {
            logToFile(`Email notification skipped for trial student ${studentDetails.full_name || 'Unknown'}`, 'info', 'trial-reminders', {
                templateName,
                studentName: studentDetails.full_name,
                reason: !studentDetails.email ? 'No email address' : 'No email template',
                hasTemplate: !!emailNotification,
                hasEmail: !!studentDetails.email
            });
        }

        logToFile(`Trial class reminder completed for ${studentDetails.full_name || 'Unknown Student'}`, 'info', 'trial-reminders', {
            templateName,
            studentName: studentDetails.full_name,
            success: messageSent
        });

        return messageSent;
    } catch (error) {
        logToFile(`Error in whatsappReminderTrailClass for ${studentDetails.full_name || 'Unknown Student'}`, 'error', 'trial-reminders', {
            templateName,
            studentDetails,
            error: error.message,
            stack: error.stack
        });
        return false;
    }
}

/**
 * Unified email sending function for both registered users and trial class students
 * @param {string} templateName - The notification template name
 * @param {Object} messageParams - Parameters for the notification template
 * @param {Object} recipientDetails - Recipient details for notification
 * @param {boolean} isTrialUser - Whether the recipient is a trial user (not in database)
 * @returns {Promise<boolean>} - Success status of the email notification
 */
async function sendNotificationEmail(templateName, messageParams, recipientDetails, isTrialUser = false) {
    try {
        const recipientName = recipientDetails.full_name || 'Unknown Recipient';
        const recipientId = recipientDetails.id || 'N/A';

        logToFile(`Starting email notification for ${recipientName} (ID: ${recipientId})`, 'info', 'email-notifications', {
            templateName,
            recipientId,
            recipientName,
            isTrialUser,
            email: recipientDetails.email,
            language: recipientDetails.language
        });

        if (!recipientDetails || !recipientDetails.email) {
            logToFile(`No email address provided for ${recipientName} (ID: ${recipientId})`, 'warn', 'email-notifications', {
                templateName,
                recipientId,
                recipientName,
                isTrialUser
            });
            return false;
        }

        // Get the appropriate language from recipient details
        const language = recipientDetails.language || 'EN';
        
        // Get notification content from template
        const emailNotification = NotificationTemplates.getNotification(
            templateName, 
            language, 
            'email', 
            messageParams
        );

        if (!emailNotification) {
            logToFile(`No email template found for ${templateName} in ${language} for ${recipientName} (ID: ${recipientId})`, 'warn', 'email-notifications', {
                templateName,
                language,
                recipientId,
                recipientName,
                isTrialUser
            });
            return false;
        }

        logToFile(`Email template found for ${recipientName} (ID: ${recipientId})`, 'info', 'email-notifications', {
            templateName,
            language,
            recipientId,
            recipientName,
            emailTitle: emailNotification.title
        });

        // Clean up email address - remove plus addressing if present
        let email = recipientDetails.email;
        const indexOfPlus = email.indexOf('+');
        
        if (indexOfPlus !== -1 && email.indexOf('@') > indexOfPlus) {
            // Remove the substring starting from the '+' character to the '@' symbol
            email = email.slice(0, indexOfPlus) + email.slice(email.indexOf('@'));
            logToFile(`Cleaned email address for ${recipientName} (ID: ${recipientId})`, 'info', 'email-notifications', {
                recipientId,
                originalEmail: recipientDetails.email,
                cleanedEmail: email
            });
        }

        // Send the email
        await sendEmail(email, emailNotification.title, emailNotification.content);
        
        logToFile(`Email notification sent successfully to ${recipientName} (ID: ${recipientId})`, 'info', 'email-notifications', {
            templateName,
            recipientId,
            recipientName,
            email: email,
            emailTitle: emailNotification.title,
            isTrialUser
        });
        
        return true;
    } catch (error) {
        const recipientName = recipientDetails?.full_name || 'Unknown Recipient';
        const recipientId = recipientDetails?.id || 'N/A';
        
        logToFile(`Error sending email notification to ${recipientName} (ID: ${recipientId})`, 'error', 'email-notifications', {
            templateName,
            recipientId,
            recipientName,
            isTrialUser,
            error: error.message,
            stack: error.stack
        });
        return false;
    }
}

/**
 * Combined notification function for sending both email and WhatsApp
 * @param {string} templateName - The notification template name
 * @param {Object} messageParams - Parameters for the notification template
 * @param {Object|number} recipient - Recipient object or user ID
 * @param {boolean} isTrialUser - Whether the recipient is a trial user
 * @returns {Promise<Object>} - Success status for each notification channel
 */
async function sendCombinedNotifications(templateName, messageParams, recipient, isTrialUser = false) {
    let recipientDetails;
    let emailSent = false;
    let whatsappSent = false;
    
    try {
        logToFile(`Starting combined notifications`, 'info', 'combined-notifications', {
            templateName,
            recipient: typeof recipient === 'number' ? recipient : recipient?.full_name || 'Unknown',
            isTrialUser,
            messageParams
        });

        // If recipient is a user ID, fetch user details from database
        if (!isTrialUser && typeof recipient === 'number') {
            logToFile(`Fetching user details for ID ${recipient}`, 'info', 'combined-notifications', {
                templateName,
                userId: recipient
            });

            const user = await Users.findOne({
                where: { id: recipient }
            });
            
            if (!user) {
                logToFile(`User not found for ID ${recipient}`, 'error', 'combined-notifications', {
                    templateName,
                    userId: recipient
                });
                return { emailSent: false, whatsappSent: false, error: 'User not found' };
            }
            
            recipientDetails = user;
            
            logToFile(`User found: ${user.full_name} (ID: ${recipient})`, 'info', 'combined-notifications', {
                templateName,
                userId: recipient,
                userName: user.full_name
            });
            
            // Parse notification preferences
            const notificationOptions = JSON.parse(user.notification_channels || '[]');
            const emailNotifyEnabled = notificationOptions.includes('email');
            const whatsappNotifyEnabled = notificationOptions.includes('whatsapp');
            
            logToFile(`Notification preferences for ${user.full_name} (ID: ${recipient})`, 'info', 'combined-notifications', {
                userId: recipient,
                userName: user.full_name,
                emailEnabled: emailNotifyEnabled,
                whatsappEnabled: whatsappNotifyEnabled
            });
            
            // Send notifications based on user preferences
            if (emailNotifyEnabled) {
                emailSent = await sendNotificationEmail(templateName, messageParams, recipientDetails);
            } else {
                logToFile(`Email notification skipped for ${user.full_name} (ID: ${recipient}) - not enabled`, 'info', 'combined-notifications', {
                    userId: recipient,
                    userName: user.full_name
                });
            }
            
        } else {
            // For trial users or when recipient details are directly provided
            recipientDetails = recipient;
            const recipientName = recipient?.full_name || 'Unknown Trial User';
            
            logToFile(`Processing trial user: ${recipientName}`, 'info', 'combined-notifications', {
                templateName,
                recipientName,
                isTrialUser
            });
            
            // Send both email and WhatsApp by default for trial users
            emailSent = await sendNotificationEmail(templateName, messageParams, recipientDetails, isTrialUser);
        }
        
        const recipientName = recipientDetails?.full_name || 'Unknown';
        const recipientId = recipientDetails?.id || 'N/A';
        
        logToFile(`Combined notifications completed for ${recipientName} (ID: ${recipientId})`, 'info', 'combined-notifications', {
            templateName,
            recipientId,
            recipientName,
            emailSent,
            whatsappSent,
            isTrialUser
        });
        
        return { emailSent, whatsappSent };
    } catch (error) {
        logToFile(`Error in sendCombinedNotifications`, 'error', 'combined-notifications', {
            templateName,
            recipient: typeof recipient === 'number' ? recipient : recipient?.full_name || 'Unknown',
            isTrialUser,
            error: error.message,
            stack: error.stack
        });
        return { emailSent, whatsappSent, error: error.message };
    }
}

/**
 * Utility function to test FCM functionality
 */
async function testInAppNotifications(userId) {
    try {
        const user = await Users.findOne({
            where: { id: userId }
        });

        if (!user || !user.fcm_token) {
            console.log('User not found or no FCM token');
            return false;
        }

        const testResult = await inAppService.testFcmToken(user.fcm_token);
        console.log(`FCM test result for user ${user.full_name}: ${testResult}`);
        return testResult;
    } catch (error) {
        console.error('Error testing in-app notifications:', error);
        return false;
    }
}


/**
 * Core function to send broadcast notification to a Firebase topic
 */
async function sendBroadcastNotification(topic, templateName, messageParams, options = {}) {
  try {
    // Prepare FCM message
    const message = {
      notification: {
        title: messageParams.test_title || 'Announcement',
        body: messageParams.test_message || 'You have a new announcement.',
        // imageUrl: options.imageUrl || null
      },
      data: {
        type: 'broadcast',
        template: templateName,
        timestamp: Date.now().toString(),
        ...options.customData
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'broadcast_channel',
          sound: 'default',
        //   imageUrl: options.imageUrl || null
        }
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: messageParams.test_title || 'Announcement',
              body: messageParams.test_message || 'You have a new announcement.'
            },
            sound: 'default',
            badge: 1,
            'mutable-content': 1,
            'content-available': 1
          }
        },
        fcm_options: {
        //   image: options.imageUrl || null
        }
      },
      topic: topic
    };

    // Send message
    const response = await admin.messaging().send(message);
    console.log(`Broadcast sent to topic ${topic}:`, response);
    
    return { success: true, messageId: response, topic, sentAt: new Date().toISOString() };

  } catch (error) {
    return { success: false, error: error.message };
  }
}


module.exports = {
    getReminderTime,
    whatsappReminderAddClass,
    whatsappReminderTrailClass,
    sendNotificationEmail,
    sendCombinedNotifications,
    sendBroadcastNotification,
};