const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const WordPracticed = sequelize.define('words_practiced', {  // Make sure this matches your actual table name
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
    word_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
            model: 'translation_words',
            key: 'id'
        }
    },
    remembered: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
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
    tableName: 'words_practiced'  // Explicitly set the table name here
});

module.exports = WordPracticed;