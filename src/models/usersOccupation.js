const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const UserOccupation = sequelize.define('users_occupation', {
    id: {
        type: DataTypes.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    user_id: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
    },
    type: {
        type: DataTypes.STRING(100), // varchar(100) in MySQL
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
        defaultValue: null,
    },
    category_id: {
        type: DataTypes.INTEGER.UNSIGNED,
        defaultValue: null,
    },
    value: {
        type: DataTypes.STRING(255), // varchar(255) in MySQL
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
        defaultValue: null,
    },
}, {
    tableName: 'users_occupations',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    timestamps: false, // Assuming you don't have 'created_at' and 'updated_at' fields
});

module.exports = UserOccupation;
