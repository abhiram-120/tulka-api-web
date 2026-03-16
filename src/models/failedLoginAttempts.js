const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const FailedLoginAttempts = sequelize.define(
    'FailedLoginAttempts',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        email: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        password: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        failure_reason: {
            type: DataTypes.ENUM('invalid_credentials', 'inactive_account', 'other'),
            defaultValue: 'invalid_credentials',
        },
        additional_info: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        tableName: 'failed_login_attempts',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        underscored: true,
    }
);

module.exports = FailedLoginAttempts;