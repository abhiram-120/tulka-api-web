const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const NotificationLog = sequelize.define('NotificationLog', {
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
    rule_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    channel: {
        type: DataTypes.STRING(50),
        allowNull: true,
    },
    title: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    body: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    status: {
        type: DataTypes.STRING(50),
        defaultValue: 'queued',
    },
    failure_reason: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    sent_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
    },
}, {
    tableName: 'notification_log',
    timestamps: false,
    underscored: true,
});

module.exports = NotificationLog;
