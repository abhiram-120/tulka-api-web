const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const LessonsPerMonth = sequelize.define('lessons_per_month', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    lesson_length_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'lesson_lengths',
            key: 'id'
        }
    },
    lessons: {
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
    tableName: 'lessons_per_month',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_bin',
    timestamps: false,
    underscored: true
});

module.exports = LessonsPerMonth;