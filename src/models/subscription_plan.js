const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const SubscriptionPlan = sequelize.define('subscription_plans', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    duration_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'subscription_durations',
            key: 'id'
        }
    },
    lesson_length_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'lesson_lengths',
            key: 'id'
        }
    },
    lessons_per_month_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'lessons_per_month',
            key: 'id'
        }
    },
    price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('active', 'inactive'),
        defaultValue: 'active'
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'subscription_plans',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_bin',
    timestamps: false,
    underscored: true
});

module.exports = SubscriptionPlan;