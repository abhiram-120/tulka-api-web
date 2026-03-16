const bcrypt = require('bcrypt');
const Joi = require('joi');
const axios = require('axios');

const Users = require('../models/users');
const Verifications = require('../models/verifications');
const FailedLoginAttempts = require('../models/failedLoginAttempts');
const generateToken = require('../middleware/generate-token');
const generateOTP = require('../utils/generateOTP');
const securePassword = require('../utils/encryptPassword');
const sendEmail = require('../utils/sendEmail');
const { Op, Sequelize } = require('sequelize');
const twilio = require('twilio');
const config = require('../config/config');
const UserSubscriptionDetails = require('../models/UserSubscriptionDetails');
const Theme = require('../models/themes');
const ThemeColor = require('../models/themeColors');
const e = require('cors');
const ReferralLink = require('../models/ReferralLink');
const Referral = require('../models/Referral');
const ReferralTier = require('../models/ReferralTier');
// Register new student
const FreeClass = require('../models/FreeClass');

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

async function registerStudent(req, res) {
    try {
        //validation using joi
        const schema = Joi.object().keys({
            full_name: Joi.string()
                .regex(/^[a-zA-Z0-9 ]*$/, 'Characters only allowed in full_name')
                .required()
                .messages({
                    'string.comments': 'Full name should be a type of text',
                    'string.empty': 'Full name cannot be an empty field',
                    'any.required': 'Full name is a required field'
                }),
            email: Joi.string().email().required().messages({
                'string.empty': 'email cannot be an empty field',
                'any.required': 'email is a required field'
            }),
            country_code: Joi.string().required().messages({
                'string.empty': 'country_code cannot be an empty field',
                'any.required': 'country_code is a required field'
            }),
            mobile: Joi.string()
                .regex(/^[0-9]*$/)
                .required()
                .messages({
                    'string.base': 'mobile should be a type of Number',
                    'string.empty': 'mobile cannot be an empty field',
                    'any.required': 'mobile is a required field'
                }),

            timezone: Joi.string(),

            city: Joi.string()
                .regex(/^[a-zA-Z ]*$/, 'Characters only allowed in city name')
                .required()
                .messages({
                    'string.comments': 'City name should be a type of text',
                    'string.empty': 'City name cannot be an empty field',
                    'any.required': 'City name is a required field'
                }),

            password: Joi.string().required().messages({
                'string.empty': 'password cannot be an empty field',
                'any.required': 'password is a required field'
            }),
            fcm_token: Joi.string()
        });

        const { kid_info, ...userDetails } = req.body;
        // get password from body and pass for validation
        const { value, error } = schema.validate(userDetails);

        if (error) {
            return res.status(403).json({ status: 'error', message: error.message });
        }

        // check email already exists
        let existingEmail = await Users.findOne({
            where: { email: value.email }
        });

        if (existingEmail) {
            return res.status(400).json({
                status: 'error',
                message: 'Email already exists'
            });
        }

        // check mobile no already exists
        let existingMobile = await Users.findOne({
            where: { mobile: value.mobile }
        });

        if (existingMobile) {
            return res.status(400).json({
                status: 'error',
                message: 'Mobile number already exists'
            });
        }

        // Generate a 5-digit OTP with numeric characters
        const OTP = await generateOTP();

        // send otp on email
        await sendEmail(value.email, 'Email Verification', `Your email verification code is : ${OTP}`);

        // convert plain password to hashed password
        let hashedPassword = await securePassword(value.password);

        // store a new data
        let newUser = await Users.create({ ...value, password: hashedPassword });

        if (kid_info?.length > 0) {
            await Users.update(
                { is_parent: 1 },
                {
                    where: {
                        id: newUser.id
                    }
                }
            );

            for (let [index, kid] of kid_info.entries()) {
                let kid_email = newUser.email.indexOf('@');
                let kid_name = kid['kidName' + (index + 1)];
                let kid_pass = kid['password' + (index + 1)];
                let hashedPassword = await securePassword(kid_pass);

                let kid_data = {
                    full_name: kid_name,
                    password: hashedPassword,
                    email: newUser.email.slice(0, kid_email) + '+' + kid_name + newUser.email.slice(kid_email),
                    city: newUser.city,
                    country_code: newUser.country_code,
                    mobile: newUser.mobile + '+' + kid_name,
                    fcm_token: newUser.fcm_token,
                    timezone: newUser.timezone,
                    guardian: newUser.id,
                    role_name: 'user',
                    role_id: 1,
                    status: newUser.status,
                    access_content: newUser.access_content,
                    affiliate: newUser.affiliate,
                    // created_at: newUser.created_at,
                    language: newUser.language,
                    notification_channels: '["email","whatsapp","inapp"]'
                };

                await Users.create(kid_data);
            }
        }

        // get otp and insert into otp collection
        await Verifications.create({
            user_id: newUser.id,
            mobile: value.mobile,
            email: value.email,
            code: OTP
        });

        // generate token
        const token = generateToken(newUser.id);

        // response
        res.status(200).json({
            status: 'success',
            message: 'Verification OTP sent on your email id',
            token: token,
            data: newUser
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Aisensy notification sender
async function sendAisensyNotification(userDetails, template, options) {
    try {
        const apiKey = process.env.AISENSY_API_KEY;
        const campaignName = `${template}_${userDetails.language || 'EN'}`;
        const destination = userDetails.country_code + userDetails.mobile.trim();
        const userName = userDetails.full_name;

        const payload = {
            apiKey: apiKey,
            campaignName: campaignName,
            destination: destination,
            userName: userName,
            templateParams: [options],
            source: 'Registration OTP',
            media: {},
            buttons: [
                {
                    type: 'button',
                    sub_type: 'url',
                    index: 0,
                    parameters: [
                        {
                            type: 'text',
                            text: options
                        }
                    ]
                }
            ],
            carouselCards: [],
            location: {},
            paramsFallbackValue: {
                FirstName: userName
            }
        };
        const response = await axios({
            method: 'post',
            url: 'https://backend.aisensy.com/campaign/t1/api/v2',
            data: payload,
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 15000 // 15 second timeout
        });

        if (response.status >= 200 && response.status < 300) {
            return { success: true, data: response.data };
        } else {
            return { success: false, error: response.data };
        }
    } catch (error) {
        // console.error('Detailed Aisensy Error:', error.response?.data || error.message);
        return { success: false, error: error.response?.data || error.message };
    }
}

// Helper function to send WhatsApp message
async function sendAisensyWhatsappMessage(userDetails, message, template = 'tulkka_registration') {
    try {
        const result = await sendAisensyNotification(userDetails, template, message);
        return result.success;
    } catch (error) {
        console.error('Aisensy WhatsApp Error:', error);
        return false;
    }
}

async function registerStudentV2(req, res) {
    try {
        //validation using joi
        const schema = Joi.object().keys({
            full_name: Joi.string().required().messages({
                'string.comments': 'Full name should be a type of text',
                'string.empty': 'Full name cannot be an empty field',
                'any.required': 'Full name is a required field'
            }),
            email: Joi.string().email().required().messages({
                'string.empty': 'email cannot be an empty field',
                'any.required': 'email is a required field'
            }),
            country_code: Joi.string().required().messages({
                'string.empty': 'country_code cannot be an empty field',
                'any.required': 'country_code is a required field'
            }),
            mobile: Joi.string()
                .regex(/^[0-9]*$/)
                .required()
                .messages({
                    'string.base': 'mobile should be a type of Number',
                    'string.empty': 'mobile cannot be an empty field',
                    'any.required': 'mobile is a required field'
                }),
            timezone: Joi.string(),
            city: Joi.string().required().messages({
                'string.comments': 'City name should be a type of text',
                'string.empty': 'City name cannot be an empty field',
                'any.required': 'City name is a required field'
            }),
            password: Joi.string().required().messages({
                'string.empty': 'password cannot be an empty field',
                'any.required': 'password is a required field'
            }),
            date_of_birth: Joi.date().allow(null),
            native_language: Joi.string().allow(null, ''),
            fcm_token: Joi.string(),
            invite_code: Joi.string().allow(null, ''),
            attribution: Joi.object().allow(null),
            deviceInfo: Joi.object().allow(null)
        });

        console.log('req.body',req.body);
        
        const { kid_info, invite_code, invte_code, attribution, deviceInfo, ...userDetails } = req.body;
        const normalizedInviteCode = invite_code ?? invte_code ?? '';
        const { value, error } = schema.validate({
            ...userDetails,
            invite_code: normalizedInviteCode,
            attribution,
            deviceInfo
        });

        if (error) {
            return res.status(403).json({ status: 'error', message: error.message });
        }

        // Check for existing email
        let existingUser = await Users.findOne({
            where: { email: value.email }
        });

        // Check for existing mobile
        let existingMobile = await Users.findOne({
            where: { mobile: value.mobile }
        });

        // If email exists and status is not pending, return error
        if (existingUser && existingUser.dataValues.status !== 'pending') {
            return res.status(400).json({
                status: 'error',
                message: 'Email already exists'
            });
        }

        // If mobile exists and status is not pending, return error
        if (existingMobile && existingMobile.dataValues.status !== 'pending') {
            return res.status(400).json({
                status: 'error',
                message: 'Mobile number already exists'
            });
        }

        // Handle Referral Invite Code
        let invite_by = null;
        let validInviteCode = null;

        if (value.invite_code && value.invite_code.trim() !== '') {
            // Find the referral link by invite code
            const referralLink = await ReferralLink.findOne({
                where: { 
                    invite_code: value.invite_code.trim().toUpperCase(),
                    is_active: true 
                }
            });

            if (referralLink) {
                invite_by = referralLink.user_id;
                validInviteCode = value.invite_code.trim().toUpperCase();
                console.log(`Valid invite code found: ${validInviteCode} from user ${invite_by}`);
            }
        }

        // Generate a 5-digit OTP
        const OTP = await generateOTP();

        // Send WhatsApp message
        const messageSent = await sendAisensyWhatsappMessage(value, OTP);

        try {
            await sendEmail(value.email, 'Tulkka Registration OTP', `${OTP} is your verification code.`);
        } catch (e) {
            console.error('Email send error:', e);
        }

        if (!messageSent) {
            return res.status(401).json({
                status: 'errorMobile',
                message: 'Failed to send WhatsApp message. Please check your mobile number.'
            });
        }

        let hashedPassword = await securePassword(value.password);
        let user;
        if (value.date_of_birth) {
            value.date_of_birth = new Date(value.date_of_birth);
        }

        // Prepare user data with referral information
        const userData = {
            ...value,
            password: hashedPassword,
            invite_code: validInviteCode,
            invite_by: invite_by,
            attribution: attribution || null,
            device_info: deviceInfo || null
        };

        // If user exists with pending status, update the record
        if (existingUser && existingUser.dataValues.status === 'pending') {
            await Users.update(userData, { where: { id: existingUser.id } });
            user = await Users.findOne({ where: { id: existingUser.id } });

            // Delete any existing verification records
            await Verifications.destroy({
                where: { user_id: existingUser.id }
            });
        } else {
            // Create new user if no pending record exists
            user = await Users.create(userData);
        }

        // Create Referral Record if invite code was valid
        if (validInviteCode && invite_by) {
            try {
                // Check if user is not referring themselves
                if (invite_by !== user.id) {
                    // Get referrer's current referral count to determine tier
                    const referrerReferrals = await Referral.count({
                        where: { 
                            referrer_id: invite_by,
                            status: { [Op.in]: ['validated', 'rewarded'] }
                        }
                    });

                    // Get applicable tier (you'll need to import ReferralTier at the top)
                    const tier = await ReferralTier.findOne({
                        where: {
                            min_referrals: { [Op.lte]: referrerReferrals },
                            max_referrals: { [Op.gte]: referrerReferrals },
                            is_active: true
                        },
                        order: [['tier_level', 'ASC']]
                    });

                    if (tier) {
                        // Create referral record with pending status
                        await Referral.create({
                            referrer_id: invite_by,
                            referee_id: user.id,
                            invite_code: validInviteCode,
                            status: 'pending',
                            tier_at_signup: tier ? tier.tier_level : null,
                            created_at: Math.floor(Date.now() / 1000)
                        });
                        //Increment free classes for both referrer and referee 
                        await incrementFreeClass(invite_by, user.id);

                        console.log(`Referral record created: User ${user.id} referred by ${invite_by}`);
                    } else {
                        console.log('No active tier found for referral');
                    }
                } else {
                    console.log('User tried to use their own referral code - skipping referral creation');
                }
            } catch (referralError) {
                console.error('Error creating referral record:', referralError);
            }
        }

        // Handle kid_info
        if (kid_info?.length > 0) {
            await Users.update(
                { is_parent: 1 },
                {
                    where: {
                        id: user.id
                    }
                }
            );

            // Delete existing kids if updating
            if (existingUser) {
                await Users.destroy({
                    where: { guardian: user.id }
                });
            }

            for (let [index, kid] of kid_info.entries()) {
                let kid_email = user.email.indexOf('@');
                let kid_name = kid['kidName' + (index + 1)];
                let kid_pass = kid['password' + (index + 1)];
                let kid_dob = kid['date_of_birth' + (index + 1)] || null;
                let hashedPassword = await securePassword(kid_pass);

                let kid_data = {
                    full_name: kid_name,
                    password: hashedPassword,
                    email: user.email.slice(0, kid_email) + '+' + kid_name + user.email.slice(kid_email),
                    city: user.city,
                    country_code: user.country_code,
                    mobile: user.mobile + '+' + kid_name,
                    fcm_token: user.fcm_token,
                    timezone: user.timezone,
                    guardian: user.id,
                    role_name: 'user',
                    role_id: 1,
                    status: user.status,
                    access_content: user.access_content,
                    affiliate: user.affiliate,
                    language: user.language,
                    native_language: user.native_language,
                    date_of_birth: kid_dob,
                    notification_channels: '["email","whatsapp","inapp"]',
                    invite_code: validInviteCode,
                    invite_by: invite_by,
                    attribution: attribution || null
                };

                let kidUser = await Users.create(kid_data);

                // Ensure kidUser has an id before proceeding
                if (!kidUser || !kidUser.id) {
                    console.error('Kid user creation failed - no ID returned');
                    continue; // Skip to next kid
                }

                if (validInviteCode && invite_by && invite_by !== kidUser.id) {
                    try {
                        // Fetch tier for each kid referral
                        const referrerReferrals = await Referral.count({
                            where: {
                                referrer_id: invite_by,
                                status: { [Op.in]: ['validated', 'rewarded'] }
                            }
                        });

                        const kidTier = await ReferralTier.findOne({
                            where: {
                                min_referrals: { [Op.lte]: referrerReferrals },
                                max_referrals: { [Op.gte]: referrerReferrals },
                                is_active: true
                            },
                            order: [['tier_level', 'ASC']]
                        });

                        // Create referral record with proper tier
                        await Referral.create({
                            referrer_id: invite_by,
                            referee_id: kidUser.id,
                            invite_code: validInviteCode,
                            status: 'pending',
                            tier_at_signup: kidTier ? kidTier.tier_level : null,
                            created_at: Math.floor(Date.now() / 1000)
                        });

                        // Increment free classes
                        await incrementFreeClass(invite_by, kidUser.id);

                        console.log(`Referral + FreeClass created for kid ${kidUser.id} (tier: ${kidTier ? kidTier.tier_level : 'none'})`);
                    } catch (err) {
                        console.error('Error creating kid referral:', err.message);
                    }
                }
            }
        }

        // Create new verification record
        await Verifications.create({
            user_id: user.id,
            mobile: value.mobile,
            email: value.email,
            code: OTP
        });

        // Generate token
        const token = generateToken(user.id);

        // Response
        res.status(200).json({
            status: 'success',
            message: 'Verification OTP sent on your email id',
            token: token,
            data: user
        });
    } catch (err) {
        console.error('registerStudentV2 error:', err);
        const details = err?.errors?.map((e) => e.message).join(', ');
        return res.status(500).json({
            status: 'error',
            message: details || err.message
        });
    }
}
async function registerKid(req, res) {
    try {
        const user_id = req.userId;

        if (!user_id) {
            return res.status(401).json({
                status: 'error',
                message: 'User ID not found in request. Please login again.'
            });
        }

        const schema = Joi.object().keys({
            child_name: Joi.string().required().messages({
                'string.empty': 'Child name cannot be an empty field',
                'any.required': 'Child name is a required field'
            }),
            date_of_birth: Joi.date().required().messages({
                'date.base': 'Date of birth must be a valid date',
                'any.required': 'Date of birth is a required field'
            }),
            gender: Joi.string().valid('Boy', 'Girl', 'male', 'female').required().messages({
                'any.only': 'Gender must be either Boy or Girl',
                'any.required': 'Gender is a required field'
            }),
            password: Joi.string().required().messages({
                'string.empty': 'password cannot be an empty field',
                'any.required': 'password is a required field'
            }),
            native_language: Joi.string().allow(null, ''),
        });

        const { value, error } = schema.validate(req.body);

        if (error) {
            return res.status(403).json({ 
                status: 'error', 
                message: error.message 
            });
        }

        // Check if guardian exists and get guardian details
        const guardian = await Users.findOne({
            where: { 
                id: user_id,
                role_name: 'user'
            }
        });

        if (!guardian) {
            return res.status(404).json({
                status: 'error',
                message: 'Parent/Guardian not found'
            });
        }

        await Users.update(
            { is_parent: 1 },
            { where: { id: guardian.id } }
        );
        
        // Encrypt password using bcrypt (via securePassword helper)

        const hashedPassword = await securePassword(value.password);

        // Generate unique email and mobile for kid
        const kid_email_index = guardian.email.indexOf('@');
        const kidName = value.child_name.replace(/\s+/g, '');
        const kidEmail = guardian.email.slice(0, kid_email_index) + '+' + kidName + guardian.email.slice(kid_email_index);
        const kidMobile = guardian.mobile + '+' + kidName;

        // Normalize gender value (Boy/Girl → male/female)
        const normalizedGender = value.gender.toLowerCase() === 'boy' || value.gender.toLowerCase() === 'male' 
            ? 'male' 
            : 'female';

        // Prepare kid data
        const kid_data = {
            full_name: value.child_name,
            password: hashedPassword, // Encrypted password stored
            email: kidEmail,
            city: guardian.city,
            country_code: guardian.country_code,
            mobile: kidMobile,
            fcm_token: guardian.fcm_token,
            timezone: guardian.timezone,
            guardian: guardian.id,
            role_name: 'user',
            role_id: 1,
            status: guardian.status || 'active',
            access_content: guardian.access_content,
            affiliate: guardian.affiliate,
            language: 'HE', // Default to Hebrew for all kids
            native_language: value.native_language || guardian.native_language || null,
            date_of_birth: new Date(value.date_of_birth),
            gender: normalizedGender,
            notification_channels: '["email","whatsapp","inapp"]',
            lesson_notifications: '["24","1"]',
            invite_code: guardian.invite_code || null,
            invite_by: guardian.invite_by || null,
            attribution: guardian.attribution || null,
            device_info: guardian.device_info || null,
            verified: 1 // Auto-verify kid accounts
        };

        // Create kid user
        const kidUser = await Users.create(kid_data);

        if (!kidUser || !kidUser.id) {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to create child account'
            });
        }

        // Handle referral if guardian has invite_code and invite_by
        if (guardian.invite_code && guardian.invite_by && guardian.invite_by !== kidUser.id) {
            try {
                // Get referrer's current referral count to determine tier
                const referrerReferrals = await Referral.count({
                    where: {
                        referrer_id: guardian.invite_by,
                        status: { [Op.in]: ['validated', 'rewarded'] }
                    }
                });

                // Get applicable tier
                const kidTier = await ReferralTier.findOne({
                    where: {
                        min_referrals: { [Op.lte]: referrerReferrals },
                        max_referrals: { [Op.gte]: referrerReferrals },
                        is_active: true
                    },
                    order: [['tier_level', 'ASC']]
                });

                if (kidTier) {
                    // Create referral record with proper tier
                    await Referral.create({
                        referrer_id: guardian.invite_by,
                        referee_id: kidUser.id,
                        invite_code: guardian.invite_code,
                        status: 'pending',
                        tier_at_signup: kidTier.tier_level,
                        created_at: Math.floor(Date.now() / 1000)
                    });

                    // Increment free classes
                    await incrementFreeClass(guardian.invite_by, kidUser.id);

                    console.log(`Referral + FreeClass created for kid ${kidUser.id} (tier: ${kidTier.tier_level})`);
                }
            } catch (referralError) {
                console.error('Error creating kid referral:', referralError.message);
                // Don't fail the registration if referral fails
            }
        }

        const token = generateToken(kidUser.id);

        // Return success response with ALL kid data (no credentials)
        return res.status(201).json({
            status: 'success',
            message: 'Child account created successfully',
            token: token,
            data: {
                id: kidUser.id,
                full_name: kidUser.full_name,
                email: kidUser.email,
                mobile: kidUser.mobile,
                guardian: kidUser.guardian,
                role_name: kidUser.role_name,
                role_id: kidUser.role_id,
                date_of_birth: kidUser.date_of_birth,
                gender: kidUser.gender,
                city: kidUser.city,
                country_code: kidUser.country_code,
                timezone: kidUser.timezone,
                language: kidUser.language,
                native_language: kidUser.native_language,
                status: kidUser.status,
                verified: kidUser.verified,
                fcm_token: kidUser.fcm_token,
                access_content: kidUser.access_content,
                affiliate: kidUser.affiliate,
                notification_channels: kidUser.notification_channels,
                lesson_notifications: kidUser.lesson_notifications,
                invite_code: kidUser.invite_code,
                invite_by: kidUser.invite_by,
                attribution: kidUser.attribution,
                device_info: kidUser.device_info,
                created_at: kidUser.createdAt,
                updated_at: kidUser.updatedAt
            }
            // NO credentials object - password not returned
        });

    } catch (err) {
        console.error('Kid registration error:', err);
        return res.status(500).json({
            status: 'error',
            message: err.message || 'Internal server error'
        });
    }
}

// verify account
async function verifyAccount(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        let { otp } = req.body;

        // let isMatch = await Verifications.findOne({ where: { user_id: user.id, code: otp } });
        let isMatch = await Verifications.findOne({ where: { user_id: user.id, mobile: user.mobile, email: user.email, code: req.body.otp } });
        if (!isMatch) {
            return res.status(401).json({
                status: 'error',
                message: 'Please enter valid OTP'
            });
        }

        let kid_user = await Users.findAll({ where: { guardian: user.id } });

        await Users.update(
            { status: 'active' },
            {
                where: {
                    id: user.id,
                    email: user.email
                }
            }
        );

        // // const currentDate = new Date().getTime();
        // const currentDate = Math.floor(Date.now() / 1000);

        // await Verifications.update(
        //     { verified_at: currentDate },
        //     {
        //         where: {
        //             user_id: user.id,
        //             email: user.email
        //         },
        //     }
        // );

        // delete record from verification table after otp verified
        await Verifications.destroy({
            where: {
                user_id: user.id,
                mobile: user.mobile,
                email: user.email,
                code: otp
            }
        });

        // generate token
        const token = generateToken(user.id);

        // response
        res.status(200).json({
            status: 'success',
            message: 'Your account has been activated',
            token: token,
            data: user
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Update profile
async function updateProfile(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        //validation using joi
        const schema = Joi.object().keys({
            full_name: Joi.string()
                // .regex(/^[a-zA-Z0-9 ]*$/, 'Characters only allowed in full_name')
                .messages({
                    'string.comments': 'Full name should be a type of text',
                    'string.empty': 'Full name cannot be an empty field',
                    'any.required': 'Full name is a required field'
                }),

            country_code: Joi.string().messages({
                'string.empty': 'country_code cannot be an empty field',
                'any.required': 'country_code is a required field'
            }),
            mobile: Joi.string()
                .regex(/^[0-9]*$/)
                .messages({
                    'string.base': 'mobile should be a type of Number',
                    'string.empty': 'mobile cannot be an empty field',
                    'any.required': 'mobile is a required field'
                }),

            timezone: Joi.string(),
            date_of_birth: Joi.date().allow(null),
            native_language: Joi.string().allow(null, ''),
            // profile_image: Joi.string(),

            city: Joi.string()
                // .regex(/^[a-zA-Z ]*$/, 'Characters only allowed in city name')
                .messages({
                    'string.comments': 'City name should be a type of text',
                    'string.empty': 'City name cannot be an empty field',
                    'any.required': 'City name is a required field'
                })
        });

        // get password from body and pass for validation
        const { value, error } = schema.validate(req.body);

        if (error) {
            return res.status(403).json({ status: 'error', message: error.message });
        }

        /**
         * TODO: Email id can't change...
         */
        // check email already exists
        /* if (value.email) {
            if (value.email !== user.email) {
                const existingEmailUser = await Users.findOne({
                    where: { email: value.email },
                });
    
                if (existingEmailUser) {
                    return res.status(400).json({
                        status: "error",
                        message: "Email already exists",
                    });
                }
            }
        } */
        const existingFullName = await Users.findOne({
            where: { full_name: value.full_name, guardian: user.guardian }
        });

        if (existingFullName && existingFullName?.full_name !== value.full_name) {
            return res.status(400).json({
                status: 'error',
                message: 'Full name is already exists'
            });
        }

        // check mobile no already exists

        if (value.mobile) {
            if (value.mobile !== user.mobile) {
                const existingMobileUser = await Users.findOne({
                    where: { mobile: value.mobile }
                });

                if (existingMobileUser) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Mobile already exists'
                    });
                }
            }
        }

        // Optionally update the avatar
        if (req.file) {
            value.avatar = '/avatar/' + req.file.originalname; // src="/store/1/default_images/testimonials/profile_picture (30).jpg"  Mayur
        }

        if (value.full_name !== user.full_name) {
            if (user.guardian) {
                email = user.email.replace(/\+[^@]+/, '');
                mobile = user.mobile.replace(/\+[^+]+$/, '');

                let kid_email = email.indexOf('@');
                value.email = email.slice(0, kid_email) + '+' + value.full_name + email.slice(kid_email);
                value.mobile = mobile + '+' + value.full_name;
            }
        }
        // Update the user profile
        await Users.update({ ...value }, { where: { id: user.id } });

        const updatedUserData = await Users.findOne({ where: { id: user.id } });

        // response
        res.status(200).json({
            status: 'success',
            message: 'Profile updated successfully',
            data: updatedUserData
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// login student
async function loginStudent(req, res) {
    try {
        let { email, password, fcm_token } = req.body;

        // check if email exists or not
        let user = await Users.findOne({ where: { email } });
        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid credentials'
            });
        }

        // check status is active or not
        user = await Users.findOne({ where: { email } });

        if (user.status == 'pending' || user.status == 'inactive') {
            // delete record from verification table after otp verified
            await Verifications.destroy({
                where: {
                    user_id: user.id,
                    mobile: user.mobile,
                    email: user.email
                }
            });

            const OTP = await generateOTP();

            // send otp on email
            await sendEmail(user.email, 'Email Verification', `Your email verification code is : ${OTP}`);

            // get otp and insert into otp collection
            await Verifications.create({
                user_id: user.id,
                mobile: user.mobile,
                email: user.email,
                code: OTP
            });
        }
        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'Please activate your account'
            });
        }
        // convert plain password to hashed password
        let hashPassword = user.password;
        hashPassword = hashPassword.replace(/^\$2y(.+)$/i, '$2a$1');

        // Compare the provided password with the hashed password in the database
        let isMatch = await bcrypt.compare(password, hashPassword);

        if (!isMatch) {
            return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
        }

        // generate token
        const token = generateToken(user.id);

        await Users.update({ fcm_token }, { where: { email } });

        await Users.findOne({ fcm_token }, { where: { email } });

        // response
        res.status(200).json({
            status: 'success',
            message: 'Login successful',
            token: token,
            data: user
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function loginStudentV2(req, res) {
    try {
        let { email, password, fcm_token, deviceInfo } = req.body;

        email = email.toLowerCase();

        // check if email exists or not
        let user = await Users.findOne({ where: { email } });

        if (!user) {
            // Log the failed login attempt - Invalid email
            await FailedLoginAttempts.create({
                email,
                password, // Don't store the actual password for security reasons
                failure_reason: 'invalid_credentials',
                additional_info: 'Email not found'
            });

            return res.status(200).json({
                status: 'error',
                message: 'Invalid credentials'
            });
        }

        // check status is active or not
        user = await Users.findOne({ where: { email } });

        if (user.status == 'pending' || user.status == 'inactive') {
            // Log the failed login attempt - Inactive account
            await FailedLoginAttempts.create({
                email,
                password, // Don't store the actual password for security reasons
                failure_reason: 'inactive_account',
                additional_info: `Account status: ${user.status}`
            });

            // delete record from verification table after otp verified
            await Verifications.destroy({
                where: {
                    user_id: user.id,
                    mobile: user.mobile,
                    email: user.email
                }
            });

            const OTP = await generateOTP();

            // send otp on email
            // await sendEmail(user.email, 'Email Verification', `Your email verification code is : ${OTP}`);
            // var message =
            //     'Thank you for choosing Tulkka! To ensure the security of your account, please use the following One Time Password (OTP) for verification: \n' +
            //     OTP +
            //     '\nThis OTP is valid for a limited time only. If you did not request this code, please ignore this message.';

            var message = OTP;

            const messageSent = await sendAisensyWhatsappMessage(user, message);

            if (!messageSent) {
                return res.status(401).json({
                    status: 'errorMobile',
                    message: 'Failed to send WhatsApp message. Please check your mobile number.'
                });
            }

            // const client = twilio(config.TWILIO_SID, config.TWILIO_AUTH_TOKEN);

            // // Assuming you have configured Twilio with your credentials
            // const twilio_number = config.TWILIO_WHATSAPP_FROM;
            // let userMobile = user.mobile;
            // try {
            //     await client.messages.create({
            //         from: `${twilio_number}`,

            //         to: `${user.country_code}${userMobile}`,

            //         body: message
            //     });
            // } catch (error) {
            //     console.error('Error sending message:', error);

            //     return false; // Failed to send notification
            // }

            // get otp and insert into otp collection
            await Verifications.create({
                user_id: user.id,
                mobile: user.mobile,
                email: user.email,
                code: OTP
            });
        }
        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'Please activate your account'
            });
        }
        // convert plain password to hashed password
        let hashPassword = user.password;
        hashPassword = hashPassword.replace(/^\$2y(.+)$/i, '$2a$1');

        // Compare the provided password with the hashed password in the database
        let isMatch = await bcrypt.compare(password, hashPassword);
        if (!isMatch) {
            // Log the failed login attempt - Wrong password
            await FailedLoginAttempts.create({
                email,
                password, // Don't store the actual password for security reasons
                failure_reason: 'invalid_credentials',
                additional_info: 'Incorrect password'
            });

            return res.status(200).json({ status: 'error', message: 'Invalid credentials' });
        }

        let fcmTokens = [];

        if (user && user.fcm_token) {
            try {
                // Parse the string into an array
                fcmTokens = JSON.parse(user.fcm_token);
            } catch (error) {
                fcmTokens = [user.fcm_token];
            }
        }

        // Add the new FCM token to the array
        if (!fcmTokens.includes(fcm_token)) {
            fcmTokens.push(fcm_token);
        }

        // Convert the array of FCM tokens back to a JSON string
        let updatedFcmToken = JSON.stringify(fcmTokens);

        // Prepare update data
        const updateData = {
            fcm_token: updatedFcmToken
        };

        // Update deviceInfo if provided
        if (deviceInfo) {
            updateData.device_info = JSON.stringify(deviceInfo);
        }

        // Update the user's record in the database with the updated FCM tokens and deviceInfo
        await Users.update(updateData, { where: { email } });

        // Check if user has kids to determine switchable status
        const kidCount = await Users.count({
            where: {
                guardian: user.id
            }
        });

        const switchable = kidCount > 0;

        // generate token
        const token = generateToken(user.id);

        // await Users.update({ fcm_token }, { where: { email } });

        // await Users.findOne({ fcm_token }, { where: { email } });

        // response
        res.status(200).json({
            status: 'success',
            message: 'Login successful',
            token: token,
            data: user,
            switchable: switchable
        });
    } catch (err) {
        console.log('Error :', err || err.message);

        // Log any unexpected errors during login
        try {
            const email = req.body?.email?.toLowerCase() || null;

            await FailedLoginAttempts.create({
                email,
                failure_reason: 'other',
                additional_info: `Server error: ${err.message}`
            });
        } catch (logError) {
            console.error('Failed to log login error:', logError);
        }

        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

//Forgot password
async function forgotPassword(req, res) {
    try {
        const schema = Joi.object().keys({
            email: Joi.string().email().required().messages({
                'string.empty': 'email cannot be an empty field',
                'any.required': 'email is a required field'
            }),
            mobile: Joi.string().allow('').optional() // This allows mobile to be optional
        });

        let findEmailUsingMobile = false;
        const { value, error } = schema.validate(req.body);
        if (error) {
            return res.status(403).json({ status: 'error', message: error.message || error });
        }

        // First try to find user by email
        let user = await Users.findOne({ where: { email: value.email } });
        // If user not found by email and mobile number exists, try finding by mobile
        if (!user && value.mobile !== undefined && value.mobile !== '') {
            user = await Users.findOne({ where: { mobile: value.mobile } });
            findEmailUsingMobile = true;
            // If still no user found, return error
            if (!user) {
                findEmailUsingMobile = false;
                return res.status(200).json({
                    status: 'error',
                    message: 'User does not exist with provided email or mobile number',
                    code: 'emailWithPhone'
                });
            }
        } else {
            if (!user) {
                return res.status(200).json({
                    status: 'error',
                    message: 'Email does not exists',
                    code: 'firstEmail'
                });
            }
        }

        // generate token
        const token = generateToken(user.id);

        // Generate a 5-digit OTP with numeric characters
        const OTP = await generateOTP();

        // send reset password link on email
        await sendEmail(user.email, 'Forgot Password', `Your OTP is : ${OTP}`);

        // get otp and insert into otp collection
        await Verifications.create({
            user_id: user.id,
            mobile: user.mobile,
            email: user.email,
            code: OTP
        });

        // Mask the email address
        const maskEmail = (email) => {
            const [name, domain] = email.split('@');
            const maskedName = name.charAt(0) + '*'.repeat(name.length - 1);
            return `${maskedName}@${domain}`;
        };

        if (findEmailUsingMobile) {
            res.status(200).json({
                status: 'success',
                message: 'OTP sent successfully in your email address',
                token: token,
                email: user.email,
                maskEmail: maskEmail(user.email)
            });
        } else {
            res.status(200).json({
                status: 'success',
                message: 'OTP sent successfully in your email address',
                token: token,
                email: '',
                maskEmail: ''
            });
        }
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: error.message || error
        });
    }
}

// verify otp
async function verifyOTP(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        let { otp } = req.body;
        let isMatch = await Verifications.findOne({ where: { user_id: user.id, mobile: user.mobile, email: user.email, code: req.body.otp } });

        if (!isMatch) {
            return res.status(401).json({
                status: 'error',
                message: 'Please enter valid OTP'
            });
        }

        await Users.update(
            { status: 'active' },
            {
                where: {
                    guardian: user.id
                }
            }
        );

        await Users.update(
            { status: 'active' },
            {
                where: {
                    id: user.id,
                    email: user.email
                }
            }
        );

        // delete record from verification table after otp verified
        await Verifications.destroy({
            where: {
                user_id: user.id,
                mobile: user.mobile,
                email: user.email,
                code: otp
            }
        });

        // generate token
        const token = generateToken(user.id);

        // response
        res.status(200).json({
            status: 'success',
            message: 'OTP verified successfully',
            token: token
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

//reset otp
async function resendOTP(req, res) {
    try {
        const { email } = req.body;

        let user = await Users.findOne({ where: { email: email } });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // Generate a 5-digit OTP with numeric characters
        const OTP = await generateOTP();

        // send reset password link on email
        await sendEmail(user.email, 'resend otp', `Your OTP is : ${OTP}`);

        const [verification, created] = await Verifications.findOrCreate({
            where: {
                user_id: user.id,
                mobile: user.mobile,
                email: user.email
            },
            defaults: {
                code: OTP // The default values to use when creating a new record
            }
        });

        if (!created) {
            // Record already existed and was updated
            await verification.update({ code: OTP });
        }

        // generate token
        const token = generateToken(user.id);

        res.status(200).json({
            status: 'success',
            message: 'OTP sent successfully in your email address',
            token: token
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// reset password
async function resetPassword(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        let { password } = req.body;

        // convert plain password to hashed password
        let hashedPassword = await securePassword(password);

        // store a new data
        await Users.update({ password: hashedPassword }, { where: { id: user.id } });

        // generate token
        const token = generateToken(user.id);

        // response
        res.status(200).json({
            status: 'success',
            message: 'Password changed successfully',
            token: token
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Get users by email
async function getUserByEmail(req, res) {
    try {
        const { email } = req.body;

        let user = await Users.findOne({ where: { email: email } });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // let kidsAccounts = [];
        let username = email.split('@')[0];

        // Find kids accounts
        let kidsAccounts = await Users.findAll({
            where: { 
                guardian: user.id,
                email: { [Sequelize.Op.like]: `${username}%` },
                status: 'active'
            }
        });

        // Format user + kids
        let data = [
            {
                user_id: user.id,
                full_name: user.full_name,
                type: 'parent'
            },
            ...kidsAccounts.map((kidsAccount) => ({
                user_id: kidsAccount.id,
                full_name: kidsAccount.full_name,
                type: 'kid'
            }))
        ];

        return res.status(200).json({ 
            status: 'success', 
            message: 'Users found', 
            data 
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Get kids from parent
async function getKidFromParent(req, res) {
    try {
        let user = await Users.findAll({
            attributes: ['id', 'full_name', 'mobile', 'email', 'status', 'avatar', 'fcm_token', 'subscription_type', 'subscription_id'],
            where: { guardian: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // Kid subscription data start

        // let response = [];

        // for (const kidData of user) {
        //     let subscribedUser = null;
        //     // Check if the user has a subscription type
        //     if (kidData.subscription_type != null) {
        //         // Find the latest subscription details for the user
        //         subscribedUser = await UserSubscriptionDetails.findOne({
        //             where: {
        //                 user_id: kidData.id
        //             },
        //             order: [['created_at', 'DESC']], // Assuming you want to get the latest subscription
        //             limit: 1
        //         });
        //     }

        //     // Add user data along with remaining classes and subscribed user (if any) to the response array
        //     response.push({
        //         kidData,
        //         subscribedUser
        //     });
        // }

        // return res.status(200).json({ status: 'success', data: JSON.stringify(response) });
        // Kid subscription data end

        return res.status(200).json({ status: 'success', data: user });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}
// Switch Kids Assignment Function
async function switchKidsAssignment(req, res) {
    try {
        const { guardianId } = req.body;
        const loginUserId = req.userId;

        // Validate input
        if (!guardianId) {
            return res.status(400).json({
                status: 'error',
                message: 'Guardian ID is required'
            });
        }

        // Convert guardianId to number if it's passed as string
        const guardianIdNum = parseInt(guardianId, 10);

        // Get all kids assigned to the guardian except the login user
        const assignedKids = await Users.findAll({
            attributes: ['id', 'full_name', 'mobile', 'email', 'status', 'avatar', 'fcm_token', 'subscription_type', 'subscription_id'],
            where: {
                guardian: guardianIdNum,
                id: {
                    [Op.ne]: loginUserId
                }
            }
        });
        // Check if any kids were found
        if (!assignedKids || assignedKids.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No assigned kids found for this guardian'
            });
        }

        // Get subscription details for each kid

        return res.status(200).json({
            status: 'success',
            data: assignedKids
        });
    } catch (err) {
        console.error('Error in switchKidsAssignment:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
}

// Kid login
async function loginKid(req, res) {
    try {
        let { email, fcm_token } = req.body;

        // check if email exists or not
        let user = await Users.findOne({ where: { email } });

        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid credentials'
            });
        }

        // check status is active or not
        user = await Users.findOne({ where: { email } });

        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'Please activate your account'
            });
        }

        // generate token
        const token = generateToken(user.id);

        // await Users.update({ fcm_token }, { where: { email } });

        // await Users.findOne({ fcm_token }, { where: { email } });

        // response
        let kidCount = await Users.count({
            where: {
                guardian: user.guardian,
                id: {
                    [Op.ne]: user.id
                }
            }
        });
        res.status(200).json({
            status: 'success',
            message: 'Kid Login successful',
            token: token,
            data: user,
            count: kidCount
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Get All kids from parent
async function getAllKidFromParent(req, res) {
    try {
        let user = await Users.findOne({
            attributes: ['id', 'guardian'],
            where: { id: req.userId }
        });

        let allKid = await Users.findAll({
            attributes: ['id', 'full_name', 'mobile', 'email', 'guardian'],
            where: { guardian: user.guardian }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        return res.status(200).json({ status: 'success', data: allKid });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Logout API
async function logoutUser(req, res) {
    try {
        let user = await Users.findOne({
            attributes: ['id', 'email', 'fcm_token'],
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const { fcm_token: tokenToRemove } = req.body;

        if (!tokenToRemove) {
            return res.status(200).json({ status: 'success', message: 'FCM token not found but logout.' });
            // return res.status(400).json({ status: 'error', message: 'Invalid or empty token' });
        }

        let userFcmTokens;
        try {
            // Parse the string into an array if it's JSON
            userFcmTokens = JSON.parse(user.fcm_token);
        } catch (error) {
            // If it's not a JSON string, check if it's already an array
            if (Array.isArray(user.fcm_token)) {
                userFcmTokens = user.fcm_token;
            } else {
                // If it's neither JSON nor an array, assume it's a single FCM token
                userFcmTokens = user.fcm_token ? [user.fcm_token] : null;
            }
        }

        // Remove the token from the user's fcm_token array if it exists
        userFcmTokens = userFcmTokens?.filter((token) => token !== tokenToRemove);

        // Update the user's fcm_token in the database
        user.fcm_token = userFcmTokens?.length > 0 ? JSON.stringify(userFcmTokens) : null;
        await user.save();

        return res.status(200).json({ status: 'success', message: 'FCM token removed successfully' });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// send Otp To Mobile
async function sendOtpToMobile(req, res) {
    try {
        let { phoneNumber, countryCode } = req.body;

        let user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        let existingMobile = await Users.findOne({
            where: { mobile: phoneNumber }
        });

        if (existingMobile) {
            return res.status(402).json({
                status: 'error',
                message: 'Mobile number already exists'
            });
        }

        const OTP = await generateOTP();
        // var message =
        //     'Thank you for choosing Tulkka! To ensure the security of your account, please use the following One Time Password (OTP) for verification: \n' +
        //     OTP +
        //     '\nThis OTP is valid for a limited time only. If you did not request this code, please ignore this message.';

        var message = OTP;
        const userDetails = {
            country_code: countryCode,
            mobile: phoneNumber,
            full_name: user.full_name || '',
            language: user.language || 'EN'
        };

        const messageSent = await sendAisensyWhatsappMessage(userDetails, message);

        if (!messageSent) {
            return res.status(401).json({
                status: 'errorMobile',
                message: 'Failed to send WhatsApp message. Please check your mobile number.'
            });
        } else {
            try {
                await Verifications.create({
                    user_id: user.id,
                    mobile: phoneNumber,
                    email: user.email,
                    code: OTP
                });
            } catch (error) {
                console.error('Error creating verification record:', error);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to create verification record'
                });
            }
            return res.status(200).json({ status: 'success', message: 'OTP sent successfully' });
        }

        // const client = twilio(config.TWILIO_SID, config.TWILIO_AUTH_TOKEN);

        // Assuming you have configured Twilio with your credentials
        // const twilio_number = config.TWILIO_WHATSAPP_FROM;
        // let userMobile = phoneNumber;
        // try {
        //     await client.messages.create({
        //         from: `${twilio_number}`,

        //         to: `${countryCode}${userMobile}`,

        //         body: message
        //     });

        //     await Verifications.create({
        //         user_id: user.id,
        //         mobile: userMobile,
        //         email: user.email,
        //         code: OTP
        //     });
        // } catch (error) {
        //     console.error('Error sending message:', error);
        //     return res.status(401).json({
        //         status: 'errorMobile',
        //         message: 'Mobile number is invalid'
        //     });
        //     // return false; // Failed to send notification
        // }

        // return res.status(200).json({ status: 'success', message: 'OTP sent successfully' });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// verify Mobile otp
async function verifyMobileOTP(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        let { phoneNumber, otp, countryCode } = req.body;

        let isMatch = await Verifications.findOne({ where: { user_id: user.id, mobile: phoneNumber }, order: [['created_at', 'DESC']], limit: 1 });

        if (!isMatch || isMatch.code != otp) {
            return res.status(401).json({
                status: 'error',
                message: 'Please enter valid OTP'
            });
        }

        await Users.update(
            { mobile: phoneNumber, country_code: countryCode, status: 'active' },
            {
                where: {
                    id: user.id
                }
            }
        );

        let getKids = await Users.findAll({
            where: {
                guardian: user.id
            }
        });

        if (getKids?.length > 0) {
            for (let kid of getKids) {
                let kid_data = {
                    country_code: countryCode,
                    mobile: phoneNumber + '+' + kid.full_name
                };

                await Users.update({ country_code: kid_data.country_code, mobile: kid_data.mobile }, { where: { id: kid.id } });
            }
        }

        // delete record from verification table after otp verified
        await Verifications.destroy({
            where: {
                user_id: user.id,
                mobile: phoneNumber,
                email: user.email,
                code: otp
            }
        });

        // response
        res.status(200).json({
            status: 'success',
            message: 'OTP verified successfully'
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

//reset Mobile otp
async function resendMobileOTP(req, res) {
    try {
        let { phoneNumber, countryCode } = req.body;

        let user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const OTP = await generateOTP();
        // var message =
        //     'Thank you for choosing Tulkka! To ensure the security of your account, please use the following One Time Password (OTP) for verification: \n' +
        //     OTP +
        //     '\nThis OTP is valid for a limited time only. If you did not request this code, please ignore this message.';

        var message = OTP;

        const userDetails = {
            country_code: countryCode,
            mobile: phoneNumber,
            full_name: user.full_name || '',
            language: user.language || 'EN'
        };

        try {
            const messageSent = await sendAisensyWhatsappMessage(userDetails, OTP);
            if (!messageSent) {
                return res.status(401).json({
                    status: 'errorMobile',
                    message: 'Failed to send WhatsApp message. Please check your mobile number.'
                });
            }

            const [verification, created] = await Verifications.findOrCreate({
                where: {
                    user_id: user.id,
                    mobile: phoneNumber,
                    email: user.email
                },
                defaults: {
                    code: OTP
                },
                order: [['created_at', 'DESC']]
            });

            if (!created) {
                await verification.update({ code: OTP });
            }
        } catch (error) {
            console.error('Error sending message:', error);
            return res.status(401).json({
                status: 'errorMobile',
                message: 'Mobile number is invalid'
            });
        }

        // const client = twilio(config.TWILIO_SID, config.TWILIO_AUTH_TOKEN);

        // // Assuming you have configured Twilio with your credentials
        // const twilio_number = config.TWILIO_WHATSAPP_FROM;
        // let userMobile = phoneNumber;
        // try {
        //     await client.messages.create({
        //         from: `${twilio_number}`,

        //         to: `${countryCode}${userMobile}`,

        //         body: message
        //     });

        //     const [verification, created] = await Verifications.findOrCreate({
        //         where: {
        //             user_id: user.id,
        //             mobile: phoneNumber,
        //             email: user.email
        //         },
        //         defaults: {
        //             code: OTP // The default values to use when creating a new record
        //         },
        //         order: [['created_at', 'DESC']]
        //     });

        //     if (!created) {
        //         // Record already existed and was updated
        //         await verification.update({ code: OTP });
        //     }
        // } catch (error) {
        //     console.error('Error sending message:', error);
        //     return res.status(401).json({
        //         status: 'errorMobile',
        //         message: 'Mobile number is invalid'
        //     });
        //     // return false; // Failed to send notification
        // }

        res.status(200).json({
            status: 'success',
            message: 'OTP sent successfully in your mobile number'
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function registerStudentWithGoogle(req, res) {
    try {
        const { fcm_token, ...userDetails } = req.body;

        // check email already exists
        let existingGoogle = await Users.findOne({
            where: { google_id: userDetails.google_id }
        });

        // generate token

        if (existingGoogle) {
            let fcmTokens = [];

            if (existingGoogle.fcm_token) {
                try {
                    // Parse the string into an array
                    fcmTokens = JSON.parse(existingGoogle.fcm_token);
                } catch (error) {
                    fcmTokens = [existingGoogle.fcm_token];
                }
            }

            // Add the new FCM token to the array
            if (!fcmTokens.includes(fcm_token)) {
                fcmTokens.push(fcm_token);
            }

            // Convert the array of FCM tokens back to a JSON string
            let updatedFcmToken = JSON.stringify(fcmTokens);

            const userDetailstoken = generateToken(existingGoogle.id);

            let email = existingGoogle.email;
            await Users.update({ fcm_token: updatedFcmToken }, { where: { email } });
            return res.status(200).json({
                status: 'success',
                message: 'Login successful',
                token: userDetailstoken,
                data: existingGoogle
            });
        }

        let user_data = {
            full_name: userDetails.full_name,
            email: userDetails.email,
            google_id: userDetails.google_id,
            role_id: 1,
            role_name: 'user',
            status: 'pending',
            verified: true,
            created_at: userDetails.created_at,
            password: null,
            language: 'HE',
            timezone: userDetails.timezone,
            fcm_token: fcm_token
        };

        let newUser = await Users.create(user_data);
        const token = generateToken(newUser.id);
        // response
        res.status(200).json({
            status: 'success',
            message: 'Login successful',
            token: token,
            data: newUser
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function registerStudentWithApple(req, res) {
    try {
        const { fcm_token, ...userDetails } = req.body;

        // check if user already exists with Apple ID
        let existingAppleUser = await Users.findOne({
            where: { apple_id: userDetails.apple_id }
        });

        if (existingAppleUser) {
            let fcmTokens = [];

            if (existingAppleUser.fcm_token) {
                try {
                    // Parse the string into an array
                    fcmTokens = JSON.parse(existingAppleUser.fcm_token);
                } catch (error) {
                    fcmTokens = [existingAppleUser.fcm_token];
                }
            }

            // Add the new FCM token to the array if it doesn't exist
            if (!fcmTokens.includes(fcm_token)) {
                fcmTokens.push(fcm_token);
            }

            // Convert the array of FCM tokens back to a JSON string
            let updatedFcmToken = JSON.stringify(fcmTokens);

            const userDetailstoken = generateToken(existingAppleUser.id);

            let email = existingAppleUser.email;
            await Users.update({ fcm_token: updatedFcmToken }, { where: { email } });

            return res.status(200).json({
                status: 'success',
                message: 'Login successful',
                token: userDetailstoken,
                data: existingAppleUser
            });
        }

        // Create new user if they don't exist
        let user_data = {
            full_name: userDetails.full_name,
            email: userDetails.email,
            apple_id: userDetails.apple_id,
            role_id: 1,
            role_name: 'user',
            status: 'pending',
            verified: true,
            created_at: userDetails.created_at,
            password: null,
            language: 'HE',
            timezone: userDetails.timezone,
            fcm_token: fcm_token
        };

        let newUser = await Users.create(user_data);
        const token = generateToken(newUser.id);

        // response
        res.status(200).json({
            status: 'success',
            message: 'Login successful',
            token: token,
            data: newUser
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function registerStudentWithFacebook(req, res) {
    try {
        const { fcm_token, ...userDetails } = req.body;

        // check email already exists
        let existingFacebook = await Users.findOne({
            where: { facebook_id: userDetails.facebook_id }
        });

        // generate token

        if (existingFacebook) {
            let fcmTokens = [];

            if (existingFacebook.fcm_token) {
                try {
                    // Parse the string into an array
                    fcmTokens = JSON.parse(existingFacebook.fcm_token);
                } catch (error) {
                    fcmTokens = [existingFacebook.fcm_token];
                }
            }

            // Add the new FCM token to the array
            if (!fcmTokens.includes(fcm_token)) {
                fcmTokens.push(fcm_token);
            }

            // Convert the array of FCM tokens back to a JSON string
            let updatedFcmToken = JSON.stringify(fcmTokens);

            const userDetailstoken = generateToken(existingFacebook.id);

            let email = existingFacebook.email;
            await Users.update({ fcm_token: updatedFcmToken }, { where: { email } });
            return res.status(200).json({
                status: 'success',
                message: 'Login successful',
                token: userDetailstoken,
                data: existingFacebook
            });
        }

        let user_data = {
            full_name: userDetails.full_name,
            email: userDetails.email,
            facebook_id: userDetails.facebook_id,
            role_id: 1,
            role_name: 'user',
            status: 'pending',
            verified: true,
            created_at: userDetails.created_at,
            password: null,
            language: 'HE',
            timezone: userDetails.timezone,
            fcm_token: fcm_token
        };

        let newUser = await Users.create(user_data);
        const token = generateToken(newUser.id);
        // response
        res.status(200).json({
            status: 'success',
            message: 'Login successful',
            token: token,
            data: newUser
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// async function getAppColors(req, res) {
//     try {
//         // Try to get theme from database for TULKKA organization
//         let theme = await Theme.findOne({
//             where: { organization_id: 'TULKKA' },
//             order: [['last_updated', 'DESC']]
//         });

//         if (!theme) {
//             // If no theme exists, create default theme with colors
//             theme = await Theme.create({
//                 version: '1.0.0',
//                 organization_id: 'TULKKA',
//                 last_updated: new Date()
//             });

//             // Insert default light colors
//             const lightColors = Object.entries(DEFAULT_LIGHT_COLORS).map(([colorName, colorValue]) => ({
//                 theme_id: theme.id,
//                 theme_type: 'light',
//                 color_name: colorName,
//                 color_value: colorValue
//             }));

//             // Insert default dark colors
//             const darkColors = Object.entries(DEFAULT_DARK_COLORS).map(([colorName, colorValue]) => ({
//                 theme_id: theme.id,
//                 theme_type: 'dark',
//                 color_name: colorName,
//                 color_value: colorValue
//             }));

//             // Bulk insert all colors
//             await ThemeColor.bulkCreate([...lightColors, ...darkColors]);
//         }

//         // Fetch all colors for this theme
//         const themeColors = await ThemeColor.findAll({
//             where: { theme_id: theme.id }
//         });

//         // Group colors by theme type
//         const lightColors = {};
//         const darkColors = {};

//         themeColors.forEach(color => {
//             if (color.theme_type === 'light') {
//                 lightColors[color.color_name] = color.color_value;
//             } else if (color.theme_type === 'dark') {
//                 darkColors[color.color_name] = color.color_value;
//             }
//         });

//         // Return the response in the same format as before
//         res.json({
//             colors: {
//                 light: lightColors,
//                 dark: darkColors
//             },
//             lastUpdated: theme.last_updated.toISOString(),
//             version: theme.version,
//             organizationId: theme.organization_id
//         });

//     } catch (error) {
//         console.error('Error fetching app colors:', error);

//         // Fallback to default colors if database error occurs
//         res.json({
//             colors: {
//                 light: DEFAULT_LIGHT_COLORS,
//                 dark: DEFAULT_DARK_COLORS
//             },
//             lastUpdated: new Date().toISOString(),
//             version: "1.0.0",
//             organizationId: "TULKKA"
//         });
//     }
// }
async function getAppColors(req, res) {
    try {
        // Get theme for the TULKKA organization
        let theme = await Theme.findOne({
            where: { organization_id: 'TULKKA' },
            order: [['last_updated', 'DESC']]
        });

        // If theme doesn't exist, create one and populate default colors
        if (!theme) {
            theme = await Theme.create({
                version: '1.0.0',
                organization_id: 'TULKKA',
                last_updated: new Date()
            });

            const lightColors = Object.entries(DEFAULT_LIGHT_COLORS).map(([colorName, colorValue]) => ({
                theme_id: theme.id,
                theme_type: 'light',
                color_name: colorName,
                color_value: colorValue
            }));

            const darkColors = Object.entries(DEFAULT_DARK_COLORS).map(([colorName, colorValue]) => ({
                theme_id: theme.id,
                theme_type: 'dark',
                color_name: colorName,
                color_value: colorValue
            }));

            await ThemeColor.bulkCreate([...lightColors, ...darkColors]);
        }

        // Fetch theme colors
        const themeColors = await ThemeColor.findAll({
            where: { theme_id: theme.id }
        });

        const lightColors = {};
        const darkColors = {};

        themeColors.forEach((color) => {
            if (color.theme_type === 'light') {
                lightColors[color.color_name] = color.color_value;
            } else if (color.theme_type === 'dark') {
                darkColors[color.color_name] = color.color_value;
            }
        });

        // Return colors + app data (no default values)
        res.json({
            colors: {
                light: lightColors,
                dark: darkColors
            },
            appData: {
                appName: theme.app_name,
                supportEmail: theme.support_email,
                phoneNumber: theme.phone_number,
                appLogo: theme.app_logo,
                appFavicon: theme.app_favicon,
                aboutApp: theme.about_app,
                termsConditions: theme.terms_conditions
            },
            lastUpdated: theme.last_updated.toISOString(),
            version: theme.version,
            organizationId: theme.organization_id
        });
    } catch (error) {
        console.error('Error fetching app colors:', error);

        // Fallback if DB fails
        res.json({
            colors: {
                light: DEFAULT_LIGHT_COLORS,
                dark: DEFAULT_DARK_COLORS
            },
            appData: {
                appName: null,
                supportEmail: null,
                phoneNumber: null,
                appLogo: null,
                appFavicon: null,
                aboutApp: null,
                termsConditions: null
            },
            lastUpdated: new Date().toISOString(),
            version: '1.0.0',
            organizationId: 'TULKKA'
        });
    }
}

// Simple FCM test notification function
async function testFCMNotification(req, res) {
    try {
        const { 
            fcm_token, 
            title = "Test Notification", 
            body = "This is a test notification from Tulkka",
            data = {} 
        } = req.body;

        if (!fcm_token) {
            return res.status(400).json({
                status: 'error',
                message: 'FCM token is required'
            });
        }

        // Import Firebase service
        const FirebaseService = require('../services/firebase-service');
        const firebaseService = new FirebaseService();

        // Send test notification
        const result = await firebaseService.sendNotificationToDevice(
            fcm_token,
            { title, body },
            data
        );

        return res.status(200).json({
            status: result.success ? 'success' : 'error',
            message: result.success ? 'Test notification sent successfully' : 'Failed to send notification',
            data: {
                fcm_token: fcm_token,
                notification: { title, body },
                result: result
            }
        });

    } catch (error) {
        console.error('Error sending test FCM notification:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Test notification failed',
            error: error.message
        });
    }
}
async function incrementFreeClass(referrerId, refereeId) {
    try {
        // Referrer
        let referrerRecord = await FreeClass.findOne({
            where: { user_id: referrerId, referred_user_id: refereeId }
        });

        if (referrerRecord) {
            referrerRecord.count_free_class += 1;
            referrerRecord.updated_at = Math.floor(Date.now() / 1000);
            await referrerRecord.save();
        } else {
            await FreeClass.create({
                user_id: referrerId,
                referred_user_id: refereeId,
                count_free_class: 1
            });
        }

        // Referee
        let refereeRecord = await FreeClass.findOne({
            where: { user_id: refereeId, referred_user_id: referrerId }
        });

        if (refereeRecord) {
            refereeRecord.count_free_class += 1;
            refereeRecord.updated_at = Math.floor(Date.now() / 1000);
            await refereeRecord.save();
        } else {
            await FreeClass.create({
                user_id: refereeId,
                referred_user_id: referrerId,
                count_free_class: 1
            });
        }

        return true;
    } catch (err) {
        console.error('FreeClass update error:', err);
        return false;
    }
}

module.exports = {
    registerStudent,
    verifyAccount,
    updateProfile,
    loginStudent,
    forgotPassword,
    verifyOTP,
    resendOTP,
    resetPassword,
    getUserByEmail,
    getKidFromParent,
    switchKidsAssignment,
    getAllKidFromParent,
    loginKid,
    logoutUser,

    // vesrion 2
    registerStudentV2,
    loginStudentV2,

    sendOtpToMobile,
    verifyMobileOTP,
    resendMobileOTP,

    // Social login
    registerStudentWithGoogle,
    registerStudentWithApple,
    registerStudentWithFacebook,

    // Get app colors
    getAppColors,
    testFCMNotification,
    registerKid
};
