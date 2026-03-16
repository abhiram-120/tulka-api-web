const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');
const moment = require('moment');
const User = require('./users');

const Class = sequelize.define(
    'Class',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        student_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            // references:{
            //     model: 'UserSubscriptionDetails',
            //     key: 'user_id'
            // }
            references: {
                model: 'users',
                key: 'id'
            }
        },
        teacher_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        feedback_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            defaultValue: null
        },
        meeting_start: {
            type: DataTypes.DATE,
            defaultValue: null
        },
        meeting_end: {
            type: DataTypes.DATE,
            defaultValue: null
        },
        status: {
            type: DataTypes.STRING(50),
            defaultValue: 'pending'
        },
        join_url: {
            type: DataTypes.TEXT
        },
        admin_url: {
            type: DataTypes.TEXT
        },
        zoom_id: {
            type: DataTypes.BIGINT,
            defaultValue: null
        },
        student_goal: {
            type: DataTypes.TEXT
        },
        student_goal_note: {
            type: DataTypes.TEXT
        },
        question_and_answer: {
            type: DataTypes.STRING(200),
            defaultValue: null
        },
        next_month_class_term: {
            type: DataTypes.BOOLEAN,
            defaultValue: 0,
            allowNull: false
        },
        is_present: {
            type: DataTypes.BOOLEAN,
            defaultValue: 1,
            allowNull: false
        },
        bonus_class: {
            type: DataTypes.BOOLEAN,
            defaultValue: 0,
            allowNull: false
        },
        is_trial: {
            type: DataTypes.BOOLEAN,
            defaultValue: 0
        },
        subscription_id: {
            type: DataTypes.INTEGER,
            defaultValue: null
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false
        },
        updated_at: {
            type: DataTypes.DATE,
            allowNull: false
        },
        class_type: {
            type: DataTypes.STRING(255),
            defaultValue: 'app'
        },
        is_regular_hide: {
            type: DataTypes.BOOLEAN,
            defaultValue: 0
        },
        booked_by: {
            type: DataTypes.ENUM('user', 'admin', 'support_agent', 'teacher', 'sales_role', 'sales_appointment_setter'),
            allowNull: true,
            comment: 'Role of the person who booked the class'
        },
        booked_by_admin_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'ID of the admin who booked the class'
        },
        demo_class_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Reference to trial_class_registrations table'
        },
        cancellation_reason: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Reason for cancellation if class was cancelled'
        },
        cancelled_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'ID of user who cancelled the class',
            references: {
                model: 'users',
                key: 'id'
            }
        },
        cancelled_at: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Timestamp when the class was cancelled'
        },
        canceled_by: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        get_classes_for_extension: {
            type: DataTypes.ENUM('updated', 'not_updated'),
            defaultValue: 'not_updated',
            allowNull: false,
            comment: 'Status for getClassesForExtension - whether the class has been updated or not'
        },
        batch_id: {
            type: DataTypes.STRING(255),
            allowNull: true,
            defaultValue: null,
            comment: 'Batch ID to group classes from the same regular class pattern'
        },
        recording_status: {
            type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
            allowNull: false,
            defaultValue: 'pending'
        },

        recording_url: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        is_game_approved: {
            type: DataTypes.BOOLEAN,
            defaultValue: 0,
            allowNull: false,
            comment: 'Whether the game approval has been completed for this class'
        }
    },
    {
        tableName: 'classes',
        timestamps: true, // Enable timestamps
        createdAt: 'created_at', // Specify the field name for createdAt
        updatedAt: 'updated_at', // Specify the field name for updatedAt
        underscored: true
    }
);

// Export the model to use it in other parts of your application
module.exports = Class;
