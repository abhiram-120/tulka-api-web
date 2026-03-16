const jwt = require('jsonwebtoken');
const config = require('../config/config');
const Users = require('../models/users');

const salesAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        status: 'error',
        message: 'Authorization header missing or invalid format' 
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwtSecret);

    const user = await Users.findOne({ 
      where: { 
        id: decoded.id,
        role_name: ['sales_role', 'sales_appointment_setter']
      }
    });

    if (!user) {
      return res.status(403).json({ 
        status: 'error',
        message: 'Unauthorized access' 
      });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({
        status: 'error',
        message: 'Account is inactive'
      });
    }

    req.user = user;
    req.userId = decoded.id;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ 
        status: 'error',
        message: 'Invalid token' 
      });
    }
    
    return res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
};

module.exports = salesAuthMiddleware;