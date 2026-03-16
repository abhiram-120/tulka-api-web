// models/audioBroadcast.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const AudioBroadcast = sequelize.define(
    'AudioBroadcast',
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true, 
            autoIncrement: true
        },
        title: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Title of the audio broadcast'
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Description of the audio broadcast'
        },
        category: {
            type: DataTypes.STRING(100),
            allowNull: true,
            comment: 'Category of the audio broadcast'
        },
        audio_file_url: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'URL to the audio file in S3'
        },
        audio_file_name: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Original name of the uploaded audio file'
        },
        image_url: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'URL to the cover image in S3'
        },
        duration: {
            type: DataTypes.STRING(20),
            allowNull: true,
            comment: 'Duration of the audio file (MM:SS format)'
        },
        file_size: {
            type: DataTypes.STRING(20),
            allowNull: true,
            comment: 'Size of the audio file in MB'
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            comment: 'Whether the broadcast is active and available to listeners'
        },
        upload_date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            comment: 'Date when the broadcast was uploaded'
        },
        listens: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: 0,
            comment: 'Number of times the broadcast has been listened to'
        },
        created_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'ID of the user who created the broadcast'
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            comment: 'Record creation timestamp'
        },
        updated_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            onUpdate: DataTypes.NOW,
            comment: 'Record update timestamp'
        }
    },
    {
        tableName: 'audio_broadcasts',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
        comment: 'Stores audio broadcasts for language learning',
        indexes: [
            {
                name: 'idx_category',
                fields: ['category']
            },
            {
                name: 'idx_is_active',
                fields: ['is_active']
            },
            {
                name: 'idx_created_by',
                fields: ['created_by']
            }
        ]
    }
);

module.exports = AudioBroadcast;