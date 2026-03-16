const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TopicTaught = sequelize.define(
    'TopicTaught',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        summary_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'class_summaries',
                key: 'id'
            }
        },
        topic_name: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        verified_by_teacher: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        points_awarded: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 5
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    },
    {
        tableName: 'topics_taught',
        timestamps: false,
        indexes: [
            {
                fields: ['summary_id']
            },
            {
                fields: ['verified_by_teacher']
            }
        ]
    }
);

module.exports = TopicTaught;