const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TeacherAvailabilityChangeRequest = sequelize.define('teacher_availability_change_requests', {
    id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    user_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false
    },

    admin_approval: {
        type: DataTypes.ENUM('pending', 'accepted', 'rejected'),
        defaultValue: 'pending'
    },

    added: {
        type: DataTypes.JSON,
        defaultValue: []
    },

    dropped: {
        type: DataTypes.JSON,
        defaultValue: []
    },

    // raw diff JSON structure:
    // mon:{added:[],removed:[]}, tue:{...}, ...
    changes_summary: {
        type: DataTypes.JSON,
        defaultValue: {}
    },

    teacher_note: {
        type: DataTypes.TEXT,
        allowNull: true
    },

    admin_feedback_note: {
        type: DataTypes.TEXT,
        allowNull: true
    },

    effective_from: {
        type: DataTypes.DATE,
        allowNull: false
    },

    has_conflicts: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },

    conflict_details: {
        type: DataTypes.JSON,
        defaultValue: []
    },

}, {
    tableName: 'teacher_availability_change_requests',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_bin',
    timestamps: true,
    underscored: true
});

module.exports = TeacherAvailabilityChangeRequest;
