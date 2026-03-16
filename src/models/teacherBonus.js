const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const Bonus = sequelize.define(
    "Bonus",
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },

      bonus_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },

      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.0,
      },

      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "bonuses",
      timestamps: true,
      underscored: true,
    }
  );

  module.exports = Bonus;