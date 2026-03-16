const express = require('express');
const authController = require('../controller/auth.controller');
const AuthValidator = require('../middleware/verify-token');
const router = express.Router();
const config = require('../config/config');

const multer = require('multer');
const AWS = require('aws-sdk');
const AWS_REGION = 'eu-central-1';
const multerS3 = require('multer-s3');

AWS.config.update({
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    region: AWS_REGION
});

const s3 = new AWS.S3();

// upload homework's files
const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: config.AWS_BUCKET,
        acl: 'public-read-write', // Set ACL
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key: function (req, file, cb) {
            cb(
                null,
                'profile-images/' + 'avatar/' + file.originalname
                // "profile-images/" + file.originalname
            );
        }
    })
});

router.post('/student-register', authController.registerStudent);
router.post('/student-registerv2', authController.registerStudentV2);
router.post('/kid-register', AuthValidator,authController.registerKid);
router.patch('/verify-account', AuthValidator, authController.verifyAccount);
router.patch('/update-profile', upload.single('profile_image'), AuthValidator, authController.updateProfile);
router.post('/student-login', authController.loginStudent);
router.post('/student-loginv2', authController.loginStudentV2);
router.post('/forgot/password', authController.forgotPassword);
router.patch('/verify/otp', AuthValidator, authController.verifyOTP);
router.post('/resend/otp', authController.resendOTP);
router.patch('/reset/password', AuthValidator, authController.resetPassword);
router.post('/get-byemail', authController.getUserByEmail);
router.get('/get-kids', AuthValidator, authController.getKidFromParent);
router.post('/switch-kids', AuthValidator, authController.switchKidsAssignment);
router.get('/get-all-kids', AuthValidator, authController.getAllKidFromParent);
router.post('/kid-login', AuthValidator, authController.loginKid);
router.post('/student-logout', AuthValidator, authController.logoutUser);
router.post('/send-otp', AuthValidator, authController.sendOtpToMobile);
router.post('/verify/mobileOtp', AuthValidator, authController.verifyMobileOTP);
router.post('/resend/mobileOtp', AuthValidator, authController.resendMobileOTP);
router.post('/student-google-register', authController.registerStudentWithGoogle);
router.post('/student-apple-register', authController.registerStudentWithApple);
router.post('/student-facebook-register', authController.registerStudentWithFacebook);
router.get('/app-colors', authController.getAppColors);
router.get('/api/mobile/app-settings', authController.getAppColors);
// Test FCM notification route
router.post('/test-fcm-notification', authController.testFCMNotification);

/** module exports */
module.exports = router;
