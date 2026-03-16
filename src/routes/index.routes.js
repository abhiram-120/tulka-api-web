const express = require('express');
const router = express.Router();



// Admin routes
const adminAuthRoutes = require('./admin/auth.routes');
const adminUserRoutes = require('./admin/user.routes');
const adminGroupRoutes = require('./admin/group-user.routes');
const adminStudentRoutes = require('./admin/student.routes');
const adminSupportAgentRoutes = require('./admin/support-agent.routes');
const adminTeacherRoutes = require('./admin/teacher.routes');
const adminSalesRoutes = require('./admin/sales.routes');
const adminSubscriptionRoutes = require('./admin/subscription.routes');
const adminMonthlyClassRoutes = require('./admin/monthly-class.routes');
const adminAvailabilityRoutes = require('./admin/teacher-availability.routes');
const adminStudentsPortalRoutes = require('./admin/students-portal.routes');
const adminPaymentTransactionsRoutes = require('./admin/payment-transactions.routes');
const adminTrialTransferRoutes = require('./admin/trial-transfer.routes');
const adminQuestionBankRoutes = require('./admin/question-bank.routes');
// NOTE: Audio broadcasts are disabled in the Railway deploy because the
// corresponding model file is not present there and would crash the server.
// For local/dev where the model exists, you can re-enable this require and
// its route mapping below.
// const adminAudioBroadcastsRoutes = require('./admin/audio-broadcasts.routes');
const adminUserPlanRoutes = require('./admin/user-plan.routes');
const adminClassManagementRoutes = require('./admin/class-management.routes');
const adminTranzilaNotificationRoutes = require('./admin/tranzila-notifications.routes');
const adminDashboardRoutes = require('./admin/dashboard.routes');
const adminWebhookRoutes = require('./admin/webhook.routes');
const adminTrialManagementRoutes = require('./admin/trial-management.routes');
const adminProfileRoutes = require('./admin/admin-profile.routes');
const adminMasterSettingsRoutes = require('./admin/master-settings.route');
const adminFailedPaymentsRoutes = require('./admin/failed-payments.routes');
const adminAnnouncementsRoutes = require('./admin/announcements.routes');
const adminClassExtensionRoutes = require('./admin/class-extension.routes');
const adminCompensationGroup=require('./admin/compensationGroup.routes');
const adminTeacherSalaryProfile=require('./admin/teacherSalaryProfile.routes');
const adminTeacherBonus=require('./admin/teacherBonus.routes')
// ADD THIS LINE - Family Management routes
const adminFamilyManagementRoutes = require('./admin/family-management.routes');
const adminReferralsRoutes = require('./admin/referral.routes');
const adminRequestApproval=require('./admin/teacher-availaibility-approval.routes')
const adminTeacherHoliday=require('./admin/teacher-holiday-approval.routes');
const teacherPenalty=require('./admin/teacherPenalty.routes');
const adminTeacherPaySlip=require('./admin/teacherPaySlip.routes');
const adminSalaryAdjustment=require('./admin/teacherSalaryAdjustment.routes')
const adminEngagementRoutes = require('./admin/engagement.routes');
const adminTeacherPerformanceRoutes = require('./admin/teacher-performance.routes');
const adminSubscriptionChurnRoutes = require('./admin/subscription-churn.routes');
const { activityTracker } = require('../middleware/activityTracker');

// Sales routes
const salesAuthRoutes = require('./sales/auth.routes');
const teacherAvailabilityRoutes = require('./sales/teacher-availability.routes');
const trialClassRoutes = require('./sales/trial-class.routes');
const monthlyClassRoutes = require('./sales/monthly-class.routes');
const salesProfileRoutes = require('./sales/sales-profile.routes');
const paymentRoutes = require('./sales/payment.routes');
const familyPaymentRoutes = require('./sales/family-payment.routes');
const studentRoutes = require('./sales/student.routes');
const paymentCallbackRoutes = require('./sales/payment-callback.routes');
const familyPaymentCallbackRoutes = require('./sales/family-payment-callback.routes');
const trialTransferRoutes = require('./sales/trial-transfer.routes');
const tranzilaNotifyRoutes = require('./tranzila-notify');
const salesRecordsRoutes = require('./sales/sales-records.routes');

// User routes
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const reminderRoutes = require('./reminder.routes');
const pointSystemRoutes = require('./pointSystem.routes');

// Teacher routes
const teacherAuthRoutes = require('./teacher/auth.routes');
const teacherDashboardRoutes = require('./teacher/dashboard.routes');
const teacherMyStudentsRoutes = require('./teacher/mystudents.routes');
const teacherHolidayRoutes = require('./teacher/holiday.routes');
const teacherProfileRoutes = require('./teacher/teachers-profile.routes');
const teacherAvailRoutes = require('./teacher/teacher-availability.routes');
const teacherClassesRoutes = require('./teacher/teacher-classes.routes');
const teacherHomeworkRoutes = require('./teacher/teacher-homework.routes');
const familyRoutes = require('./sales/family.routes');
const teacherFeedbackRoutes = require('./teacher/teacher-feedback.routes');
const teacherGameApprovalRoutes = require('./teacher/game-approval.routes');
const classChangeRequest=require('./teacher/teacher-availaibility-request.routes');
const teacherEarnings=require('./teacher/teacher-earnings.routes');
const teacherAdvancedRequest=require('./teacher/advancedCashRequest.routes');


// Mobile routes
const mobileQuestionBankRoutes = require('./mobile/questionBank.routes');
const mobileTeachersRoutes = require('./mobile/teachers.routes');
const notificationRoutes = require('./notification.routes');

// AI routes
const adminZoomTranscriptionRoutes = require('./ai/zoom-transcription.routes');
const gameAiRoutes = require('./ai/game-ai.routes');
const assessmentRoutes = require('./ai/assessment.routes');


const referralRoutes = require('./referral.routes');

//? Risk Management Routes
const riskManagementRoutes = require('./admin/risk-management.routes');
const riskManagementAuditRoutes = require('./admin/risk-audit-management.routes');
const studentRiskEvent=require('./admin/student-risk-event.routes');
const RiskDashboard=require('./admin/riskDashboard.routes');
const riskTable=require('./admin/riskTable.routes');
const riskThreshold=require('./admin/riskThreshold.routes');
const savedView=require('./admin/savedView.routes');
const cancelCategory=require('./admin/cancellation-reason-category.routes');
const paymentRecoveryRoutes = require('./payment-recovery.routes');
const payPlusRoutes = require('./payplus.routes');

// Admin route mappings
router.use('/adminAuth', adminAuthRoutes);
router.use('/adminUser', adminUserRoutes);
router.use('/adminGroupUsers', adminGroupRoutes);
router.use('/adminStudents', adminStudentRoutes);
router.use('/adminSupportAgents', adminSupportAgentRoutes);
router.use('/adminTeachers', adminTeacherRoutes);
router.use('/adminSales', adminSalesRoutes);
router.use('/adminMonthlyClasses', adminMonthlyClassRoutes);
router.use('/adminAvailability', adminAvailabilityRoutes);
router.use('/adminStudentsPortal', adminStudentsPortalRoutes);
router.use('/adminSubscriptions', adminSubscriptionRoutes);
router.use('/adminPayments', adminPaymentTransactionsRoutes);
router.use('/adminTrialTransfers', adminTrialTransferRoutes);
router.use('/adminQuestionBank', adminQuestionBankRoutes);
// Audio broadcast routes temporarily disabled for cloud deploy stability.
// router.use('/adminAudioBroadcasts', adminAudioBroadcastsRoutes);
router.use('/adminUserPlans', adminUserPlanRoutes);
router.use('/adminClasses', adminClassManagementRoutes);
router.use('/adminTranzilaNotifications', adminTranzilaNotificationRoutes);
router.use('/adminDashboard', adminDashboardRoutes);
router.use('/adminWebhook', adminWebhookRoutes);
router.use('/adminTrialManagement', adminTrialManagementRoutes);
router.use('/adminRequestApproval',adminRequestApproval);
router.use('/adminProfile', adminProfileRoutes);
router.use('/adminMasterSetting', adminMasterSettingsRoutes);
router.use('/adminFailedPayments', adminFailedPaymentsRoutes);
router.use('/cancel-category',cancelCategory);
router.use('/adminAnnouncements', adminAnnouncementsRoutes);
router.use('/adminClassExtension', adminClassExtensionRoutes);
// ADD THIS LINE - Mount family management routes
router.use('/adminFamily', adminFamilyManagementRoutes);
router.use('/adminReferrals', adminReferralsRoutes);
router.use('/adminTeacherHoliday',adminTeacherHoliday);
router.use('/adminCompensationGroup',adminCompensationGroup);
router.use('/adminTeacherPenalty',teacherPenalty);
router.use('/adminTeacherSalaryProfile',adminTeacherSalaryProfile);
router.use('/adminTeacherPaySlip',adminTeacherPaySlip);
router.use('/adminTeacherSalaryAdjustment',adminSalaryAdjustment);
router.use('/adminTeacherBonus',adminTeacherBonus);
router.use('/adminEngagement', adminEngagementRoutes);
router.use('/adminTeacherPerformance', adminTeacherPerformanceRoutes);
router.use('/adminSubscriptionChurn', adminSubscriptionChurnRoutes);

// Sales route mappings
router.use('/sales/auth', salesAuthRoutes);
router.use('/sales/availability', teacherAvailabilityRoutes);
router.use('/sales/trial-classes', trialClassRoutes);
router.use('/sales/monthly-classes', monthlyClassRoutes);
router.use('/sales/students', studentRoutes);
router.use('/sales/profile', salesProfileRoutes);
router.use('/sales/payment', paymentRoutes);
router.use('/sales/familyPayment', familyPaymentRoutes);
router.use('/sales/payment-callback', paymentCallbackRoutes);
router.use('/sales/family-payment-callback', familyPaymentCallbackRoutes);
router.use('/sales/trial-transfer', trialTransferRoutes);
router.use('/sales/family', familyRoutes);
router.use('/sales/sales-records', salesRecordsRoutes);

// Tranzila notification route
router.use('/tranzila-notify', tranzilaNotifyRoutes);

// User route mappings (with activity tracking for students)
router.use('/auth', authRoutes);
router.use('/user', activityTracker, userRoutes);
router.use('/reminder', reminderRoutes);
router.use('/point/system', activityTracker, pointSystemRoutes);

// Teacher route mappings
router.use('/teacher/auth', teacherAuthRoutes);
router.use('/teacher/classes', teacherDashboardRoutes);
router.use('/teacher/classes-list', teacherClassesRoutes);
router.use('/teacher/my-students', teacherMyStudentsRoutes);
router.use('/teacher/holidays', teacherHolidayRoutes);
router.use('/teacher/profile', teacherProfileRoutes);
router.use('/teacher/availability', teacherAvailRoutes);
router.use('/teacher/availabilityRequest',classChangeRequest);
router.use('/teacher/homework', teacherHomeworkRoutes);
router.use('/teacher/feedback', teacherFeedbackRoutes);
router.use('/teacher/game-approval', teacherGameApprovalRoutes);
router.use('/teacher/earnings',teacherEarnings);
router.use('/teacher/advance',teacherAdvancedRequest);


// In-app notifications for students
router.use('/notifications', activityTracker, notificationRoutes);

// Mobile route mappings (with activity tracking for students)
router.use('/mobile/questionBank', activityTracker, mobileQuestionBankRoutes);
router.use('/mobile/teachers', activityTracker, mobileTeachersRoutes);

// AI route mappings
router.use('/ai/zoom-transcription', adminZoomTranscriptionRoutes);
router.use('/ai/games', gameAiRoutes);
router.use('/ai/assessment', assessmentRoutes);

router.use('/referral', referralRoutes);


//? Risk Rule Route Mappings
router.use('/admin/risk-rule', riskManagementRoutes);
router.use('/admin/risk-rule-audit', riskManagementAuditRoutes);
router.use('/admin/student-risk',studentRiskEvent);
router.use('/admin/risk',RiskDashboard);
router.use('/admin/risk-table',riskTable)
router.use('/admin/threshold',riskThreshold)
router.use('/admin/saved-view',savedView);

// Payment recovery routes (public access)
router.use('/payment-recovery', paymentRecoveryRoutes);

// Public PayPlus helper routes (no auth)
router.use('/payplus', payPlusRoutes);

// Handle 404 routes
router.use('*', (req, res) => {
    res.status(404).json({
        status: 'error',
        message: 'Route not found'
    });
});

// route module exports
module.exports = router;
