const { DataTypes } = require("sequelize");
const { sequelize } = require("../connection/connection");

const RiskRulesAudit = sequelize.define(
  "risk_rules_audit",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    risk_rule_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false, 
    },
    action: {
      type: DataTypes.ENUM("CREATE", "UPDATE", "DELETE"),
      allowNull: false,
    },
    changed_by: {
      type: DataTypes.INTEGER.UNSIGNED, // FK to user table if available
      allowNull: true,
    },
    previous_data: {
      type: DataTypes.JSON, // store old rule values
      allowNull: true,
    },
    new_data: {
      type: DataTypes.JSON, // store new rule values
      allowNull: true,
    },
  },
  {
    tableName: "risk_rules_audit",
    timestamps: true,
    underscored: true,
    createdAt: "created_at",
    updatedAt: false,
  }
);

module.exports = RiskRulesAudit;
