const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');
const moment = require('moment');

const ReceiveReminder = sequelize.define('receive_reminder', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    student_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    reminder_time: {
        type: DataTypes.JSON, // Use DataTypes.JSON for JSON data
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
    },
}, {
    tableName: 'receiving_reminders',
    timestamps: true, // Enable timestamps
    createdAt: 'created_at', // Specify the field name for createdAt
    updatedAt: 'updated_at', // Specify the field name for updatedAt
    underscored: true,
});

module.exports = ReceiveReminder;
