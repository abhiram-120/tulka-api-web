const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const FreeClass = sequelize.define('free_classes', {
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
    referred_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    count_free_class: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
    created_at: {
        type: DataTypes.INTEGER,
        defaultValue: () => Math.floor(Date.now() / 1000),
    },
    updated_at: {
        type: DataTypes.INTEGER,
        defaultValue: () => Math.floor(Date.now() / 1000),
    },
}, {
    tableName: 'free_classes',
    timestamps: false,
});

module.exports = FreeClass;