const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const Penalty = sequelize.define(
    'Penalty',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        penalty_type: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        penalty_month: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
    },
    {
        tableName: 'penalties',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    },
);

module.exports = Penalty;
