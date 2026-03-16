const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const CohortRetention = sequelize.define(
  "CohortRetention",
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },

    cohort_year: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    cohort_month: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    cohort_label: {
      type: DataTypes.STRING(7), // "2025-08"
      allowNull: false,
    },

    // Filtering dimensions
    lead_source: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    subscription_type: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    sales_rep_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    trial_booked_by_type: {
      type: DataTypes.STRING(50), // coordinator / website / app
      allowNull: true,
    },

    trial_coordinator_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    // Base cohort size
    total_users: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    // Active counts
    month_1_active: { type: DataTypes.INTEGER },
    month_2_active: { type: DataTypes.INTEGER },
    month_3_active: { type: DataTypes.INTEGER },
    month_4_active: { type: DataTypes.INTEGER },
    month_5_active: { type: DataTypes.INTEGER },
    month_6_active: { type: DataTypes.INTEGER },
    month_7_active: { type: DataTypes.INTEGER },
    month_8_active: { type: DataTypes.INTEGER },
    month_9_active: { type: DataTypes.INTEGER },
    month_10_active: { type: DataTypes.INTEGER },
    month_11_active: { type: DataTypes.INTEGER },
    month_12_active: { type: DataTypes.INTEGER },

    // Percentages
    month_1_percent: { type: DataTypes.DECIMAL(5, 2) },
    month_2_percent: { type: DataTypes.DECIMAL(5, 2) },
    month_3_percent: { type: DataTypes.DECIMAL(5, 2) },
    month_4_percent: { type: DataTypes.DECIMAL(5, 2) },
    month_5_percent: { type: DataTypes.DECIMAL(5, 2) },
    month_6_percent: { type: DataTypes.DECIMAL(5, 2) },
    month_7_percent: { type: DataTypes.DECIMAL(5, 2) },
    month_8_percent: { type: DataTypes.DECIMAL(5, 2) },
    month_9_percent: { type: DataTypes.DECIMAL(5, 2) },
    month_10_percent: { type: DataTypes.DECIMAL(5, 2) },
    month_11_percent: { type: DataTypes.DECIMAL(5, 2) },
    month_12_percent: { type: DataTypes.DECIMAL(5, 2) },
  },
  {
    tableName: "cohort_retention",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = CohortRetention;
