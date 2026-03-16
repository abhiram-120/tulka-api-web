const { body, check } = require('express-validator');

// Validation rules for creating a user
const validateUserStore = [
    body('full_name')
        .isLength({ min: 3, max: 128 })
        .withMessage('Full name must be between 3 and 128 characters'),
    
    body('role_id')
        .notEmpty()
        .withMessage('Role ID is required')
        .isInt()
        .withMessage('Role ID must be an integer'),
    
    body('password')
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters long'),
    
    body('status')
        .notEmpty()
        .withMessage('Status is required'),
    
    // Validate either email or mobile is present
    check()
        .custom((value, { req }) => {
            if (!req.body.email && !req.body.mobile) {
                throw new Error('Either email or mobile is required');
            }
            return true;
        }),
    
    body('email')
        .optional()
        .isEmail()
        .withMessage('Invalid email format')
        .normalizeEmail(),
    
    body('mobile')
        .optional()
        .isNumeric()
        .withMessage('Mobile number must contain only numbers'),
    
    body('group_id')
        .if(body('group_id').exists().notEmpty())  // Only validate if group_id exists and is not empty
        .isInt()
        .withMessage('Group ID must be an integer')
];

module.exports = {
    validateUserStore
};