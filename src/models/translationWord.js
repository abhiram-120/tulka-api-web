const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TranslationWord = sequelize.define('translation_words', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    original: {
        type: DataTypes.STRING,
        allowNull: false
    },
    translation: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    },
    is_favorite: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    file_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
            model: 'translation_files',
            key: 'id'
        }
    },
    remembered: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    success_rate: {
        type: DataTypes.DECIMAL(5,2),
        defaultValue: 0
    },
    last_practiced: {
        type: DataTypes.DATE,
        defaultValue: null
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

module.exports = TranslationWord;