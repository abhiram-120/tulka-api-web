const { body } = require('express-validator');

const validateGroupUserStore = [
    body('group_id')
        .notEmpty()
        .withMessage('Group ID is required')
        .isInt()
        .withMessage('Group ID must be an integer'),
    
    body('user_id')
        .notEmpty()
        .withMessage('User ID is required')
        .isInt()
        .withMessage('User ID must be an integer')
];

module.exports = {
    validateGroupUserStore
};