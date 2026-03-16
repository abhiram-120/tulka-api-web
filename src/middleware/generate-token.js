const jwt = require('jsonwebtoken');
const config = require('../config/config');

const generateToken = (id) => {
    const secretKey = config.jwtSecret; // secret key
    return jwt.sign({ id }, secretKey, { expiresIn: '365d' }); // Token expires in 1 year
};

module.exports = generateToken;
