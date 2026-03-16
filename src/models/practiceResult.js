const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const PracticeResult = sequelize.define('practice_results', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    session_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
            model: 'practice_sessions',
            key: 'id'
        }
    },
    total_words: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    remembered: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    need_practice: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    success_rate: {
        type: DataTypes.DECIMAL(5, 2),
        defaultValue: 0
    },
    time_elapsed: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Seconds spent on practice'
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

PracticeResult.associate = function(models) {
    PracticeResult.belongsTo(models.PracticeSession, {
        foreignKey: 'session_id',
        as: 'PracticeSession'
    });
};

module.exports = PracticeResult;