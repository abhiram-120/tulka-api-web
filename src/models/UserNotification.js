const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const UserNotification = sequelize.define('UserNotification', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    rule_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    type: {
        type: DataTypes.STRING(100),
        allowNull: false,
    },
    title: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    body: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    data: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: null,
        get() {
            const val = this.getDataValue('data');
            if (typeof val === 'string') {
                try { return JSON.parse(val); } catch (e) { return null; }
            }
            return val;
        }
    },
    is_read: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    read_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
    },
}, {
    tableName: 'user_notifications',
    timestamps: false,
    underscored: true,
});

module.exports = UserNotification;
