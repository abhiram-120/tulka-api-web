const { DataTypes } = require('sequelize');
const sequelize = require('../connection/connection');

const AuditLog = sequelize.define(
  'AuditLog',
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true
    },

    entity_type: {
      type: DataTypes.STRING(50),
      allowNull: false
    },

    entity_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },

    action: {
      type: DataTypes.STRING(50),
      allowNull: false
    },

    before_value: {
      type: DataTypes.JSON,
      allowNull: true
    },

    after_value: {
      type: DataTypes.JSON,
      allowNull: true
    },

    admin_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    }
  },
  {
    tableName: 'audit_logs',
    timestamps: true,
    updatedAt: false,
    underscored: true
  }
);

module.exports = AuditLog;
