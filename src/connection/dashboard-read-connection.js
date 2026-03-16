const Sequelize = require('sequelize');
const { sequelize } = require('./connection');
require('dotenv').config();

const useLiveDashboardDb = String(process.env.DASHBOARD_DEMO_USE_LIVE || '').toLowerCase() === 'true';

let dashboardSequelize = sequelize;

if (useLiveDashboardDb) {
    dashboardSequelize = new Sequelize(
        process.env.DASHBOARD_DB_NAME,
        process.env.DASHBOARD_DB_USER,
        process.env.DASHBOARD_DB_PASSWORD,
        {
            host: process.env.DASHBOARD_DB_HOST,
            port: Number(process.env.DASHBOARD_DB_PORT || 3306),
            dialect: 'mysql',
            pool: { max: 5, min: 0, idle: 1000 },
            logging: false,
        }
    );
}

module.exports = { dashboardSequelize, useLiveDashboardDb };
