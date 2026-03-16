// Generate a 5-digit OTP
async function generateOTP() {
    let otp = '';
    for (let i = 0; i < 5; i++) {
        otp += Math.floor(Math.random() * 10);
    }
    return otp;
}

module.exports = generateOTP;
