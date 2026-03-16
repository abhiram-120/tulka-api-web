const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TeacherSalaryAdjustment = sequelize.define(
  'TeacherSalaryAdjustment',
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    teacher_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },

    type: {
      type: DataTypes.ENUM('bonus', 'penalty'),
      allowNull: false,
    },

    applied_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    value: {
      type: DataTypes.JSON,
      allowNull: false,
    },
  },
  {
    tableName: 'teacher_salary_adjustments',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

module.exports = TeacherSalaryAdjustment;
