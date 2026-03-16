const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const Transcription = sequelize.define(
    'Transcription',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        class_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            unique: true,
            references: {
                model: 'classes',
                key: 'id'
            }
        },
        full_text: {
            type: DataTypes.TEXT.LONG,
            allowNull: true
        },
        word_count: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        duration_seconds: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        language_detected: {
            type: DataTypes.STRING(10),
            allowNull: true
        },
        processed_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    },
    {
        tableName: 'transcriptions',
        timestamps: false,
        indexes: [
            {
                unique: true,
                fields: ['class_id']
            }
        ]
    }
);

module.exports = Transcription;