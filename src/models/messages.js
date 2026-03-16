const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');
const moment = require('moment');

const Messages = sequelize.define(
    'Messages',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        from_user: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        to_user: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        statu: {
            type: DataTypes.STRING(50),
            defaultValue: null
        },
        body: {
            type: DataTypes.TEXT,
            defaultValue: null
        },
        attachment_name:{
            type: DataTypes.STRING(255),
            defaultValue: null
        }

    },
    {
        tableName: 'messages',
        timestamps: true, // Enable timestamps
        createdAt: 'created_at', // Specify the field name for createdAt
        updatedAt: 'updated_at', // Specify the field name for updatedAt
        underscored: true
    }
);

// Export the model to use it in other parts of your application
module.exports = Messages;
