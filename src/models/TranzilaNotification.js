// models/TranzilaNotification.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TranzilaNotification = sequelize.define(
    'TranzilaNotification',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        data: {
            type: DataTypes.JSON,
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('received', 'processed', 'failed', 'error'),
            defaultValue: 'received'
        },
        processed_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        processing_notes: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    },
    {
        tableName: 'tranzila_notifications',
        timestamps: false,
        underscored: true,
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci'
    }
);

module.exports = TranzilaNotification;