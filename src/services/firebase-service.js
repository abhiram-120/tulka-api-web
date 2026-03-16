// firebase-service.js
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class FirebaseService {
    constructor() {
        this.serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
            ? path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS)
            : path.resolve(process.cwd(), 'tulkka-firebase-adminsdk-douvv-4b2c75eda1.json');
        this.projectId = 'tulkka'; // Your Firebase project ID
        this.auth = null;
        this.initializeAuth();
    }

    /**
     * Initialize Google Auth with Firebase Messaging scope
     */
    initializeAuth() {
        const inlineCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

        if (inlineCredentials) {
            this.auth = new GoogleAuth({
                credentials: JSON.parse(inlineCredentials),
                scopes: ['https://www.googleapis.com/auth/firebase.messaging']
            });
            return;
        }

        if (fs.existsSync(this.serviceAccountPath)) {
            this.auth = new GoogleAuth({
                keyFile: this.serviceAccountPath,
                scopes: ['https://www.googleapis.com/auth/firebase.messaging']
            });
            return;
        }

        this.auth = null;
    }

    /**
     * Get access token for Firebase API calls
     * Equivalent to PHP's fetchAccessTokenWithAssertion()
     */
    async getAccessToken() {
        try {
            if (!this.auth) {
                throw new Error('Firebase credentials are not configured');
            }
            const client = await this.auth.getClient();
            const tokenInfo = await client.getAccessToken();
            
            if (!tokenInfo || !tokenInfo.token) {
                throw new Error('Unable to fetch access token');
            }
            
            return tokenInfo.token;
        } catch (error) {
            console.error('Error getting access token:', error);
            throw new Error('Unable to fetch access token: ' + error.message);
        }
    }

    /**
     * Send push notification to single device
     * @param {string} registrationToken - FCM token of the device
     * @param {Object} notification - Notification payload
     * @param {Object} data - Optional data payload
     * @returns {Promise<Object>} - Response from FCM
     */
    async sendNotificationToDevice(registrationToken, notification, data = {}) {
        try {
            if (process.env.NOTIFICATIONS_ENABLED === 'false') {
                console.log(`[SUPPRESSED] In-app notification for user ${userId}, template: ${templateName}`);
                return true;
            }
            const accessToken = await this.getAccessToken();
            
            const message = {
                token: registrationToken,
                notification: {
                    title: notification.title,
                    body: notification.body
                },
                // iOS specific configuration (equivalent to apns in PHP)
                apns: {
                    headers: {
                        'apns-priority': '10',
                    },
                    payload: {
                        aps: {
                            alert: {
                                title: notification.title,
                                body: notification.body,
                            },
                            sound: 'default',
                            badge: 1,
                            'content-available': 1,
                            'mutable-content': 1,
                        }
                    }
                },
                // Android specific configuration
                android: {
                    priority: 'high',
                    notification: {
                        sound: 'default',
                        channel_id: 'default'
                    }
                }
            };

            // Add custom data if provided
            if (Object.keys(data).length > 0) {
                message.data = data;
            }

            const response = await axios({
                method: 'POST',
                url: `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`,
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                data: {
                    message: message
                }
            });

            return {
                success: true,
                data: response.data,
                messageId: response.data.name
            };

        } catch (error) {
            console.error('Error sending FCM notification:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data || error.message
            };
        }
    }

    /**
     * Send notifications to multiple devices
     * @param {Array<string>} registrationTokens - Array of FCM tokens
     * @param {Object} notification - Notification payload
     * @param {Object} data - Optional data payload
     * @returns {Promise<Array>} - Array of responses
     */
    async sendNotificationToMultipleDevices(registrationTokens, notification, data = {}) {
        const promises = registrationTokens.map(token => 
            this.sendNotificationToDevice(token, notification, data)
        );
        
        return Promise.allSettled(promises);
    }

    /**
     * Parse FCM token string (handles both single token and JSON array)
     * Equivalent to the token parsing logic in your PHP code
     * @param {string} fcmTokenString - Token string from database
     * @returns {Array<string>} - Array of valid tokens
     */
    parseFcmTokens(fcmTokenString) {
        if (!fcmTokenString) return [];
        
        try {
            // Check if it's a JSON array
            if (fcmTokenString.startsWith('[')) {
                const tokens = JSON.parse(fcmTokenString);
                return Array.isArray(tokens) ? tokens.filter(token => token && token.trim()) : [];
            } else {
                // Single token
                return [fcmTokenString.trim()];
            }
        } catch (error) {
            console.error('Error parsing FCM tokens:', error);
            return [];
        }
    }
}

module.exports = FirebaseService;