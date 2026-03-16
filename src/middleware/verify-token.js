// app/controllers/middleware.js

const jwt = require('jsonwebtoken');
const config = require('../config/config');

const authMiddleware = (req, res, next) => {
  const secretKey = config.jwtSecret; // Use the same secret key as in the authController.js
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: Token missing' });
  }

  jwt.verify(token.split(' ')[1], secretKey, (err, decodedToken) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    req.userId = decodedToken.id;
    next();
  });
};

module.exports = authMiddleware;
