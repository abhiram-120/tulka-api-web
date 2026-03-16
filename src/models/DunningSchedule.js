// src/models/DunningSchedule.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const DunningSchedule = sequelize.define(
    'DunningSchedule',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        past_due_payment_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'past_due_payments',
                key: 'id'
            }
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        is_enabled: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        is_paused: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        paused_until: {
            type: DataTypes.DATE,
            allowNull: true
        },
        paused_by_user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true
        },
        paused_reason: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        reminder_frequency: {
            type: DataTypes.ENUM('daily', 'every_2_days', 'weekly'),
            defaultValue: 'daily'
        },
        reminder_time: {
            type: DataTypes.TIME,
            defaultValue: '10:00:00'
        },
        timezone: {
            type: DataTypes.STRING(50),
            defaultValue: 'Asia/Jerusalem'
        },
        next_reminder_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        last_reminder_sent_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        total_reminders_sent: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        max_reminders: {
            type: DataTypes.INTEGER,
            allowNull: true
        }
    },
    {
        tableName: 'dunning_schedules',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        underscored: true,
        collate: 'utf8mb4_unicode_ci'
    }
);

module.exports = DunningSchedule;