const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const BonusRule = sequelize.define(
    'BonusRule',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      compensation_group_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      bonus_code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },

      bonus_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },

      bonus_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },

      min_lifetime_lessons: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      min_monthly_hours: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
        defaultValue: 0,
      },

      min_retention_rate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
        validate: {
          min: 0,
          max: 100,
        },
      },

      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: 'bonus_rules',
      timestamps: true,
      underscored: true,
      paranoid: false,
      indexes: [
        {
          unique: true,
          fields: ['bonus_code'],
        },
      ],
    }
  );

  module.exports=BonusRule;


//   BonusRule.associate = (models) => {
//     BonusRule.belongsTo(models.CompensationGroup, {
//       foreignKey: 'compensation_group_id',
//       onDelete: 'RESTRICT',
//     });
//   };