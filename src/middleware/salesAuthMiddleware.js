const jwt = require('jsonwebtoken');
const config = require('../config/config');
const Users = require('../models/users');

const salesAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ status: "error", message: "Missing token" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, config.jwtSecret);

    console.log('decoded',decoded);

    // ✅ Allow sales roles
    const user = await Users.findOne({
      where: {
        id: decoded.id,
        role_name: ['sales_role', 'sales_appointment_setter'], // allowed roles
      },
    });

    if (!user) {
      return res.status(403).json({
        status: "error",
        message: "Unauthorized access",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(401).json({ status: "error", message: "Invalid token" });
  }
};

module.exports=salesAuthMiddleware;