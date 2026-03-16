// models/DirectPaymentCustomer.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const DirectPaymentCustomer = sequelize.define('DirectPaymentCustomer', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    page_request_uid: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        comment: 'PayPlus page request UID'
    },
    
    // Customer Information
    first_name: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    last_name: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    email: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    phone: {
        type: DataTypes.STRING(20),
        allowNull: false
    },
    country_code: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: '+972'
    },
    language: {
        type: DataTypes.STRING(5),
        allowNull: false,
        defaultValue: 'HE'
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    
    // Payment Details
    payment_amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    currency: {
        type: DataTypes.STRING(5),
        allowNull: false,
        defaultValue: 'ILS'
    },
    lesson_minutes: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    lessons_per_month: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    duration_months: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    },
    is_recurring: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    
    // Plan Information
    plan_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    duration_type: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    
    // Sales Information
    salesperson_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    
    // Payment Status
    payment_status: {
        type: DataTypes.ENUM('pending', 'paid', 'failed', 'expired'),
        defaultValue: 'pending'
    },
    payment_url: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    payment_date: {
        type: DataTypes.DATE,
        allowNull: true
    },
    transaction_id: {
        type: DataTypes.STRING(255),
        allowNull: true
    }
}, {
    tableName: 'direct_payment_customers',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['page_request_uid']
        },
        {
            fields: ['email']
        },
        {
            fields: ['phone']
        },
        {
            fields: ['payment_status']
        },
        {
            fields: ['salesperson_id']
        },
        {
            fields: ['created_at']
        }
    ]
});

// Define associations
DirectPaymentCustomer.associate = (models) => {
    // Association with User (salesperson)
    DirectPaymentCustomer.belongsTo(models.User, {
        foreignKey: 'salesperson_id',
        as: 'Salesperson'
    });
};

module.exports = DirectPaymentCustomer;