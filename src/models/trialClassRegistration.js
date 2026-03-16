// models/TrialClassRegistration.js (Updated)
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TrialClassRegistration = sequelize.define(
    'TrialClassRegistration',
    {
        id: {
            type: DataTypes.BIGINT,
            primaryKey: true,
            autoIncrement: true
        },

        // FAMILY INTEGRATION FIELDS
        family_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Reference to families table if booking is for family member'
        },
        child_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Reference to family_children table if booking is for family child'
        },
        booking_type: {
            type: DataTypes.ENUM('new_customer', 'family_member'),
            allowNull: false,
            defaultValue: 'new_customer',
            comment: 'Whether this is a new customer or existing family member booking'
        },
        // END FAMILY INTEGRATION FIELDS


        student_name: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Full name of the student'
        },
        parent_name: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Name of parent/guardian if applicable'
        },
        country_code: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Country code for phone number'
        },
        mobile: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Mobile number of student/parent'
        },
        email: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Email address for communications'
        },
        age: {
            type: DataTypes.INTEGER,
            allowNull: false,
            comment: 'Age of the student'
        },
        status: {
            type: DataTypes.ENUM('pending', 'confirmed', 'cancelled', 'completed', 'converted'),
            allowNull: false,
            defaultValue: 'pending',
            comment: 'Current status of trial class'
        },
        teacher_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'Reference to users table for teacher'
        },
        booked_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'Reference to users table for sales agent'
        },
        notification_preferences: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'JSON containing notification preferences'
        },
        class_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Reference to regular class if converted'
        },
        regular_class_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Reference to regular class series if applicable'
        },
        meeting_start: {
            type: DataTypes.DATE,
            allowNull: false,
            comment: 'Start time of trial class in UTC'
        },
        meeting_end: {
            type: DataTypes.DATE,
            allowNull: false,
            comment: 'End time of trial class in UTC'
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Additional notes or requirements'
        },
        language: {
            type: DataTypes.ENUM('HE', 'EN', 'AR'),
            allowNull: false,
            defaultValue: 'EN',
            comment: 'Preferred language for class'
        },
        cancellation_reason: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Reason for cancellation if class was cancelled'
        },
        cancelled_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'ID of user who cancelled the class'
        },
        cancelled_at: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Timestamp when the class was cancelled'
        },
        trial_class_status: {
            type: DataTypes.ENUM(
                'trial_1',
                'trial_2',
                'trial_2_paid',
                'trial_3',
                'trial_3_paid',
                'waiting_for_answer',
                'payment_sent',
                'new_enroll',
                'follow_up',
                'not_relevant',
                'waiting_for_payment'
            ),
            allowNull: false,
            defaultValue: 'trial_1',
            comment: 'trial_1: Trial Class 1, trial_2: Trial Class 2, trial_2_paid: Trial Class 2 (Paid), trial_3: Trial Class 3, trial_3_paid: Trial Class 3 (Paid), waiting_for_answer: Waiting for Answer, payment_sent: Payment Sent, new_enroll: New Enroll, follow_up: Follow-Up Needed, not_relevant: Not Relevant, waiting_for_payment: Waiting for Payment'
        },
        status_change_notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Notes and reason for trial class status changes'
        },
        // New fields for transfer functionality
        transfer_status: {
            type: DataTypes.ENUM('not_transferred', 'transferred', 'transfer_accepted', 'transfer_rejected'),
            defaultValue: 'not_transferred',
            comment: 'Current status of student transfer'
        },
        transferred_to: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Sales user ID student was transferred to'
        },
        transfer_date: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'When the student was transferred'
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            comment: 'Record creation timestamp'
        },
        updated_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            onUpdate: DataTypes.NOW,
            comment: 'Record update timestamp'
        }
    },
    {
        tableName: 'trial_class_registrations',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
        comment: 'Stores trial class registration details and status',
        indexes: [
            {
                name: 'idx_teacher_id',
                fields: ['teacher_id']
            },
            {
                name: 'idx_booked_by',
                fields: ['booked_by']
            },
            {
                name: 'idx_status',
                fields: ['status']
            },
            {
                name: 'idx_meeting_start',
                fields: ['meeting_start']
            },
            {
                name: 'idx_transfer_status',
                fields: ['transfer_status']
            },
            {
                name: 'idx_transferred_to',
                fields: ['transferred_to']
            },
            
            // INDEXES FOR FAMILY INTEGRATION
            {
                name: 'idx_family_id',
                fields: ['family_id']
            },
            {
                name: 'idx_child_id',
                fields: ['child_id']
            },
            {
                name: 'idx_booking_type',
                fields: ['booking_type']
            }
        ]
    }
);

module.exports = TrialClassRegistration;