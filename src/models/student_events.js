const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const StudentEvents = sequelize.define(
    'student_events',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            references: { model: 'User', key: 'id' }
        },
        event_type: {
            type: DataTypes.STRING,
            allowNull: false
        },
        description: {
            type: DataTypes.STRING,
            allowNull: false
        },
        points: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        valid_until: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        reported_by: {
            type: DataTypes.STRING,
            allowNull: false
        },
        event_source: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'auto'
        }
    },
    { tableName: 'student_events', timestamps: true, underscored: true, createdAt: 'created_at', updatedAt: 'updated_at' }
);

module.exports = StudentEvents;
