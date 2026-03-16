const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const PaymentLinks = sequelize.define('payment_links', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    short_id: {
        type: DataTypes.STRING(8),
        allowNull: false,
        unique: true,
        validate: {
            len: [8, 8],
            isAlphanumeric: true
        }
    },
    payment_data: {
        type: DataTypes.JSON,
        allowNull: false
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: false
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    accessed_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    access_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('active', 'expired', 'used'),
        defaultValue: 'active'
    }
}, {
    tableName: 'payment_links',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_bin',
    timestamps: false,
    underscored: true,
    indexes: [
        {
            unique: true,
            fields: ['short_id']
        },
        {
            fields: ['expires_at']
        },
        {
            fields: ['created_at']
        },
        {
            fields: ['status']
        }
    ]
});

module.exports = PaymentLinks;