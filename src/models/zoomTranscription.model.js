// Zoom Transcription Model
// Author: Ashish Sahu - SAHIONEXT TECHNOLOGY PRIVATE LIMITED

const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const ZoomTranscription = sequelize.define('zoom_transcriptions', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: 'User ID who requested the transcription'
    },
    teacher_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: 'Teacher ID associated with the meeting'
    },
    class_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: 'Class ID associated with the meeting'
    },
    teacher_email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: 'Teacher email from Zoom'
    },
    meeting_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        comment: 'Zoom meeting ID'
    },
    meeting_topic: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: 'Zoom meeting topic/title'
    },
    meeting_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        comment: 'Date of the meeting (YYYY-MM-DD)'
    },
    meeting_time: {
        type: DataTypes.TIME,
        allowNull: true,
        comment: 'Time of the meeting (HH:MM:SS)'
    },
    time_range: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Time range filter used (e.g., 14:00 - 15:00)'
    },
    audio_file_name: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: 'Downloaded audio file name'
    },
    audio_file_size_mb: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0,
        comment: 'Audio file size in MB'
    },
    transcript: {
        type: DataTypes.TEXT('long'),
        allowNull: true,
        comment: 'Full transcription text'
    },
    transcript_length: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
        comment: 'Length of transcript in characters'
    },
    transcript_source: {
        type: DataTypes.STRING(50),
        allowNull: true,
        defaultValue: 'assemblyai',
        comment: 'Source of transcription (assemblyai, zoom, etc.)'
    },
    transcription_status: {
        type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
        comment: 'Current status of transcription'
    },
    processing_mode: {
        type: DataTypes.STRING(100),
        allowNull: true,
        defaultValue: 'audio_transcription',
        comment: 'Processing mode used'
    },
    transcription_service: {
        type: DataTypes.STRING(100),
        allowNull: true,
        defaultValue: 'AssemblyAI',
        comment: 'AI service used for transcription'
    },
    error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Error message if transcription failed'
    },
    processing_started_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When processing started'
    },
    processing_completed_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When processing completed'
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at'
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at'
    }
}, {
    tableName: 'zoom_transcriptions',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            name: 'idx_user_id',
            fields: ['user_id']
        },
        {
            name: 'idx_teacher_id',
            fields: ['teacher_id']
        },
        {
            name: 'idx_class_id',
            fields: ['class_id']
        },
        {
            name: 'idx_meeting_date',
            fields: ['meeting_date']
        },
        {
            name: 'idx_transcription_status',
            fields: ['transcription_status']
        },
        {
            name: 'idx_created_at',
            fields: ['created_at']
        }
    ]
});

module.exports = ZoomTranscription;