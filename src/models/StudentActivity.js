const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const StudentActivity = sequelize.define('StudentActivity', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    student_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
    },
    last_app_open: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    last_practice: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    last_vocab_practice: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    last_feedback_viewed: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    last_game_played: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
    },
}, {
    tableName: 'student_activity',
    timestamps: false,
    underscored: true,
});

module.exports = StudentActivity;
