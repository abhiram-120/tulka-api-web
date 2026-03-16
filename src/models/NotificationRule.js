const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const NotificationRule = sequelize.define('NotificationRule', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    rule_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
    },
    display_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    trigger_type: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            isIn: [[
                'post_lesson_feedback',
                'post_lesson_practice',
                'inactivity',
                'unpracticed_vocab',
                'unviewed_feedback',
                'new_practice_available'
            ]]
        }
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
    delay_hours: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
    delay_days: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
    channels: {
        type: DataTypes.JSON,
        defaultValue: ['push'],
        get() {
            const val = this.getDataValue('channels');
            if (typeof val === 'string') {
                try { return JSON.parse(val); } catch (e) { return ['push']; }
            }
            return val || ['push'];
        }
    },
    title_he: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    title_en: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    body_he: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    body_en: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    max_per_day: {
        type: DataTypes.INTEGER,
        defaultValue: 3,
    },
    max_per_week: {
        type: DataTypes.INTEGER,
        defaultValue: 10,
    },
    quiet_start: {
        type: DataTypes.TIME,
        defaultValue: '22:00:00',
    },
    quiet_end: {
        type: DataTypes.TIME,
        defaultValue: '08:00:00',
    },
    priority: {
        type: DataTypes.INTEGER,
        defaultValue: 5,
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
    },
}, {
    tableName: 'notification_rules',
    timestamps: false,
    underscored: true,
});

module.exports = NotificationRule;
