const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const ClassBookingFailure = sequelize.define('ClassBookingFailure', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    regular_class_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    student_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    teacher_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    attempted_meeting_start: {
        type: DataTypes.DATE,
        allowNull: false
    },
    attempted_meeting_end: {
        type: DataTypes.DATE,
        allowNull: false
    },
    failure_reason: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    detailed_reason: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    batch_id: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    data_json: {
        type: DataTypes.JSON,
        allowNull: true
    }
}, {
    tableName: 'class_booking_failures',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
});

module.exports = ClassBookingFailure;