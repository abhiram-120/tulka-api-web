const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const StudentClassQuery = sequelize.define('student_class_query', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    class_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    student_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    query_text: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    attachment: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    query_link: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false,
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false,
    },
}, {
    tableName: 'student_class_queries',
    timestamps: false, // Set to true if you want Sequelize to manage createdAt and updatedAt fields
    engine: 'InnoDB', // Specify the table engine if needed
    charset: 'utf8mb3', // Specify the character set if needed
    // Other model options go here
});

module.exports = StudentClassQuery;