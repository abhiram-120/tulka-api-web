const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const Homework = sequelize.define(
    'homework',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        lesson_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        student_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        teacher_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        student_answers: {
            type: DataTypes.TEXT('long'),
            charset: 'utf8mb4',
            collate: 'utf8mb4_unicode_ci'
        },
        answer_attachment: {
            type: DataTypes.STRING(255),
            charset: 'utf8mb4',
            collate: 'utf8mb4_unicode_ci',
            allowNull: true
        },
        title: {
            type: DataTypes.STRING(255),
            charset: 'utf8mb4',
            collate: 'utf8mb4_unicode_ci',
            allowNull: true
        },
        status: {
            type: DataTypes.STRING(100),
            charset: 'utf8mb4',
            collate: 'utf8mb4_unicode_ci',
            allowNull: true
        },
        result: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        description: {
            type: DataTypes.TEXT('long'),
            charset: 'utf8mb4',
            collate: 'utf8mb4_unicode_ci'
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        teacher_notes: {
            type: DataTypes.TEXT,
            charset: 'utf8mb4',
            collate: 'utf8mb4_unicode_ci'
        },
        attachment: {
            type: DataTypes.STRING(255),
            charset: 'utf8mb4',
            collate: 'utf8mb4_unicode_ci',
            allowNull: true
        },
        image: {
            type: DataTypes.STRING(255),
            field: 'homeworkImage',
            charset: 'utf8mb4',
            collate: 'utf8mb4_unicode_ci',
            allowNull: true
        },
        toggle_attachment_for_student: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1
        },
        toggle_description_for_student: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1
        }
    },
    {
        tableName: 'homeworks',
        timestamps: false,
        underscored: true,
        collate: 'utf8mb4_unicode_ci'
    }
);

module.exports = Homework;
