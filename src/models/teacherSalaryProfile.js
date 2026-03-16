const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TeacherSalaryProfile = sequelize.define(
    'TeacherSalaryProfile',
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            autoIncrement: true,
            primaryKey: true
        },

        teacher_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false
        },

        salary_mode: {
            type: DataTypes.ENUM('auto', 'manual'),
            allowNull: false,
            defaultValue: 'auto'
        },

        manual_start_date: {
            type: DataTypes.DATEONLY,
            allowNull: true
        },

        manual_end_date: {
            type: DataTypes.DATEONLY,
            allowNull: true
        },

        manual_hourly_rate: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true
        },

        compensation_group_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false
        },

        current_group: {
            type: DataTypes.STRING(100),
            allowNull: false
        },

        current_level: {
            type: DataTypes.STRING(50),
            allowNull: false
        },

        eligible_level: {
            type: DataTypes.STRING(50),
            allowNull: true
        },

        level_locked: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        pay_cycle: {
            type: DataTypes.ENUM('monthly', 'half_monthly'),
            allowNull: false,
            defaultValue: 'monthly'
        },
    },
    {
        tableName: 'teacher_salary_profiles',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
);

module.exports = TeacherSalaryProfile;
