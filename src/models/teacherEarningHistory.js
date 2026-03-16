const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TeacherEarningHistory = sequelize.define(
    'TeacherEarningHistory',
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },

        teacher_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false
        },

        earning_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },

        base_rate: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0
        },
        classes: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Regular and trial class IDs for the day'
        },

        bonus_amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0
        },

        penalty_amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0
        },

        total_amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0
        }
    },
    {
        tableName: 'teacher_earning_history',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            {
                unique: true,
                fields: ['teacher_id', 'earning_date']
            },
            {
                fields: ['teacher_id', 'earning_date']
            }
        ]
    }
);

module.exports = TeacherEarningHistory;
