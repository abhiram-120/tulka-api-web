const bcrypt = require('bcrypt');

const securePassword = async (password) => {
    try {
        const passwordHash = await bcrypt.hash(password, 10);
        return passwordHash;
    } catch (error) {
        // Let the error propagate to the caller
        throw new Error('Password hashing failed');
    }
};

module.exports = securePassword;