const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const Reminder = sequelize.define('Reminder', {
    student_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    teacher_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    lesson_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    reminder_time: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    reminder_type: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    is_reminded: {
        type: DataTypes.BOOLEAN,
        default: false,
    }
}, {
    tableName: 'reminder',
    timestamps: false,
    underscored: true,
});

module.exports = Reminder;
