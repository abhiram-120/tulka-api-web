const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const GroupUser = sequelize.define('GroupUser', {
    id: {
        type: DataTypes.INTEGER(10).UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    group_id: {
        type: DataTypes.INTEGER(10).UNSIGNED,
        allowNull: false
    },
    user_id: {
        type: DataTypes.INTEGER(10).UNSIGNED,
        allowNull: false
    },
    created_at: {
        type: DataTypes.INTEGER(10).UNSIGNED,
        allowNull: false
    }
}, {
    tableName: 'group_users',
    timestamps: false
});

module.exports = GroupUser;