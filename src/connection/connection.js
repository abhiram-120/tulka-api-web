const Sequelize = require('sequelize');
const config = require('../config/config');

const sequelize = new Sequelize(config.database, config.user, config.password, {
    host: config.host,
    port: 3306,
    dialect: 'mysql',
    pool: { max: 5, min: 0, idle: 1000 },
});
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