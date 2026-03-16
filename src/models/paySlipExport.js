const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const PayslipExport = sequelize.define(
  'PayslipExport',
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },

    period_start: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },

    period_end: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },

    status: {
      type: DataTypes.ENUM('processing', 'completed', 'failed'),
      defaultValue: 'processing'
    },

    file_path: {
      type: DataTypes.STRING(255),
      allowNull: true
    },

    error: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    requested_by: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },

    completed_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    tableName: 'payslip_exports',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);

module.exports = PayslipExport;
