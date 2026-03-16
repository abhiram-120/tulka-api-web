/**
 * Example usage of encryptRecoveryUrl and decryptRecoveryUrl
 * 
 * This file demonstrates how to encrypt and decrypt payment IDs for recovery URLs
 */

const { encryptRecoveryUrl, decryptRecoveryUrl } = require('./encryptRecoveryUrl');

// Example 1: Encrypt a payment ID
const paymentId = 23;
const encryptedId = encryptRecoveryUrl(paymentId);
console.log('Original Payment ID:', paymentId);
console.log('Encrypted ID:', encryptedId);
// Output: Encrypted ID will be a long base64 string like: "aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789..."

// Example 2: Create the recovery URL
const frontendUrl = 'https://devmanage.tulkka.com';
const recoveryUrl = `${frontendUrl}/payment/recovery/${encryptedId}`;
console.log('Recovery URL:', recoveryUrl);
// Output: https://devmanage.tulkka.com/payment/recovery/aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789...

// Example 3: Decrypt the payment ID from URL
// When you receive the encrypted ID from the URL parameter, decrypt it:
const encryptedIdFromUrl = encryptedId; // This comes from req.params.id
try {
    const decryptedPaymentId = decryptRecoveryUrl(encryptedIdFromUrl);
    console.log('Decrypted Payment ID:', decryptedPaymentId);
    // Output: Decrypted Payment ID: 23
    
    // Now you can use the decrypted ID to query the database
    // const pastDuePayment = await PastDuePayment.findByPk(decryptedPaymentId);
    
} catch (error) {
    console.error('Decryption failed:', error.message);
    // Handle invalid or corrupted token
}

// Example 4: In a controller/route handler
/*
const getRecoveryPageData = async (req, res) => {
    try {
        const { id } = req.params; // This is the encrypted ID from URL
        
        // Decrypt the payment ID
        let paymentId;
        try {
            paymentId = decryptRecoveryUrl(id);
        } catch (decryptError) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid recovery link. The link may be corrupted or expired.'
            });
        }
        
        // Use the decrypted ID to find the payment
        const pastDuePayment = await PastDuePayment.findByPk(paymentId);
        
        if (!pastDuePayment) {
            return res.status(404).json({
                status: 'error',
                message: 'Failed payment not found'
            });
        }
        
        // Return the payment data
        return res.status(200).json({
            status: 'success',
            data: { payment: pastDuePayment }
        });
        
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
};
*/

// Example 5: Error handling
const testInvalidToken = () => {
    try {
        const invalidToken = 'invalid-token-123';
        const decrypted = decryptRecoveryUrl(invalidToken);
        console.log('This should not print');
    } catch (error) {
        console.log('Caught expected error:', error.message);
        // Output: Caught expected error: Decryption failed - invalid or corrupted token
    }
};

// Run examples
if (require.main === module) {
    console.log('=== Encryption/Decryption Examples ===\n');
    
    console.log('Example 1: Basic encryption/decryption');
    const testId = 123;
    const encrypted = encryptRecoveryUrl(testId);
    const decrypted = decryptRecoveryUrl(encrypted);
    console.log(`Original: ${testId} -> Encrypted: ${encrypted.substring(0, 50)}... -> Decrypted: ${decrypted}`);
    console.log(`Match: ${testId === parseInt(decrypted) ? '✓' : '✗'}\n`);
    
    console.log('Example 2: URL generation');
    const url = `https://devmanage.tulkka.com/payment/recovery/${encrypted}`;
    console.log(`Recovery URL: ${url}\n`);
    
    console.log('Example 3: Error handling');
    testInvalidToken();
}

module.exports = {
    encryptRecoveryUrl,
    decryptRecoveryUrl
};

