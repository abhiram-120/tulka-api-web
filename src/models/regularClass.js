const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');
const User = require('./users');

const RegularClass = sequelize.define(
    'RegularClass',
    {
        id: {
            type: DataTypes.BIGINT(20),
            primaryKey: true,
            autoIncrement: true
        },
        student_id: {
            type: DataTypes.INTEGER(10).UNSIGNED,
            allowNull: false
        },
        teacher_id: {
            type: DataTypes.INTEGER(10).UNSIGNED,
            allowNull: false
        },
        day: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null
        },
        start_time: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null
        },
        end_time: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null
        },
        student_lesson_reset_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: sequelize.literal('CURRENT_TIMESTAMP')
        },
        timezone: {
            type: DataTypes.STRING(255),
            allowNull: true,
            defaultValue: null
        },
        batch_id: {
            type: DataTypes.STRING(255),
            allowNull: true,
            defaultValue: null
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null
        },
        updated_at: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null
        }
    },
    {
        tableName: 'regular_class',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        underscored: true
    }
);

// Associations are defined in associations.js file

module.exports = RegularClass;