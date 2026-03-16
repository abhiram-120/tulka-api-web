// D:\tulkka-App-V2\tulkka-api-v2\src\middleware\verify-token.js
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const Users = require('../models/users');

const SUPPORT_ROLES = ['support_agent', 'senior_support', 'support_lead'];
const ADMIN_ROLE = 'admin';
const ALLOWED_ROLES = [ADMIN_ROLE, ...SUPPORT_ROLES];

const authMiddleware = async (req, res, next) => {
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

    // Verify if user exists and is allowed
    const user = await Users.findOne({ 
      where: { 
        id: decoded.id,
        role_name: ALLOWED_ROLES
      }
    });

    if (!user) {
      return res.status(403).json({ 
        status: 'error',
        message: 'Unauthorized access' 
      });
    }

    const roleName = user.role_name;
    req.user = user;
    req.userId = decoded.id;
    req.isAdmin = roleName === ADMIN_ROLE;
    req.isSupportAgent = SUPPORT_ROLES.includes(roleName);
    req.supportRole = roleName;
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

module.exports = authMiddleware;