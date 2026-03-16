const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TeacherVerification = sequelize.define(
    'TeacherVerification',
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
        teacher_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        total_points: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        teacher_notes: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        verified_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    },
    {
        tableName: 'teacher_verifications',
        timestamps: false,
        indexes: [
            {
                unique: true,
                fields: ['class_id']
            },
            {
                fields: ['teacher_id']
            }
        ]
    }
);

module.exports = TeacherVerification;