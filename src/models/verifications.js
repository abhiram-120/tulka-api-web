const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection'); // Replace with the actual Sequelize instance

const Verifications = sequelize.define(
    'verifications',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            defaultValue: null
        },
        mobile: {
            type: DataTypes.CHAR(16),
            charset: 'utf8mb4',
            collate: 'utf8mb4_unicode_ci',
            defaultValue: null
        },
        email: {
            type: DataTypes.CHAR(64),
            charset: 'utf8mb4',
            collate: 'utf8mb4_unicode_ci',
            defaultValue: null
        },
        code: {
            type: DataTypes.CHAR(6),
            charset: 'utf8mb4',
            collate: 'utf8mb4_unicode_ci',
            allowNull: false
        },
        verified_at: {
            type: DataTypes.INTEGER.UNSIGNED,
            defaultValue: null
        },
        expired_at: {
            type: DataTypes.INTEGER.UNSIGNED,
            defaultValue: null,
            defaultValue: () => {
                const tenMinutesInMilliseconds = 60 * 60 * 1000; // 10 minutes in milliseconds
                const createdTimestamp = Math.floor(Date.now() / 1000);
                return createdTimestamp + tenMinutesInMilliseconds / 1000;
            }
        },
        created_at: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: () => Math.floor(Date.now() / 1000)
        }
    },
    {
        tableName: 'verifications',
        engine: 'InnoDB',
        indexes: [
            {
                name: 'verifications_user_id_foreign',
                fields: ['user_id'],
                using: 'BTREE'
            }
        ],
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
        timestamps: false // If you want timestamps (createdAt, updatedAt), set this to true
    }
);

// Define any associations, hooks, or other model methods here

module.exports = Verifications;
