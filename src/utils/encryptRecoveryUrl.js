const crypto = require('crypto');

// Encryption key - should be stored in environment variables
// Generate a key using: crypto.randomBytes(32).toString('hex')
const ENCRYPTION_KEY = process.env.RECOVERY_URL_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // For AES, this is always 16
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;

/**
 * Encrypt a payment ID for use in recovery URL
 * @param {string|number} paymentId - The past due payment ID to encrypt
 * @returns {string} - Base64 encoded encrypted string (URL safe)
 */
const encryptRecoveryUrl = (paymentId) => {
    try {
        // Convert payment ID to string
        const text = String(paymentId);
        
        // Generate random IV for each encryption
        const iv = crypto.randomBytes(IV_LENGTH);
        
        // Derive key from encryption key using PBKDF2
        const salt = crypto.randomBytes(SALT_LENGTH);
        const key = crypto.pbkdf2Sync(ENCRYPTION_KEY, salt, 100000, 32, 'sha256');
        
        // Create cipher
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        
        // Encrypt the text
        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        
        // Get authentication tag
        const tag = cipher.getAuthTag();
        
        // Combine salt + iv + tag + encrypted data
        const combined = Buffer.concat([
            salt,
            iv,
            tag,
            Buffer.from(encrypted, 'base64')
        ]);
        
        // Return base64 encoded (URL safe)
        return combined.toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
            
    } catch (error) {
        console.error('Error encrypting recovery URL:', error);
        throw new Error('Encryption failed');
    }
};

/**
 * Decrypt a payment ID from recovery URL
 * @param {string} encryptedText - The encrypted string from URL
 * @returns {string} - Decrypted payment ID
 */
const decryptRecoveryUrl = (encryptedText) => {
    try {
        // Restore base64 padding and convert URL safe characters back
        let base64 = encryptedText
            .replace(/-/g, '+')
            .replace(/_/g, '/');
        
        // Add padding if needed
        while (base64.length % 4) {
            base64 += '=';
        }
        
        // Convert to buffer
        const combined = Buffer.from(base64, 'base64');
        
        // Extract components
        const salt = combined.slice(0, SALT_LENGTH);
        const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
        const tag = combined.slice(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
        const encrypted = combined.slice(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
        
        // Derive key from encryption key using same salt
        const key = crypto.pbkdf2Sync(ENCRYPTION_KEY, salt, 100000, 32, 'sha256');
        
        // Create decipher
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        
        // Decrypt
        let decrypted = decipher.update(encrypted, null, 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
        
    } catch (error) {
        console.error('Error decrypting recovery URL:', error);
        throw new Error('Decryption failed - invalid or corrupted token');
    }
};

module.exports = {
    encryptRecoveryUrl,
    decryptRecoveryUrl
};

