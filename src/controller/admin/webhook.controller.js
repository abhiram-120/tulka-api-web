// controller/admin/webhook.controller.js
const axios = require('axios');
const Theme = require('../../models/themes');
const ThemeColor = require('../../models/themeColors');
const Joi = require('joi');

const DEFAULT_LIGHT_COLORS = {
  primary: "#007AFF",
  primaryLight: "#4A90FF",
  primaryDark: "#0056CC",
  secondary: "#5AC8FA",
  secondaryLight: "#7DD3FC",
  secondaryDark: "#3B82F6",
  accent: "#FF6B6B",
  accentLight: "#FF8E8E",
  accentDark: "#E55555",
  background: "#F2F2F7",
  backgroundSecondary: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceSecondary: "#F9F9F9",
  card: "#FFFFFF",
  cardSecondary: "#FAFAFA",
  text: "#000000",
  textSecondary: "#6D6D80",
  textTertiary: "#8E8E93",
  textInverse: "#FFFFFF",
  textDisabled: "#C7C7CC",
  border: "#E5E5EA",
  borderLight: "#F0F0F0",
  borderDark: "#D1D1D6",
  divider: "#E5E5EA",
  success: "#30D158",
  successLight: "#5DE374",
  successDark: "#28C946",
  warning: "#FF9F0A",
  warningLight: "#FFB340",
  warningDark: "#E6900A",
  error: "#FF3B30",
  errorLight: "#FF6B61",
  errorDark: "#E6342A",
  info: "#5AC8FA",
  infoLight: "#7DD3FC",
  infoDark: "#3B82F6",
  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",
  overlay: "rgba(0, 0, 0, 0.5)",
  shadow: "rgba(0, 0, 0, 0.1)",
  disabled: "#C7C7CC",
  placeholder: "#C7C7CC",
  link: "#007AFF",
  linkVisited: "#5856D6",
  buttonPrimary: "#007AFF",
  buttonSecondary: "#5AC8FA",
  buttonDisabled: "#C7C7CC",
};

const DEFAULT_DARK_COLORS = {
  primary: "#0A84FF",
  primaryLight: "#409CFF",
  primaryDark: "#0066CC",
  secondary: "#64D2FF",
  secondaryLight: "#8FDEFF",
  secondaryDark: "#32C5FF",
  accent: "#FF6B6B",
  accentLight: "#FF8E8E",
  accentDark: "#E55555",
  background: "#000000",
  backgroundSecondary: "#1C1C1E",
  surface: "#1C1C1E",
  surfaceSecondary: "#2C2C2E",
  card: "#2C2C2E",
  cardSecondary: "#3A3A3C",
  text: "#FFFFFF",
  textSecondary: "#8E8E93",
  textTertiary: "#6D6D80",
  textInverse: "#000000",
  textDisabled: "#48484A",
  border: "#38383A",
  borderLight: "#48484A",
  borderDark: "#2C2C2E",
  divider: "#38383A",
  success: "#30D158",
  successLight: "#5DE374",
  successDark: "#28C946",
  warning: "#FF9F0A",
  warningLight: "#FFB340",
  warningDark: "#E6900A",
  error: "#FF453A",
  errorLight: "#FF7066",
  errorDark: "#E6342A",
  info: "#64D2FF",
  infoLight: "#8FDEFF",
  infoDark: "#32C5FF",
  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",
  overlay: "rgba(0, 0, 0, 0.7)",
  shadow: "rgba(0, 0, 0, 0.3)",
  disabled: "#48484A",
  placeholder: "#48484A",
  link: "#0A84FF",
  linkVisited: "#5856D6",
  buttonPrimary: "#0A84FF",
  buttonSecondary: "#64D2FF",
  buttonDisabled: "#48484A",
};

/**
 * Execute Zoom Recording Download Webhook
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const executeZoomRecordingWebhook = async (req, res) => {
    try {
        const {
            user_id,
            teacher_id,
            class_id,
            teacherEmail,
            date,
            startTime,
            endTime,
            StudentCurrentLevel,
            fileContent
        } = req.body;

        // Validate required fields
        const requiredFields = ['user_id', 'teacher_id', 'class_id', 'teacherEmail', 'date', 'startTime', 'endTime'];
        const missingFields = requiredFields.filter(field => !req.body[field]);

        if (missingFields.length > 0) {
            return res.status(400).json({
                status: 'error',
                message: `Missing required fields: ${missingFields.join(', ')}`,
                timestamp: new Date().toISOString()
            });
        }

        // Webhook configuration
        const webhookUrl = 'https://tulkkail.app.n8n.cloud/webhook-test/zoom-recording-download';
        const username = 'mrsahuashish';
        const password = 'mrsahuashish';
        const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');

        // Prepare webhook payload
        const webhookData = {
            user_id,
            teacher_id,
            class_id,
            teacherEmail,
            date,
            startTime,
            endTime,
            StudentCurrentLevel: StudentCurrentLevel || '',
            fileContent: fileContent || ''
        };

        const startTime_execution = Date.now();

        // Make the webhook call
        const webhookResponse = await axios.post(webhookUrl, webhookData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${basicAuth}`,
            },
            timeout: 30000, // 30 second timeout
        });

        const endTime_execution = Date.now();
        const duration = endTime_execution - startTime_execution;

        // Success response
        res.status(200).json({
            status: 'success',
            message: 'Webhook executed successfully',
            data: {
                webhookResponse: webhookResponse.data,
                executionTime: duration,
                webhookStatus: webhookResponse.status,
                webhookStatusText: webhookResponse.statusText
            },
            timestamp: new Date().toISOString(),
            duration: duration
        });

    } catch (error) {
        console.error('Error executing zoom recording webhook:', error);

        // Handle different types of errors
        let errorMessage = 'Failed to execute webhook';
        let statusCode = 500;

        if (error.code === 'ECONNABORTED') {
            errorMessage = 'Webhook request timed out';
            statusCode = 408;
        } else if (error.response) {
            // The request was made and the server responded with a status code
            errorMessage = error.response.data?.message || `Webhook returned status ${error.response.status}`;
            statusCode = error.response.status >= 400 ? error.response.status : 500;
        } else if (error.request) {
            // The request was made but no response was received
            errorMessage = 'No response received from webhook';
            statusCode = 503;
        }

        res.status(statusCode).json({
            status: 'error',
            message: errorMessage,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString(),
            webhookUrl: webhookUrl
        });
    }
};

/**
 * Get Theme Colors
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getThemeColors = async (req, res) => {
    try {
        const { organization_id } = req.query;
        const orgId = organization_id || 'TULKKA';

        // Try to get theme from database
        let theme = await Theme.findOne({
            where: { organization_id: orgId },
            order: [['last_updated', 'DESC']]
        });

        if (!theme) {
            // If no theme exists, create default theme with colors
            theme = await Theme.create({
                version: '1.0.0',
                organization_id: orgId,
                last_updated: new Date()
            });

            // Insert default light colors
            const lightColors = Object.entries(DEFAULT_LIGHT_COLORS).map(([colorName, colorValue]) => ({
                theme_id: theme.id,
                theme_type: 'light',
                color_name: colorName,
                color_value: colorValue
            }));

            // Insert default dark colors
            const darkColors = Object.entries(DEFAULT_DARK_COLORS).map(([colorName, colorValue]) => ({
                theme_id: theme.id,
                theme_type: 'dark',
                color_name: colorName,
                color_value: colorValue
            }));

            // Bulk insert all colors
            await ThemeColor.bulkCreate([...lightColors, ...darkColors]);
        }

        // Fetch all colors for this theme
        const themeColors = await ThemeColor.findAll({
            where: { theme_id: theme.id },
            order: [['theme_type', 'ASC'], ['color_name', 'ASC']]
        });

        // Group colors by theme type
        const lightColors = {};
        const darkColors = {};

        themeColors.forEach(color => {
            if (color.theme_type === 'light') {
                lightColors[color.color_name] = color.color_value;
            } else if (color.theme_type === 'dark') {
                darkColors[color.color_name] = color.color_value;
            }
        });

        // Return the response
        res.status(200).json({
            status: 'success',
            message: 'Theme colors retrieved successfully',
            data: {
                theme: {
                    id: theme.id,
                    version: theme.version,
                    organization_id: theme.organization_id,
                    last_updated: theme.last_updated
                },
                colors: {
                    light: lightColors,
                    dark: darkColors
                },
                lastUpdated: theme.last_updated.toISOString(),
                version: theme.version,
                organizationId: theme.organization_id
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error fetching theme colors:', error);
        
        res.status(500).json({
            status: 'error',
            message: 'Failed to retrieve theme colors',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Update Theme Colors
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateThemeColors = async (req, res) => {
    try {
        // Validation schema
        const schema = Joi.object({
            organization_id: Joi.string().default('TULKKA'),
            version: Joi.string().default('1.0.0'),
            colors: Joi.object({
                light: Joi.object().pattern(
                    Joi.string(),
                    Joi.string().pattern(/^(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}|rgba?\([0-9, \.()]+\)|transparent)$/)
                ),
                dark: Joi.object().pattern(
                    Joi.string(),
                    Joi.string().pattern(/^(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}|rgba?\([0-9, \.()]+\)|transparent)$/)
                )
            }).required()
        });

        const { value, error } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                status: 'error',
                message: 'Validation failed',
                details: error.details.map(detail => detail.message),
                timestamp: new Date().toISOString()
            });
        }

        const { organization_id, version, colors } = value;

        // Find or create theme
        let [theme] = await Theme.findOrCreate({
            where: { organization_id },
            defaults: {
                version,
                organization_id,
                last_updated: new Date()
            }
        });

        // Update theme timestamp and version
        await theme.update({
            version,
            last_updated: new Date()
        });

        // Update light colors if provided
        if (colors.light) {
            for (const [colorName, colorValue] of Object.entries(colors.light)) {
                await ThemeColor.upsert({
                    theme_id: theme.id,
                    theme_type: 'light',
                    color_name: colorName,
                    color_value: colorValue
                });
            }
        }

        // Update dark colors if provided
        if (colors.dark) {
            for (const [colorName, colorValue] of Object.entries(colors.dark)) {
                await ThemeColor.upsert({
                    theme_id: theme.id,
                    theme_type: 'dark',
                    color_name: colorName,
                    color_value: colorValue
                });
            }
        }

        // Fetch updated colors
        const updatedColors = await ThemeColor.findAll({
            where: { theme_id: theme.id },
            order: [['theme_type', 'ASC'], ['color_name', 'ASC']]
        });

        // Group updated colors by theme type
        const lightColors = {};
        const darkColors = {};

        updatedColors.forEach(color => {
            if (color.theme_type === 'light') {
                lightColors[color.color_name] = color.color_value;
            } else if (color.theme_type === 'dark') {
                darkColors[color.color_name] = color.color_value;
            }
        });

        res.status(200).json({
            status: 'success',
            message: 'Theme colors updated successfully',
            data: {
                theme: {
                    id: theme.id,
                    version: theme.version,
                    organization_id: theme.organization_id,
                    last_updated: theme.last_updated
                },
                colors: {
                    light: lightColors,
                    dark: darkColors
                },
                updatedFields: {
                    lightColors: colors.light ? Object.keys(colors.light).length : 0,
                    darkColors: colors.dark ? Object.keys(colors.dark).length : 0
                }
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error updating theme colors:', error);
        
        res.status(500).json({
            status: 'error',
            message: 'Failed to update theme colors',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString()
        });
    }
};

module.exports = {
    executeZoomRecordingWebhook,
    getThemeColors,
    updateThemeColors
};