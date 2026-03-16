const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const SavedView = sequelize.define(
  'SavedView',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    config: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    is_default: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  },
  {
    tableName: 'saved_views', // ✅ use plural lowercase (Sequelize convention)
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at', // ✅ rename for consistency instead of `true`
  }
);

module.exports = SavedView;
