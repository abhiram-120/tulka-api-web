const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TeacherAvailability = sequelize.define('teacher_availability', {
    id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    user_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        defaultValue: null,
    },
    mon: {
        type: DataTypes.TEXT,
        charset: 'utf8mb4',
        collate: 'utf8mb4_bin',
        defaultValue: '{}',
        get() {
            const rawValue = this.getDataValue('mon');
            return rawValue ? rawValue : '{}';
        }
    },
    tue: {
        type: DataTypes.TEXT,
        charset: 'utf8mb4',
        collate: 'utf8mb4_bin',
        defaultValue: '{}',
        get() {
            const rawValue = this.getDataValue('tue');
            return rawValue ? rawValue : '{}';
        }
    },
    wed: {
        type: DataTypes.TEXT,
        charset: 'utf8mb4',
        collate: 'utf8mb4_bin',
        defaultValue: '{}',
        get() {
            const rawValue = this.getDataValue('wed');
            return rawValue ? rawValue : '{}';
        }
    },
    thu: {
        type: DataTypes.TEXT,
        charset: 'utf8mb4',
        collate: 'utf8mb4_bin',
        defaultValue: '{}',
        get() {
            const rawValue = this.getDataValue('thu');
            return rawValue ? rawValue : '{}';
        }
    },
    fri: {
        type: DataTypes.TEXT,
        charset: 'utf8mb4',
        collate: 'utf8mb4_bin',
        defaultValue: '{}',
        get() {
            const rawValue = this.getDataValue('fri');
            return rawValue ? rawValue : '{}';
        }
    },
    sat: {
        type: DataTypes.TEXT,
        charset: 'utf8mb4',
        collate: 'utf8mb4_bin',
        defaultValue: '{}',
        get() {
            const rawValue = this.getDataValue('sat');
            return rawValue ? rawValue : '{}';
        }
    },
    sun: {
        type: DataTypes.TEXT,
        charset: 'utf8mb4',
        collate: 'utf8mb4_bin',
        defaultValue: '{}',
        get() {
            const rawValue = this.getDataValue('sun');
            return rawValue ? rawValue : '{}';
        }
    },
}, {
    tableName: 'teacher_availability',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_bin',
    timestamps: false, // Set to true if you want timestamps
    underscored: true, // Use snake_case for column names
});

module.exports = TeacherAvailability;