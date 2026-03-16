const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const ReferralLink = sequelize.define(
    'ReferralLink',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        invite_code: {
            type: DataTypes.STRING(50),
            allowNull: false,
            unique: true
        },
        invite_url: {
            type: DataTypes.STRING(500),
            allowNull: false,
            unique: true
        },
        created_at: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: () => Math.floor(Date.now() / 1000)
        },
        last_refreshed_at: {
            type: DataTypes.BIGINT,
            allowNull: true
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        refresh_count: {
            type: DataTypes.INTEGER.UNSIGNED,
            defaultValue: 0
        }
    },
    
    {
        tableName: 'referral_links',
        timestamps: false,
        underscored: true
    }
);

module.exports = ReferralLink;