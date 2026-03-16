const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TeacherAdvancedCashRequest = sequelize.define(
    'TeacherAdvancedCashRequest',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },

        teacher_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },

        amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false
        },

        status: {
            type: DataTypes.ENUM('pending', 'accepted', 'rejected'),
            allowNull: false,
            defaultValue: 'pending'
        },

        req_note: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Note added by teacher while requesting advance'
        },

        res_note: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Note added by admin while responding'
        }
    },
    {
        tableName: 'teacher_advanced_cash_requests',
        timestamps: true,
        underscored: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
);

module.exports = TeacherAdvancedCashRequest;
