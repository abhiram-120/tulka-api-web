const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const RiskThresholds = sequelize.define('RiskThresholds', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  critical: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 100,
  },
  high: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 70,
  },
  medium: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 40,
  },
  low:{
    type:DataTypes.FLOAT,
    allowNull:false,
    defaultValue:20
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'risk_thresholds',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = RiskThresholds;
