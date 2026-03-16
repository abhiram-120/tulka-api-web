const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');
const moment = require('moment');

const teacherHoliday = sequelize.define(
    'teacher_holiday',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            comment: 'Primary key, auto-incrementing ID for each holiday record'
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'Foreign key referencing the teacher/user ID'
        },
        title: {
            type: DataTypes.STRING(50),
            allowNull: false,
            comment: 'title of the holiday'
        },
        reason: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null,
            comment: 'Detailed explanation for the holiday/time-off request'
        },
        form_date: {
            type: DataTypes.DATE,
            defaultValue: null,
            comment: 'Start date of the holiday period'
        },
        to_date: {
            type: DataTypes.DATE,
            defaultValue: null,
            comment: 'End date of the holiday period'
        },
        status: {
            type: DataTypes.ENUM('pending', 'approved', 'rejected'),
            defaultValue: 'pending',
            allowNull: false,
            comment: 'Current status of the holiday request'
        },
        approver_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            defaultValue: null,
            comment: 'ID of the user who can accept or reject the request'
        },
        response: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null,
            comment: 'Admin response or feedback for the holiday request'
        }
    },
    {
        tableName: 'teacher_holiday',
        timestamps: false,  // No created_at or updated_at columns
        underscored: true   // Use snake_case for column names
    }
);

// Export the model to use it in other parts of your application
module.exports = teacherHoliday;