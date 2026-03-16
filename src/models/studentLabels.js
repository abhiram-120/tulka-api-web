const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const StudentLabels = sequelize.define(
    'student_labels',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        label_key: {
            type: DataTypes.STRING,
            allowNull: false
        },
        label_value: {
            type: DataTypes.STRING,
            allowNull: false
        },
        valid_until: {
            type: DataTypes.INTEGER,
            allowNull: false
        }
    },
    { tableName: 'student_labels', timestamps: true, underscored: true, createdAt: 'created_at', updatedAt: 'updated_at' }
);

module.exports=StudentLabels;