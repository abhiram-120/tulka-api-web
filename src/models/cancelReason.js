const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const CancelReason = sequelize.define(
    'cancel_reasons',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        cancellation_type: {
            type: DataTypes.STRING,
            allowNull: false
        },
        reason: {
            type: DataTypes.STRING,
            allowNull: false
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: false
        },
        created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
    },
    { tableName: 'cancel_reasons', timestamps: true, underscore: true, createdAt: 'created_at', updatedAt: 'updated_at' }
);

module.exports = CancelReason;
