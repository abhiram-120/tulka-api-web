const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const StudentCommunicationLog = sequelize.define(
    'StudentCommunicationLog',
    {
        student_id: { type: DataTypes.INTEGER, allowNull: false },
        risk_level: { type: DataTypes.STRING, allowNull: false },
        message_type: { type: DataTypes.ENUM('whatsapp', 'task', 'call', 'review') },
        status: { type: DataTypes.ENUM('pending', 'sent', 'failed'), defaultValue: 'pending' },
        triggered_by: { type: DataTypes.STRING, defaultValue: 'system' },
        notes: { type: DataTypes.TEXT }
    },
    {
        tableName: 'student_communication_logs',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false
    }
);

module.exports=StudentCommunicationLog;