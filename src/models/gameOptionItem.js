const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const GameOptionItem = sequelize.define(
  'GameOptionItem',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },

    game_option_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },

    option_item: {
      type: DataTypes.JSON,
      allowNull: false,
      comment: 'Stores object like { key: "hobbies", value: "Hobbies & Interests" }'
    },

    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },

    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: 'game_option_items',
    timestamps: false,
    indexes: [
      { fields: ['game_option_id'] }
    ]
  }
);

module.exports = GameOptionItem;
