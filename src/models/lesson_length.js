const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const LessonLength = sequelize.define('lesson_lengths', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    duration_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'subscription_durations',
            key: 'id'
        }
    },
    minutes: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('active', 'inactive'),
        defaultValue: 'active'
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'lesson_lengths',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_bin',
    timestamps: false,
    underscored: true
});

module.exports = LessonLength;