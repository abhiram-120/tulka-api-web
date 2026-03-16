const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const RiskTableAuditLog = sequelize.define('risk_audit_logs', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  risk_id: {
    type: DataTypes.INTEGER,
    allowNull: true 
  },
  action: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  changed_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  previous_data: {
    type: DataTypes.JSON,
    allowNull: true
  },
  new_data: {
    type: DataTypes.JSON,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'risk_audit_logs',
  timestamps: false
});

module.exports = RiskTableAuditLog;
