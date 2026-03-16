const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const ClassReminder = sequelize.define('class_reminder', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    lesson_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    notif_key: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    status: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    type: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    related: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
}, {
    tableName: 'class_reminders',
    timestamps: false, // Set to true if you want Sequelize to manage createdAt and updatedAt fields
    engine: 'InnoDB', // Specify the table engine if needed
    charset: 'utf8mb3', // Specify the character set if needed
    // Other model options go here
});

// Sync the model with the database
// Note: You need to call this somewhere in your code to create the table if it doesn't exist
// sequelize.sync();

module.exports = ClassReminder;
