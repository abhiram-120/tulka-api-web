const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');
const moment = require('moment');

const PubnubChat = sequelize.define(
    'PubnubChat',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        student_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        teacher_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        channel_name: {
            type: DataTypes.STRING(50),
            defaultValue: null
        },

    },
    {
        tableName: 'pubnub_chat',
        timestamps: true, // Enable timestamps
        createdAt: 'created_at', // Specify the field name for createdAt
        updatedAt: 'updated_at', // Specify the field name for updatedAt
        underscored: true
    }
);

// Export the model to use it in other parts of your application
module.exports = PubnubChat;
