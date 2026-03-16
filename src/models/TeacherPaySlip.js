const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TeacherPayslip = sequelize.define(
    'TeacherPayslip',
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

        salary_profile_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false
        },

        period_start: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },

        period_end: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },

        status: {
            type: DataTypes.ENUM('draft', 'final', 'cancelled'),
            defaultValue: 'draft'
        },

        base_salary: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0
        },

        bonus_amount: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0
        },

        penalty_amount: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0
        },

        total_amount: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0
        },

        classes: {
            type: DataTypes.JSON,
            allowNull: true
        },

        classes_stats: {
            type: DataTypes.JSON,
            allowNull: true
        },

        bonuses: {
            type: DataTypes.JSON,
            allowNull: true
        },

        penalties: {
            type: DataTypes.JSON,
            allowNull: true
        },

        sent_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        period_type: {
            type: DataTypes.ENUM('FULL', 'FIRST_HALF', 'SECOND_HALF'),
            allowNull: false,
            defaultValue: 'FULL'
        },

        finalized_at: {
            type: DataTypes.DATE,
            allowNull: true
        },

        cancelled_at: {
            type: DataTypes.DATE,
            allowNull: true
        },

        created_by: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false
        },

        updated_by: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true
        }
    },
    {
        tableName: 'teacher_payslips',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
);

const parseJsonArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;

    if (typeof value === 'string') {
        try {
            let parsed = JSON.parse(value);
            if (typeof parsed === 'string') {
                parsed = JSON.parse(parsed);
            }
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    return [];
};

module.exports = TeacherPayslip;
