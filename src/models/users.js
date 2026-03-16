const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const User = sequelize.define(
    'User',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        full_name: {
            type: DataTypes.STRING(128),
            allowNull: true
        },
        role_name: {
            type: DataTypes.STRING(64),
            defaultValue: 'user',
            allowNull: false
        },
        role_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            defaultValue: 1,
            allowNull: false
        },
        organ_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        mobile: {
            type: DataTypes.STRING(32),
            allowNull: true
        },
        country_code: {
            type: DataTypes.STRING(32),
            allowNull: true
        },
        email: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        bio: {
            type: DataTypes.STRING(128),
            allowNull: true
        },
        subject: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        education: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        experience: {
            type: DataTypes.TEXT,
            allowNull: true
        },        
        password: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        google_id: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        apple_id: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        facebook_id: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        remember_token: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        verified: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        financial_approval: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        avatar: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        avatar_settings: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        cover_img: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        video_demo: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        video_demo_source: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        about: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        address: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        country_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true
        },
        province_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true
        },
        city_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true
        },
        city: {
            type: DataTypes.STRING(200),
            allowNull: true
        },
        district_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true
        },
        location: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        level_of_training: {
            type: DataTypes.INTEGER(3),
            allowNull: true
        },
        meeting_type: {
            type: DataTypes.ENUM('all', 'in_person', 'online'),
            allowNull: false,
            defaultValue: 'all'
        },
        status: {
            type: DataTypes.ENUM('active', 'pending', 'inactive'),
            allowNull: false,
            defaultValue: 'pending'
        },
        access_content: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        language: {
            type: DataTypes.STRING(255),
            allowNull: true,
            defaultValue: 'HE'
        },
        native_language: {
            type: DataTypes.STRING(255),
            allowNull: true,
            defaultValue: null
        },
        headline: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        newsletter: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        public_message: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        account_type: {
            type: DataTypes.STRING(128),
            allowNull: true
        },
        iban: {
            type: DataTypes.STRING(128),
            allowNull: true
        },
        account_id: {
            type: DataTypes.STRING(128),
            allowNull: true
        },
        identity_scan: {
            type: DataTypes.STRING(128),
            allowNull: true
        },
        certificate: {
            type: DataTypes.STRING(128),
            allowNull: true
        },
        commission: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true
        },
        affiliate: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        can_create_store: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'Despite disabling the store feature in the settings, we can enable this feature for that user through the edit page of a user and turning on the store toggle.'
        },
        ban: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        ban_start_at: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true
        },
        ban_end_at: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true
        },
        offline: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        offline_message: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        created_at: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: () => Math.floor(Date.now() / 1000)
        },
        updated_at: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        deleted_at: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        subscription_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        trial_expired: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        next_month_subscription: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'Indicates if user has an active subscription for next month'
        },
        next_year_subscription: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'Indicates if user has an active subscription for next year'
        },
        timezone: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        subscription_type: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        video_demo_thumb: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        total_hours: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        notification_channels: {
            type: DataTypes.STRING(150),
            allowNull: false,
            defaultValue: '["email","whatsapp","inapp"]'
        },
        lesson_notifications: {
            type: DataTypes.STRING(150),
            allowNull: false,
            defaultValue: '["24","1"]'
        },
        site_intro: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        fcm_token: {
            type: DataTypes.TEXT
        },
        add_zoom_link: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        add_zoom_link_meeting_id: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        add_zoom_link_access_code: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        enable_zoom_link: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        guardian: {
            type: DataTypes.BIGINT,
            allowNull: true
        },
        is_parent: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        is_appointment_setter: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            comment: 'Whether user is an appointment setter'
        },
        is_sales_user: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            comment: 'Whether user is a sales user'
        },
        trial_transfers_count: {
            type: DataTypes.INTEGER.UNSIGNED,
            defaultValue: 0,
            comment: 'Count of trial transfers for appointment setters'
        },
        accepted_trial_transfers_count: {
            type: DataTypes.INTEGER.UNSIGNED,
            defaultValue: 0,
            comment: 'Count of accepted trial transfers'
        },
        rejected_trial_transfers_count: {
            type: DataTypes.INTEGER.UNSIGNED,
            defaultValue: 0,
            comment: 'Count of rejected trial transfers'
        },
        trial_conversion_rate: {
            type: DataTypes.DECIMAL(5, 2),
            defaultValue: 0.00,
            comment: 'Percentage of trial conversions for sales users'
        },
        trial_user_id: {
            type: DataTypes.BIGINT,
            allowNull: true,
            references: {
                model: 'trial_class_registrations',
                key: 'id'
            },
            comment: 'Reference to trial class registration that converted to paid subscription'
        },
        date_of_birth: {
            type: DataTypes.DATE,
            allowNull: true
        },
        gender: {
            type: DataTypes.STRING(20),
            allowNull: true,
            defaultValue: null
        },
        invite_code: {
            type: DataTypes.STRING(50),
            allowNull: true,
            defaultValue: null
        },
        invite_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            defaultValue: null
        },
        student_level: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null,
            comment: 'Student language proficiency level (1-15)'
        },
        attribution: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: null
        },
        device_info: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: null,
            comment: 'Device information including platform, version, deviceId, and persistentDeviceId'
        }
    },
    {
        tableName: 'users',
        timestamps: false,
        underscored: true
    }
);

module.exports = User;
