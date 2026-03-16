const Sequelize = require('sequelize');
const mysql2 = require('mysql2');
const config = require('../config/config');

const sequelize = new Sequelize(
    config.database,
    config.user,
    config.password,
    {
        host: config.host,
        port: Number(process.env.DB_PORT || 3306),
        dialect: 'mysql',
        dialectModule: mysql2,
        pool: { max: 5, min: 0, idle: 1000 },
        logging: false,
    }
);
const connection = async () => {
    try {
        await sequelize.authenticate();
        console.log(`Connection established`);
    } catch (err) {
        console.log(`Error in connection: ${err}`);
    }
};

// Export the function
module.exports = { connection, sequelize };