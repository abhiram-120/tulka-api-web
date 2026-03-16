const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const PracticeSession = sequelize.define('practice_sessions', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    practice_mode: {
        type: DataTypes.STRING(50),
        allowNull: false
    },
    source_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: 'lesson, wordFile, or memoryStatus'
    },
    source_id: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    start_time: {
        type: DataTypes.DATE,
        allowNull: false
    },
    end_time: {
        type: DataTypes.DATE,
        allowNull: true
    },
    completed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    hints_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
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
    timestamps: false
});

PracticeSession.associate = function(models) {
    PracticeSession.hasOne(models.PracticeResult, {
        foreignKey: 'session_id',
        as: 'PracticeResult'
    });
};

module.exports = PracticeSession;