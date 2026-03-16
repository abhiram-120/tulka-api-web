const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const MemoryGameProgress = sequelize.define('memory_game_progress', {
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
    pairs_found: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    total_moves: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    time_elapsed: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    hints_used: {
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
    timestamps: false,
    tableName: 'memory_game_progress'
});

module.exports = MemoryGameProgress;