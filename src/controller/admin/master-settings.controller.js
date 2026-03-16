const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Theme = require('../../models/themes');
const ThemeColor = require('../../models/themeColors');
const Joi = require('joi');

const multer = require('multer');
const multerS3 = require('multer-s3');
const AWS = require('aws-sdk');
const config = require('../../config/config'); // Your AWS credentials source

const hasS3Config = Boolean(config.AWS_BUCKET && config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY);

if (hasS3Config) {
    AWS.config.update({
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        region: 'eu-central-1'
    });
}

const s3 = hasS3Config ? new AWS.S3() : null;

const upload = multer({
    storage: hasS3Config
        ? multerS3({
            s3: s3,
            bucket: config.AWS_BUCKET,
            acl: 'public-read',
            metadata: (req, file, cb) => {
                cb(null, { fieldName: file.fieldname });
            },
            key: (req, file, cb) => {
                const folder = 'settings';
                const timestamp = Date.now();
                const filename = `${folder}/${file.fieldname}-${timestamp}-${file.originalname}`;
                cb(null, filename);
            }
        })
        : multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files are allowed'), false);
    }
}).fields([
    { name: 'app_logo', maxCount: 1 },
    { name: 'app_favicon', maxCount: 1 }
]);

// const { uploadFile, deleteFile } = require('../../utils/file-upload');
// const { successResponse, errorResponse } = require('../../utils/response');

// File path for storing settings JSON
// const SETTINGS_FILE = path.join(__dirname, '../../storage/settings.json');

// Default settings
const defaultSettings = {
    app_name: 'Tulkka',
    primary_color: '#0055FF',
    secondary_color: '#64748b',
    support_email: 'support@tulkka.com',
    phone_number: '',
    logo_url: '',
    favicon_url: '',
    about_app: '',
    terms_conditions: ''
};
const DEFAULT_LIGHT_COLORS = {
    primary: '#007AFF',
    primaryLight: '#4A90FF',
    primaryDark: '#0056CC',
    secondary: '#5AC8FA',
    secondaryLight: '#7DD3FC',
    secondaryDark: '#3B82F6',
    accent: '#FF6B6B',
    accentLight: '#FF8E8E',
    accentDark: '#E55555',
    background: '#F2F2F7',
    backgroundSecondary: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceSecondary: '#F9F9F9',
    card: '#FFFFFF',
    cardSecondary: '#FAFAFA',
    text: '#000000',
    textSecondary: '#6D6D80',
    textTertiary: '#8E8E93',
    textInverse: '#FFFFFF',
    textDisabled: '#C7C7CC',
    border: '#E5E5EA',
    borderLight: '#F0F0F0',
    borderDark: '#D1D1D6',
    divider: '#E5E5EA',
    success: '#30D158',
    successLight: '#5DE374',
    successDark: '#28C946',
    warning: '#FF9F0A',
    warningLight: '#FFB340',
    warningDark: '#E6900A',
    error: '#FF3B30',
    errorLight: '#FF6B61',
    errorDark: '#E6342A',
    info: '#5AC8FA',
    infoLight: '#7DD3FC',
    infoDark: '#3B82F6',
    white: '#FFFFFF',
    black: '#000000',
    transparent: 'transparent',
    overlay: 'rgba(0, 0, 0, 0.5)',
    shadow: 'rgba(0, 0, 0, 0.1)',
    disabled: '#C7C7CC',
    placeholder: '#C7C7CC',
    link: '#007AFF',
    linkVisited: '#5856D6',
    buttonPrimary: '#007AFF',
    buttonSecondary: '#5AC8FA',
    buttonDisabled: '#C7C7CC'
};

const DEFAULT_DARK_COLORS = {
    primary: '#0A84FF',
    primaryLight: '#409CFF',
    primaryDark: '#0066CC',
    secondary: '#64D2FF',
    secondaryLight: '#8FDEFF',
    secondaryDark: '#32C5FF',
    accent: '#FF6B6B',
    accentLight: '#FF8E8E',
    accentDark: '#E55555',
    background: '#000000',
    backgroundSecondary: '#1C1C1E',
    surface: '#1C1C1E',
    surfaceSecondary: '#2C2C2E',
    card: '#2C2C2E',
    cardSecondary: '#3A3A3C',
    text: '#FFFFFF',
    textSecondary: '#8E8E93',
    textTertiary: '#6D6D80',
    textInverse: '#000000',
    textDisabled: '#48484A',
    border: '#38383A',
    borderLight: '#48484A',
    borderDark: '#2C2C2E',
    divider: '#38383A',
    success: '#30D158',
    successLight: '#5DE374',
    successDark: '#28C946',
    warning: '#FF9F0A',
    warningLight: '#FFB340',
    warningDark: '#E6900A',
    error: '#FF453A',
    errorLight: '#FF7066',
    errorDark: '#E6342A',
    info: '#64D2FF',
    infoLight: '#8FDEFF',
    infoDark: '#32C5FF',
    white: '#FFFFFF',
    black: '#000000',
    transparent: 'transparent',
    overlay: 'rgba(0, 0, 0, 0.7)',
    shadow: 'rgba(0, 0, 0, 0.3)',
    disabled: '#48484A',
    placeholder: '#48484A',
    link: '#0A84FF',
    linkVisited: '#5856D6',
    buttonPrimary: '#0A84FF',
    buttonSecondary: '#64D2FF',
    buttonDisabled: '#48484A'
};
// Multer config

const storage = multer.memoryStorage();

// Load settings from file
function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Error reading settings:', err);
    }
    return defaultSettings;
}

// Save settings to file
function saveSettings(data) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

// Manual validation
function validate(data) {
    const errors = [];
    if (!data.app_name?.trim()) {
        errors.push({ field: 'app_name', message: 'App name is required' });
    }
    if (!/^#[0-9A-F]{6}$/i.test(data.primary_color)) {
        errors.push({ field: 'primary_color', message: 'Invalid hex color' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.support_email)) {
        errors.push({ field: 'support_email', message: 'Invalid email address' });
    }
    if (data.secondary_color && !/^#[0-9A-F]{6}$/i.test(data.secondary_color)) {
        errors.push({ field: 'secondary_color', message: 'Invalid hex color' });
    }
    return errors;
}

// GET settings
const getMasterSettings = (req, res) => {
    const data = loadSettings();
    return successResponse(res, 'Settings loaded successfully', data);
};

// POST update settings
// const updateMasterSettings = (req, res) => {
//     upload(req, res, async (err) => {
//         if (err) return errorResponse(res, err.message, 400);

//         try {
//             const input = {
//                 app_name: req.body.app_name,
//                 primary_color: req.body.primary_color,
//                 secondary_color: req.body.secondary_color || '',
//                 support_email: req.body.support_email,
//                 phone_number: req.body.phone_number || '',
//                 about_app: req.body.about_app || '',
//                 terms_conditions: req.body.terms_conditions || ''
//             };

//             const errors = validate(input);
//             if (errors.length > 0) {
//                 return errorResponse(res, 'Validation failed', 400, errors);
//             }

//             const prevSettings = loadSettings();
//             let logo_url = prevSettings.logo_url || '';
//             let favicon_url = prevSettings.favicon_url || '';

//             // Logo upload
//             if (req.files?.app_logo?.[0]) {
//                 if (logo_url) await deleteFile(logo_url);
//                 logo_url = await uploadFile(req.files.app_logo[0], 'logos');
//             }

//             // Favicon upload
//             if (req.files?.app_favicon?.[0]) {
//                 const faviconFile = req.files.app_favicon[0];
//                 if (faviconFile.size > 512 * 1024) {
//                     return errorResponse(res, 'Favicon must be under 512KB', 400);
//                 }
//                 if (favicon_url) await deleteFile(favicon_url);
//                 favicon_url = await uploadFile(faviconFile, 'favicons');
//             }

//             const finalSettings = {
//                 ...input,
//                 logo_url,
//                 favicon_url,
//                 updated_at: new Date().toISOString(),
//                 updated_by: req.user?.id || 'system'
//             };

//             saveSettings(finalSettings);
//             return successResponse(res, 'Settings updated successfully', finalSettings);
//         } catch (e) {
//             console.error('Error updating settings:', e);
//             return errorResponse(res, 'Server error', 500);
//         }
//     });
// };
// FIXED: updateMasterSettings function with proper dark theme color handling

const updateMasterSettings = (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            console.error('Upload error:', err);
            return res.status(400).json({
                success: false,
                status: 'error',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }

        try {
            // Your existing validation schema
            const masterSettingsSchema = Joi.object({
                // Basic app settings
                app_name: Joi.string().required().trim().min(1).messages({
                    'string.empty': 'App name is required',
                    'any.required': 'App name is required'
                }),
                primary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .required()
                    .messages({
                        'string.pattern.base': 'Primary color must be a valid hex color (e.g., #FF0000)',
                        'any.required': 'Primary color is required'
                    }),
                secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow('')
                    .messages({
                        'string.pattern.base': 'Secondary color must be a valid hex color (e.g., #FF0000)'
                    }),
                support_email: Joi.string().email().required().messages({
                    'string.email': 'Please enter a valid email address',
                    'any.required': 'Support email is required'
                }),
                phone_number: Joi.string().allow(''),
                about_app: Joi.string().allow(''),
                terms_conditions: Joi.string().allow(''),
                app_logo: Joi.string().uri().allow(''),
                app_favicon: Joi.string().uri().allow(''),

                // Light theme colors
                accent_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                background_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                background_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                border_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                border_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                border_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                button_primary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                button_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                button_disabled_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                card_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                card_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                error_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                error_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                error_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                success_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                success_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                success_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                warning_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                warning_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                warning_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                info_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                info_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                info_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                text_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                text_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                text_tertiary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                text_disabled_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                text_inverse_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                surface_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                surface_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                link_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                link_visited_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                placeholder_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                disabled_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                divider_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                shadow_color: Joi.string().allow(''),
                overlay_color: Joi.string().allow(''),

                // Dark theme colors
                dark_accent_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_accent_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_accent_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_background_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_background_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_border_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_border_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_border_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_button_primary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_button_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_button_disabled_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_card_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_card_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_error_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_error_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_error_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_success_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_success_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_success_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_warning_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_warning_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_warning_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_info_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_info_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_info_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_text_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_text_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_text_tertiary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_text_disabled_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_text_inverse_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_surface_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_surface_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_link_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_link_visited_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_placeholder_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_disabled_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_divider_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_shadow_color: Joi.string().allow(''),
                dark_overlay_color: Joi.string().allow(''),
                dark_primary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_primary_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_primary_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_secondary_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_secondary_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow('')
            });

            const { value, error } = masterSettingsSchema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    status: 'error',
                    message: 'Validation failed',
                    details: error.details.map((detail) => ({
                        field: detail.path[0],
                        message: detail.message
                    })),
                    timestamp: new Date().toISOString()
                });
            }

            console.log('Received form data:', Object.keys(value));

            const { organization_id } = req.query;
            const orgId = organization_id || 'TULKKA';

            // Find or create theme
            let [theme, created] = await Theme.findOrCreate({
                where: { organization_id: orgId },
                defaults: {
                    version: '1.0.0',
                    organization_id: orgId,
                    last_updated: new Date(),
                    app_name: value.app_name,
                    support_email: value.support_email,
                    phone_number: value.phone_number,
                    about_app: value.about_app,
                    terms_conditions: value.terms_conditions
                }
            });

            // Handle file uploads
            let updatedFields = {};

            if (req.files?.app_logo?.[0]) {
                if (theme.app_logo) {
                    await deleteFileFromS3(theme.app_logo);
                }
                updatedFields.app_logo = req.files.app_logo[0].location;
            } else if (value.app_logo) {
                updatedFields.app_logo = value.app_logo;
            }

            if (req.files?.app_favicon?.[0]) {
                const faviconFile = req.files.app_favicon[0];
                if (faviconFile.size > 512 * 1024) {
                    return res.status(400).json({
                        success: false,
                        status: 'error',
                        message: 'Favicon must be under 512KB',
                        timestamp: new Date().toISOString()
                    });
                }
                if (theme.app_favicon) {
                    await deleteFileFromS3(theme.app_favicon);
                }
                updatedFields.app_favicon = faviconFile.location;
            } else if (value.app_favicon) {
                updatedFields.app_favicon = value.app_favicon;
            }

            // Update theme with new data
            await theme.update({
                app_name: value.app_name,
                support_email: value.support_email,
                phone_number: value.phone_number,
                about_app: value.about_app,
                terms_conditions: value.terms_conditions,
                ...updatedFields,
                last_updated: new Date(),
                updated_by: req.user?.id || 'system'
            });

            // FIXED: Helper function to map form field names to color names
            const mapFormFieldToColorName = (fieldName) => {
                // Handle special cases first
                if (fieldName === 'primary_color') return 'primary';
                if (fieldName === 'secondary_color') return 'secondary';

                // For dark theme fields, remove 'dark_' prefix and convert to camelCase
                if (fieldName.startsWith('dark_')) {
                    const withoutDarkPrefix = fieldName.replace(/^dark_/, '');
                    return withoutDarkPrefix.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
                }

                // For light theme fields, convert snake_case to camelCase
                return fieldName.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
            };

            // Process light theme colors
            const lightColorFields = [
                'primary_color',
                'secondary_color',
                'accent_color',
                'background_color',
                'background_secondary_color',
                'border_color',
                'border_dark_color',
                'border_light_color',
                'button_primary_color',
                'button_secondary_color',
                'button_disabled_color',
                'card_color',
                'card_secondary_color',
                'error_color',
                'error_dark_color',
                'error_light_color',
                'success_color',
                'success_dark_color',
                'success_light_color',
                'warning_color',
                'warning_dark_color',
                'warning_light_color',
                'info_color',
                'info_dark_color',
                'info_light_color',
                'text_color',
                'text_secondary_color',
                'text_tertiary_color',
                'text_disabled_color',
                'text_inverse_color',
                'surface_color',
                'surface_secondary_color',
                'link_color',
                'link_visited_color',
                'placeholder_color',
                'disabled_color',
                'divider_color',
                'shadow_color',
                'overlay_color'
            ];

            console.log('Processing light colors...');

            for (const fieldName of lightColorFields) {
                if (fieldName in value) {
                    const colorValue = value[fieldName];
                    const colorName = mapFormFieldToColorName(fieldName);

                    console.log(`Updating light color: ${fieldName} -> ${colorName} = ${colorValue}`);

                    if (colorValue && colorValue.trim() !== '') {
                        await ThemeColor.upsert({
                            theme_id: theme.id,
                            theme_type: 'light',
                            color_name: colorName,
                            color_value: colorValue
                        });
                    }
                }
            }

            // FIXED: Process dark theme colors
            const darkColorFields = [
                'dark_primary_color',
                'dark_primary_light_color',
                'dark_primary_dark_color',
                'dark_secondary_color',
                'dark_secondary_light_color',
                'dark_secondary_dark_color',
                'dark_accent_color',
                'dark_accent_dark_color',
                'dark_accent_light_color',
                'dark_background_color',
                'dark_background_secondary_color',
                'dark_border_color',
                'dark_border_dark_color',
                'dark_border_light_color',
                'dark_button_primary_color',
                'dark_button_secondary_color',
                'dark_button_disabled_color',
                'dark_card_color',
                'dark_card_secondary_color',
                'dark_error_color',
                'dark_error_dark_color',
                'dark_error_light_color',
                'dark_success_color',
                'dark_success_dark_color',
                'dark_success_light_color',
                'dark_warning_color',
                'dark_warning_dark_color',
                'dark_warning_light_color',
                'dark_info_color',
                'dark_info_dark_color',
                'dark_info_light_color',
                'dark_text_color',
                'dark_text_secondary_color',
                'dark_text_tertiary_color',
                'dark_text_disabled_color',
                'dark_text_inverse_color',
                'dark_surface_color',
                'dark_surface_secondary_color',
                'dark_link_color',
                'dark_link_visited_color',
                'dark_placeholder_color',
                'dark_disabled_color',
                'dark_divider_color',
                'dark_shadow_color',
                'dark_overlay_color'
            ];

            console.log('Processing dark colors...');

            for (const fieldName of darkColorFields) {
                if (fieldName in value) {
                    const colorValue = value[fieldName];
                    const colorName = mapFormFieldToColorName(fieldName);

                    console.log(`Updating dark color: ${fieldName} -> ${colorName} = ${colorValue}`);

                    // CRITICAL: Save with theme_type: 'dark'
                    if (colorValue && colorValue.trim() !== '') {
                        await ThemeColor.upsert({
                            theme_id: theme.id,
                            theme_type: 'dark', // ← This is the crucial fix!
                            color_name: colorName,
                            color_value: colorValue
                        });
                    }
                }
            }

            // Wait for database operations to complete
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Reload theme instance to get fresh data
            await theme.reload();

            // Get ALL updated colors from database with proper ordering
            const updatedColors = await ThemeColor.findAll({
                where: { theme_id: theme.id },
                order: [
                    ['theme_type', 'ASC'],
                    ['color_name', 'ASC']
                ]
            });

            console.log(`Found ${updatedColors.length} colors in database`);

            const light = {};
            const dark = {};

            updatedColors.forEach((c) => {
                if (c.theme_type === 'light') {
                    light[c.color_name] = c.color_value;
                } else if (c.theme_type === 'dark') {
                    dark[c.color_name] = c.color_value;
                }
            });

            console.log('Light colors count:', Object.keys(light).length);
            console.log('Dark colors count:', Object.keys(dark).length);

            // Return actual database values
            const responseData = {
                theme: {
                    id: theme.id,
                    version: theme.version,
                    organization_id: theme.organization_id,
                    last_updated: theme.last_updated,
                    app_name: theme.app_name,
                    support_email: theme.support_email,
                    phone_number: theme.phone_number,
                    app_logo: theme.app_logo,
                    app_favicon: theme.app_favicon,
                    about_app: theme.about_app,
                    terms_conditions: theme.terms_conditions
                },
                colors: { light, dark }, // Actual database values
                lastUpdated: theme.last_updated,
                version: theme.version,
                organizationId: theme.organization_id
            };

            return res.status(200).json({
                success: true,
                status: 'success',
                message: 'Master settings updated successfully',
                data: responseData,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Update failed:', error);
            return res.status(500).json({
                success: false,
                status: 'error',
                message: 'Failed to update master settings',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
                timestamp: new Date().toISOString()
            });
        }
    });
};
/**
 * Get Theme Colors
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
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

        let isNewTheme = false;

        if (!theme) {
            // If no theme exists, create default theme with colors
            theme = await Theme.create({
                version: '1.0.0',
                organization_id: orgId,
                last_updated: new Date(),
                app_name: 'TULKKA', // Default app name
                support_email: '',
                phone_number: '',
                about_app: '',
                terms_conditions: ''
            });

            isNewTheme = true;

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

        // Always fetch the actual colors from database (not defaults)
        const themeColors = await ThemeColor.findAll({
            where: { theme_id: theme.id },
            order: [
                ['theme_type', 'ASC'],
                ['color_name', 'ASC']
            ]
        });

        // Group colors by theme type - using actual database values
        const lightColors = {};
        const darkColors = {};

        themeColors.forEach((color) => {
            if (color.theme_type === 'light') {
                lightColors[color.color_name] = color.color_value;
            } else if (color.theme_type === 'dark') {
                darkColors[color.color_name] = color.color_value;
            }
        });

        // **IMPORTANT**: Only add defaults if no colors exist in database at all
        // This ensures we return actual updated data, not defaults
        if (Object.keys(lightColors).length === 0 && Object.keys(darkColors).length === 0) {
            // This should rarely happen since we create defaults above, but just in case
            Object.assign(lightColors, DEFAULT_LIGHT_COLORS);
            Object.assign(darkColors, DEFAULT_DARK_COLORS);
        }

        // Refresh theme data to get the latest values after any updates
        await theme.reload();

        // Return the response with actual database values
        res.status(200).json({
            success: true, // Added for frontend consistency
            status: 'success',
            message: isNewTheme ? 'Default theme created successfully' : 'Theme colors retrieved successfully',
            data: {
                theme: {
                    id: theme.id,
                    version: theme.version || '1.0.0',
                    organization_id: theme.organization_id,
                    last_updated: theme.last_updated,
                    app_name: theme.app_name || '',
                    support_email: theme.support_email || '',
                    phone_number: theme.phone_number || '',
                    app_logo: theme.app_logo || null,
                    app_favicon: theme.app_favicon || null,
                    about_app: theme.about_app || '',
                    terms_conditions: theme.terms_conditions || ''
                },
                colors: {
                    light: lightColors, // Actual database values
                    dark: darkColors // Actual database values
                },
                lastUpdated: theme.last_updated ? theme.last_updated.toISOString() : new Date().toISOString(),
                version: theme.version || '1.0.0',
                organizationId: theme.organization_id
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching theme colors:', error);

        res.status(500).json({
            success: false, // Added for frontend consistency
            status: 'error',
            message: 'Failed to retrieve theme colors',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Update Theme Colors - Enhanced to ensure fresh data retrieval
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateThemeColors = async (req, res) => {
    // Handle file uploads with multer
    upload(req, res, async (err) => {
        if (err) {
            console.error('Upload error:', err);
            return res.status(400).json({
                success: false,
                status: 'error',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }

        try {
            const { organization_id } = req.query;
            const orgId = organization_id || 'TULKKA';

            // Define complete validation schema
            const themeSchema = Joi.object({
                // Basic app settings
                app_name: Joi.string().required().trim().min(1).messages({
                    'string.empty': 'App name is required',
                    'any.required': 'App name is required'
                }),
                primary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .required()
                    .messages({
                        'string.pattern.base': 'Primary color must be a valid hex color (e.g., #FF0000)',
                        'any.required': 'Primary color is required'
                    }),
                secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow('')
                    .messages({
                        'string.pattern.base': 'Secondary color must be a valid hex color (e.g., #FF0000)'
                    }),
                support_email: Joi.string().email().required().messages({
                    'string.email': 'Please enter a valid email address',
                    'any.required': 'Support email is required'
                }),
                phone_number: Joi.string().allow(''),
                about_app: Joi.string().allow(''),
                terms_conditions: Joi.string().allow(''),
                app_logo: Joi.string().uri().allow(''),
                app_favicon: Joi.string().uri().allow(''),

                // Light theme colors
                accent_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                background_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                background_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                border_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                border_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                border_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                button_primary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                button_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                button_disabled_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                card_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                card_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                error_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                error_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                error_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                success_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                success_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                success_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                warning_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                warning_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                warning_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                info_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                info_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                info_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                text_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                text_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                text_tertiary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                text_disabled_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                text_inverse_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                surface_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                surface_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                link_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                link_visited_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                placeholder_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                disabled_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                divider_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                shadow_color: Joi.string().allow(''),
                overlay_color: Joi.string().allow(''),

                // Dark theme colors
                dark_primary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_primary_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_primary_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_secondary_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_secondary_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_accent_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_accent_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_accent_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_background_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_background_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_border_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_border_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_border_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_button_primary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_button_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_button_disabled_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_card_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_card_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_error_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_error_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_error_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_success_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_success_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_success_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_warning_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_warning_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_warning_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_info_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_info_dark_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_info_light_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_text_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_text_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_text_tertiary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_text_disabled_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_text_inverse_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_surface_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_surface_secondary_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_link_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_link_visited_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_placeholder_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_disabled_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_divider_color: Joi.string()
                    .pattern(/^#[0-9A-Fa-f]{6}$/)
                    .allow(''),
                dark_shadow_color: Joi.string().allow(''),
                dark_overlay_color: Joi.string().allow('')
            });

            // Validate request data
            const { value, error } = themeSchema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    status: 'error',
                    message: 'Validation failed',
                    details: error.details.map((d) => ({
                        field: d.path[0],
                        message: d.message
                    })),
                    timestamp: new Date().toISOString()
                });
            }

            // Find or create theme
            let [theme, created] = await Theme.findOrCreate({
                where: { organization_id: orgId },
                defaults: {
                    version: '1.0.0',
                    organization_id: orgId,
                    last_updated: new Date(),
                    app_name: value.app_name,
                    support_email: value.support_email,
                    phone_number: value.phone_number || '',
                    about_app: value.about_app || '',
                    terms_conditions: value.terms_conditions || ''
                }
            });

            // Handle file uploads
            let updatedFields = {};
            if (req.files?.app_logo?.[0]) {
                if (theme.app_logo) await deleteFileFromS3(theme.app_logo);
                updatedFields.app_logo = req.files.app_logo[0].location;
            } else if (value.app_logo) {
                updatedFields.app_logo = value.app_logo;
            }

            if (req.files?.app_favicon?.[0]) {
                if (theme.app_favicon) await deleteFileFromS3(theme.app_favicon);
                updatedFields.app_favicon = req.files.app_favicon[0].location;
            } else if (value.app_favicon) {
                updatedFields.app_favicon = value.app_favicon;
            }

            // Update theme metadata
            await theme.update({
                app_name: value.app_name,
                support_email: value.support_email,
                phone_number: value.phone_number || '',
                about_app: value.about_app || '',
                terms_conditions: value.terms_conditions || '',
                ...updatedFields,
                last_updated: new Date(),
                updated_by: req.user?.id || 'system'
            });

            // Helper function to map form fields to color names
            const mapColorField = (fieldName) => {
                // Handle special cases first
                if (fieldName === 'primary_color') return 'primary';
                if (fieldName === 'secondary_color') return 'secondary';

                // Remove _color suffix and convert snake_case to camelCase
                return fieldName.replace(/_color$/, '').replace(/_([a-z])/g, (g) => g[1].toUpperCase());
            };

            // Process all light theme colors
            const lightColorFields = [
                'primary_color',
                'secondary_color',
                'accent_color',
                'background_color',
                'background_secondary_color',
                'border_color',
                'border_dark_color',
                'border_light_color',
                'button_primary_color',
                'button_secondary_color',
                'button_disabled_color',
                'card_color',
                'card_secondary_color',
                'error_color',
                'error_dark_color',
                'error_light_color',
                'success_color',
                'success_dark_color',
                'success_light_color',
                'warning_color',
                'warning_dark_color',
                'warning_light_color',
                'info_color',
                'info_dark_color',
                'info_light_color',
                'text_color',
                'text_secondary_color',
                'text_tertiary_color',
                'text_disabled_color',
                'text_inverse_color',
                'surface_color',
                'surface_secondary_color',
                'link_color',
                'link_visited_color',
                'placeholder_color',
                'disabled_color',
                'divider_color',
                'shadow_color',
                'overlay_color'
            ];

            for (const fieldName of lightColorFields) {
                if (fieldName in value && value[fieldName]) {
                    await ThemeColor.upsert({
                        theme_id: theme.id,
                        theme_type: 'light',
                        color_name: mapColorField(fieldName),
                        color_value: value[fieldName]
                    });
                }
            }

            // Process all dark theme colors
            const darkColorFields = [
                'dark_primary_color',
                'dark_primary_dark_color',
                'dark_primary_light_color',
                'dark_secondary_color',
                'dark_secondary_dark_color',
                'dark_secondary_light_color',
                'dark_accent_color',
                'dark_accent_dark_color',
                'dark_accent_light_color',
                'dark_background_color',
                'dark_background_secondary_color',
                'dark_border_color',
                'dark_border_dark_color',
                'dark_border_light_color',
                'dark_button_primary_color',
                'dark_button_secondary_color',
                'dark_button_disabled_color',
                'dark_card_color',
                'dark_card_secondary_color',
                'dark_error_color',
                'dark_error_dark_color',
                'dark_error_light_color',
                'dark_success_color',
                'dark_success_dark_color',
                'dark_success_light_color',
                'dark_warning_color',
                'dark_warning_dark_color',
                'dark_warning_light_color',
                'dark_info_color',
                'dark_info_dark_color',
                'dark_info_light_color',
                'dark_text_color',
                'dark_text_secondary_color',
                'dark_text_tertiary_color',
                'dark_text_disabled_color',
                'dark_text_inverse_color',
                'dark_surface_color',
                'dark_surface_secondary_color',
                'dark_link_color',
                'dark_link_visited_color',
                'dark_placeholder_color',
                'dark_disabled_color',
                'dark_divider_color',
                'dark_shadow_color',
                'dark_overlay_color'
            ];

            for (const fieldName of darkColorFields) {
                if (fieldName in value && value[fieldName]) {
                    await ThemeColor.upsert({
                        theme_id: theme.id,
                        theme_type: 'dark',
                        color_name: mapColorField(fieldName),
                        color_value: value[fieldName]
                    });
                }
            }

            // Get updated theme with colors
            const updatedColors = await ThemeColor.findAll({
                where: { theme_id: theme.id },
                order: [
                    ['theme_type', 'ASC'],
                    ['color_name', 'ASC']
                ]
            });

            // Format colors into light/dark objects
            const colors = {
                light: {},
                dark: {}
            };

            updatedColors.forEach((color) => {
                if (color.theme_type === 'light') {
                    colors.light[color.color_name] = color.color_value;
                } else {
                    colors.dark[color.color_name] = color.color_value;
                }
            });

            // Return success response
            return res.status(200).json({
                success: true,
                status: 'success',
                message: 'Theme colors updated successfully',
                data: {
                    theme: {
                        id: theme.id,
                        version: theme.version,
                        organization_id: theme.organization_id,
                        last_updated: theme.last_updated,
                        app_name: theme.app_name,
                        support_email: theme.support_email,
                        phone_number: theme.phone_number,
                        app_logo: theme.app_logo,
                        app_favicon: theme.app_favicon,
                        about_app: theme.about_app,
                        terms_conditions: theme.terms_conditions
                    },
                    colors,
                    lastUpdated: theme.last_updated,
                    version: theme.version,
                    organizationId: theme.organization_id
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Update failed:', error);
            return res.status(500).json({
                success: false,
                status: 'error',
                message: 'Failed to update theme colors',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
                timestamp: new Date().toISOString()
            });
        }
    });
};

const uploadFileToS3 = (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            console.error('Upload error:', err);
            return res.status(400).json({
                success: false,
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }

        try {
            // Check which file was uploaded
            let uploadedFile = null;
            let fileType = null;

            if (req.files?.app_logo?.[0]) {
                uploadedFile = req.files.app_logo[0];
                fileType = 'app_logo';
            } else if (req.files?.app_favicon?.[0]) {
                uploadedFile = req.files.app_favicon[0];
                fileType = 'app_favicon';

                // Validate favicon size (512KB limit)
                if (uploadedFile.size > 512 * 1024) {
                    return res.status(400).json({
                        success: false,
                        message: 'Favicon must be under 512KB',
                        timestamp: new Date().toISOString()
                    });
                }
            }

            if (!uploadedFile) {
                return res.status(400).json({
                    success: false,
                    message: 'No file uploaded. Please select a file.',
                    timestamp: new Date().toISOString()
                });
            }

            // File was successfully uploaded to S3 via multer-s3
            return res.status(200).json({
                success: true,
                message: `${fileType === 'app_logo' ? 'Logo' : 'Favicon'} uploaded successfully`,
                url: uploadedFile.location,
                fileType: fileType,
                originalName: uploadedFile.originalname,
                size: uploadedFile.size,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('File processing error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to process uploaded file',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
                timestamp: new Date().toISOString()
            });
        }
    });
};

// Helper function to delete file from S3 (if you don't have it already)
const deleteFileFromS3 = async (fileUrl) => {
    try {
        if (!fileUrl) return;

        // Extract key from S3 URL
        const urlParts = fileUrl.split('/');
        const key = urlParts.slice(-2).join('/'); // Get folder/filename

        const deleteParams = {
            Bucket: config.AWS_BUCKET,
            Key: key
        };

        await s3.deleteObject(deleteParams).promise();
        console.log(`Deleted file: ${key}`);
    } catch (error) {
        console.error('Error deleting file from S3:', error);
    }
};
module.exports = {
    getMasterSettings,
    updateMasterSettings,
    getThemeColors,
    updateThemeColors,
    uploadFileToS3, // Add this
    deleteFileFromS3
};
