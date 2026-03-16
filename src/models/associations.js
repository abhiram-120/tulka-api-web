// models/associations.js
const { Op } = require('sequelize');
const User = require('./users');
const UserSubscriptionDetails = require('./UserSubscriptionDetails');
const Class = require('./classes');
const Sale = require('./Salesperson');
const UserOccupation = require('./usersOccupation');
const TeacherAvailability = require('./teacherAvailability');
const TeacherHoliday = require('./teacherHoliday');
const UserReview = require('./userReviews');
const Salesperson = require('./Salesperson');
const RegularClass = require('./regularClass');
const ClassBookingFailure = require('./classBookingFailures');
const ReferralLink = require('./ReferralLink');
const ReferralTier = require('./ReferralTier');
const Referral = require('./Referral');
const ReferralReward = require('./ReferralReward');
const UserReferralSettings = require('./UserReferralSettings');
const ReferralNotification = require('./ReferralNotification');
const ReferralFraudLog = require('./ReferralFraudLog');
const ReferralRetentionTracking = require('./ReferralRetentionTracking');
const {ReferralTierClaim} = require('./ReferralTierClaim');
const TrialClassRegistration = require('./trialClassRegistration');
const TrialClassStatusHistory = require('./TrialClassStatusHistory');
const TrialClassEvaluation = require('./TrialClassEvaluation');
const SalesAgentReview = require('./salesAgentReview');
const TranslationFile = require("./translationFile");
const TranslationWord = require("./translationWord");

const PracticeSession = require("./practiceSession");
const PracticeResult = require("./practiceResult");
const WordPracticed = require("./wordPracticed");
const PracticeMode = require("./practiceMode");
const MemoryGameProgress = require("./memoryGameProgress");
const QuizQuestion = require("./quizQuestion");
const QuizOption = require("./quizOption");
const FillBlankQuestion = require("./fillBlankQuestion");
const FillBlankOption = require("./fillBlankOption");
const PracticeQuestion = require("./practiceQuestion");
const SubscriptionDuration = require('./subscription_duration');
const LessonLength = require('./lesson_length');
const LessonsPerMonth = require('./lessons_per_month');
const SubscriptionPlan = require('./subscription_plan');
const TrialStudentTransfer = require('./TrialStudentTransfer');
const TrialPaymentLink = require('./TrialPaymentLink');
const TrialTransferNotification = require('./TrialTransferNotification');
const TrialTransferActivityLog = require('./TrialTransferActivityLog');
const QuestionBank = require('./questionBank');
const UserQuestionResponse = require('./userQuestionResponse');
const SupportPermission = require('./supportPermissions');
const SupportUserPermission = require('./supportUserPermissions');
const StudentClassQuery = require('./studentClassQuery');
const PaymentTransaction = require('./PaymentTransaction');
const PastDuePayment = require('./PastDuePayment');
const DunningSchedule = require('./DunningSchedule');
const SubscriptionChargeSkip = require('./SubscriptionChargeSkip');
const { Family, FamilyChild, FamilyCartItem, FamilyPaymentLink, FamilyPaymentTransaction, FamilyActivityLog } = require('./Family');
const Role = require('./role');
const StudentEvents=require('./student_events');
const CancelReason=require('./cancelReason');
const StudentLabels=require('./studentLabels');
const StudentRiskHitory=require('./studentRiskHistory');
const RiskRules = require('./riskRules');
const RiskRulesAudit = require('./RiskRulesAudit');
const ManualEventLog = require('./manual_event_logs.model');
const DailyRiskCalcLog = require('./daily_risk_calc_logs.model');
const RiskTable=require('./riskTable.model')
const RiskTableAuditLog=require('./riskTableAudit.model')
const CancellationReasonCategory = require('./cancellationReasonCategory');
const LessonFeedback=require('./lessonFeedback')
const Homework=require('./homework')
const ChangeRequest=require('./TeacherAvailabilityChangeRequest');
const TeacherSalaryProfile=require('./teacherSalaryProfile');
const TeacherPayslip = require('./TeacherPaySlip');
const TeacherAdvancedCashRequest=require('./advancedCashRequest');
const CompensationGroup = require('./compensationgroup');
const NotificationRule = require('./NotificationRule');
const NotificationLog = require('./NotificationLog');
const StudentActivity = require('./StudentActivity');
const UserNotification = require('./UserNotification');
// const GameOption = require('./game-option');
// const GameOptionItem = require('./gameOptionItem');
let associationsInitialized = false;

const setupAssociations = () => {
    if (associationsInitialized) {
        return;
    }
    associationsInitialized = true;

    // Each salary profile belongs to one teacher (user)
    TeacherSalaryProfile.belongsTo(User, {
        foreignKey: 'teacher_id',
        targetKey: 'id',
        as: 'teacher'
    });

    TeacherAdvancedCashRequest.belongsTo(User, {
    foreignKey: 'teacher_id',
    as: 'Teacher',
    onDelete: 'CASCADE'
    });

    // Optional but useful
    User.hasMany(TeacherSalaryProfile, {
        foreignKey: 'teacher_id',
        as: 'salary_profiles'
    });
    //? Risk Events
    User.hasMany(StudentEvents, { foreignKey: 'user_id', as: 'risk_events' });
    StudentEvents.belongsTo(User, { foreignKey: 'user_id', as: 'student' });

    //? Cancel Reason
    User.hasMany(CancelReason, { foreignKey: 'user_id', as: 'cancel_reasons' });
    CancelReason.belongsTo(User, { foreignKey: 'user_id', as: 'student' });

    //? Risk Label
    User.hasMany(StudentLabels, { foreignKey: 'user_id', as: 'risk_labels' });
    StudentLabels.belongsTo(User, { foreignKey: 'user_id', as: 'student' });

    //? Risk History
    User.hasMany(StudentRiskHitory, { foreignKey: 'user_id', as: 'risk_history' });
    StudentRiskHitory.belongsTo(User, { foreignKey: 'user_id', as: 'student' });

    //? Risk Audit
    RiskRules.hasMany(RiskRulesAudit, { foreignKey: 'risk_rule_id' });
    RiskRulesAudit.belongsTo(RiskRules, { foreignKey: 'risk_rule_id' });

    UserSubscriptionDetails.belongsTo(CancellationReasonCategory, {
        foreignKey: 'cancellation_reason_category_id',
        as: 'CancellationReasonCategory'
    });

    //?Logs
    // DailyRiskCalcLog.associate = (models) => {
    //     // no direct associations needed
    // };

    RiskTable.hasMany(RiskTableAuditLog, {
        foreignKey: 'risk_id'
    });

    RiskTableAuditLog.belongsTo(RiskTable, {
        foreignKey: 'risk_id'
    });

    RiskTable.hasMany(RiskRulesAudit, {
        foreignKey: 'student_id',
        sourceKey: 'student_id',
        as: 'RuleAudits'
    });

    RiskTable.belongsTo(User, { as: 'Student', foreignKey: 'student_id' });
    User.hasOne(RiskTable, { as: 'RiskRecord', foreignKey: 'student_id' });

    CancelReason.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

    ChangeRequest.belongsTo(User, { foreignKey: 'user_id', as: 'teacher' });

    ManualEventLog.associate = (models) => {
        ManualEventLog.belongsTo(models.StudentEvent, { foreignKey: 'event_id' });
        ManualEventLog.belongsTo(models.Student, { foreignKey: 'student_id' });
        ManualEventLog.belongsTo(models.User, { foreignKey: 'created_by' });
    };

    TeacherHoliday.belongsTo(User, { foreignKey: 'user_id' });

    // TrialClassRegistration.belongsTo(Class, {
    //     foreignKey: 'class_id',
    //     targetKey: 'id',
    //     as: 'trialClass',
    //     onDelete: 'SET NULL'
    // });

    // TrialClassRegistration.belongsTo(Class, {
    //     foreignKey: 'regular_class_id',
    //     targetKey: 'id',
    //     as: 'regularClass',
    //     onDelete: 'SET NULL'
    // });

    // Class.hasOne(TrialClassRegistration, {
    //     foreignKey: 'class_id',
    //     sourceKey: 'id',
    //     as: 'trialRegistration'
    // });
    TeacherPayslip.belongsTo(User, {
        foreignKey: 'teacher_id',
        as: 'teacher'
    });

    TeacherPayslip.belongsTo(TeacherSalaryProfile, {
    foreignKey: 'salary_profile_id',
    as: 'salary_profile',
    });

    TeacherSalaryProfile.hasMany(TeacherPayslip, {
    foreignKey: 'salary_profile_id',
    as: 'payslips',
    });


    User.hasMany(TeacherPayslip, {
        foreignKey: 'teacher_id',
        as: 'payslips'
    });


    // -------------------- TRIAL ↔ CLASS ASSOCIATIONS --------------------

    // 1️⃣ TrialClassRegistration → Class (converted or regular linkage)
    TrialClassRegistration.belongsTo(Class, {
        foreignKey: 'class_id',
        targetKey: 'id',
        as: 'trialClass', // for converted trial to regular class
        onDelete: 'SET NULL'
    });

    TrialClassRegistration.belongsTo(Class, {
        foreignKey: 'regular_class_id',
        targetKey: 'id',
        as: 'regularClass', // for recurring/series class linkage
        onDelete: 'SET NULL'
    });

    // 2️⃣ Class → TrialClassRegistration (trial/demo linkage)
    // Each class record may belong to a trial registration via demo_class_id
    Class.belongsTo(TrialClassRegistration, {
        foreignKey: 'demo_class_id',
        targetKey: 'id',
        as: 'linkedTrialRegistration', // avoid alias conflicts
        onDelete: 'SET NULL'
    });

    // 3️⃣ TrialClassRegistration → Class (reverse of demo linkage)
    // Each trial registration can have one related demo class
    TrialClassRegistration.hasOne(Class, {
        foreignKey: 'demo_class_id',
        sourceKey: 'id',
        as: 'classInfo', // used in controllers to include class data
        onDelete: 'SET NULL'
    });

    // User and Class associations (as Teacher)
    Class.belongsTo(User, {
        foreignKey: 'teacher_id',
        targetKey: 'id',
        as: 'Teacher',
        onDelete: 'CASCADE'
    });

    Class.hasOne(LessonFeedback, {
        foreignKey: 'lesson_id',
        as: 'Feedback'
    });

    Class.hasOne(Homework, {
        foreignKey: 'lesson_id',
        as: 'Homework'
    });

    User.hasMany(Class, {
        foreignKey: 'teacher_id',
        sourceKey: 'id',
        as: 'TeacherClasses'
    });

    // User and Class associations (as Student)
    Class.belongsTo(User, {
        foreignKey: 'student_id',
        targetKey: 'id',
        as: 'Student',
        onDelete: 'CASCADE'
    });

    User.hasMany(Class, {
        foreignKey: 'student_id',
        sourceKey: 'id',
        as: 'StudentClasses'
    });
    User.hasMany(PaymentTransaction, {
        foreignKey: 'student_id',
        as: 'StudentPayments'
    });

    // User and RegularClass associations (as Teacher)
    RegularClass.belongsTo(User, {
        foreignKey: 'teacher_id',
        targetKey: 'id',
        as: 'Teacher',
        onDelete: 'CASCADE'
    });

    User.hasMany(RegularClass, {
        foreignKey: 'teacher_id',
        sourceKey: 'id',
        as: 'TeacherRegularClasses'
    });

    // User and RegularClass associations (as Student)
    RegularClass.belongsTo(User, {
        foreignKey: 'student_id',
        targetKey: 'id',
        as: 'Student',
        onDelete: 'CASCADE'
    });

    User.hasMany(RegularClass, {
        foreignKey: 'student_id',
        sourceKey: 'id',
        as: 'StudentRegularClasses'
    });

    // Class Booking Failures associations
    ClassBookingFailure.belongsTo(RegularClass, {
        foreignKey: 'regular_class_id',
        targetKey: 'id',
        as: 'regularClass',
        onDelete: 'SET NULL'
    });

    RegularClass.hasMany(ClassBookingFailure, {
        foreignKey: 'regular_class_id',
        sourceKey: 'id',
        as: 'bookingFailures'
    });

    ClassBookingFailure.belongsTo(User, {
        foreignKey: 'student_id',
        targetKey: 'id',
        as: 'student',
        onDelete: 'CASCADE'
    });

    User.hasMany(ClassBookingFailure, {
        foreignKey: 'student_id',
        sourceKey: 'id',
        as: 'bookingFailuresAsStudent'
    });

    ClassBookingFailure.belongsTo(User, {
        foreignKey: 'teacher_id',
        targetKey: 'id',
        as: 'teacher',
        onDelete: 'CASCADE'
    });

    User.hasMany(ClassBookingFailure, {
        foreignKey: 'teacher_id',
        sourceKey: 'id',
        as: 'bookingFailuresAsTeacher'
    });

    // Trial Class Registration associations
    TrialClassRegistration.belongsTo(User, {
        foreignKey: 'teacher_id',
        targetKey: 'id',
        as: 'teacher',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE'
    });

    User.hasMany(TrialClassRegistration, {
        foreignKey: 'teacher_id',
        sourceKey: 'id',
        as: 'teacherTrialClasses'
    });

    TrialClassRegistration.belongsTo(User, {
        foreignKey: 'booked_by',
        targetKey: 'id',
        as: 'salesAgent',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE'
    });

    User.hasMany(TrialClassRegistration, {
        foreignKey: 'booked_by',
        sourceKey: 'id',
        as: 'bookedTrialClasses'
    });

    // Trial Class Evaluation associations
    TrialClassRegistration.hasOne(TrialClassEvaluation, {
        foreignKey: 'trial_class_registrations_id',
        sourceKey: 'id',
        as: 'evaluation',
        onDelete: 'CASCADE'
    });

    TrialClassEvaluation.belongsTo(TrialClassRegistration, {
        foreignKey: 'trial_class_registrations_id',
        targetKey: 'id',
        as: 'trialClassRegistration'
    });

    // TrialClassRegistration and Family associations
    TrialClassRegistration.belongsTo(Family, {
        foreignKey: 'family_id',
        as: 'family',
        onDelete: 'SET NULL'
    });

    Family.hasMany(TrialClassRegistration, {
        foreignKey: 'family_id',
        as: 'trialClasses'
    });

    // TrialClassRegistration and FamilyChild associations
    TrialClassRegistration.belongsTo(FamilyChild, {
        foreignKey: 'child_id',
        as: 'familyChild',
        onDelete: 'SET NULL'
    });

    FamilyChild.hasMany(TrialClassRegistration, {
        foreignKey: 'child_id',
        as: 'trialClasses'
    });

    // Next class association with scope
    User.hasMany(Class, {
        foreignKey: 'student_id',
        sourceKey: 'id',
        as: 'nextClass',
        scope: {
            meeting_start: {
                [Op.gte]: new Date()
            },
            status: 'scheduled'
        }
    });

    // User and UserSubscriptionDetails associations
    User.hasMany(UserSubscriptionDetails, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'UserSubscriptions',
        onDelete: 'CASCADE'
    });

    UserSubscriptionDetails.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'SubscriptionUser'
    });

    // NEW: Offline Payment Admin association
    UserSubscriptionDetails.belongsTo(User, {
        foreignKey: 'offline_payment_admin_id',
        targetKey: 'id',
        as: 'OfflinePaymentAdmin',
        onDelete: 'SET NULL'
    });

    User.hasMany(UserSubscriptionDetails, {
        foreignKey: 'offline_payment_admin_id',
        sourceKey: 'id',
        as: 'OfflinePaymentSubscriptions'
    });

    // User and Sale associations
    User.hasMany(Sale, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'UserSales'
    });

    Sale.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'SaleUser'
    });

    // User Occupation (Languages) associations
    User.hasMany(UserOccupation, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'languages',
        scope: {
            type: 'language'
        }
    });

    UserOccupation.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'user'
    });

    // Teacher availability associations
    User.hasOne(TeacherAvailability, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'availability'
    });

    TeacherAvailability.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'teacher'
    });

    // Teacher holiday associations
    User.hasMany(TeacherHoliday, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'holidays'
    });

    TeacherHoliday.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'teacher'
    });

    // User Reviews associations
    User.hasMany(UserReview, {
        foreignKey: 'instructor_id',
        sourceKey: 'id',
        as: 'teacherReviews'
    });

    UserReview.belongsTo(User, {
        foreignKey: 'instructor_id',
        targetKey: 'id',
        as: 'instructor'
    });

    User.hasMany(UserReview, {
        foreignKey: 'creator_id',
        sourceKey: 'id',
        as: 'givenReviews'
    });

    UserReview.belongsTo(User, {
        foreignKey: 'creator_id',
        targetKey: 'id',
        as: 'reviewer'
    });

    // Salesperson associations
    Salesperson.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'salesUser'
    });

    User.hasMany(Salesperson, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'salesActivities'
    });

    Salesperson.belongsTo(User, {
        foreignKey: 'student_id',
        targetKey: 'id',
        as: 'student'
    });

    User.hasMany(Salesperson, {
        foreignKey: 'student_id',
        sourceKey: 'id',
        as: 'salesInteractions'
    });

    Salesperson.belongsTo(Class, {
        foreignKey: 'class_id',
        targetKey: 'id',
        as: 'relatedClass'
    });

    Class.hasMany(Salesperson, {
        foreignKey: 'class_id',
        sourceKey: 'id',
        as: 'salesActivities'
    });

    // Scoped associations for different action types
    User.hasMany(Salesperson, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'trialClassBookings',
        scope: {
            action_type: 'trial_class'
        }
    });

    User.hasMany(Salesperson, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'regularClassBookings',
        scope: {
            action_type: 'regular_class'
        }
    });

    User.hasMany(Salesperson, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'subscriptionSales',
        scope: {
            action_type: 'subscription'
        }
    });

    TrialClassRegistration.hasMany(TrialClassStatusHistory, {
        foreignKey: 'trial_class_id',
        sourceKey: 'id',
        as: 'statusHistory',
        onDelete: 'CASCADE'
    });

    TrialClassStatusHistory.belongsTo(TrialClassRegistration, {
        foreignKey: 'trial_class_id',
        targetKey: 'id',
        as: 'trialClass'
    });

    // User association for the person who made the change
    TrialClassStatusHistory.belongsTo(User, {
        foreignKey: 'changed_by_id',
        targetKey: 'id',
        as: 'changedBy'
    });

    User.hasMany(TrialClassStatusHistory, {
        foreignKey: 'changed_by_id',
        sourceKey: 'id',
        as: 'statusChangesHistory'
    });

    // Sales Agent Review associations
    SalesAgentReview.belongsTo(User, {
        foreignKey: 'sales_agent_id',
        targetKey: 'id',
        as: 'salesAgent',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    });

    User.hasMany(SalesAgentReview, {
        foreignKey: 'sales_agent_id',
        sourceKey: 'id',
        as: 'salesAgentReviews'
    });

    SalesAgentReview.belongsTo(User, {
        foreignKey: 'reviewer_id',
        targetKey: 'id',
        as: 'reviewer',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    });

    User.hasMany(SalesAgentReview, {
        foreignKey: 'reviewer_id',
        sourceKey: 'id',
        as: 'givenSalesAgentReviews'
    });

    SalesAgentReview.belongsTo(TrialClassRegistration, {
        foreignKey: 'trial_class_id',
        targetKey: 'id',
        as: 'trialClass',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
    });

    TrialClassRegistration.hasMany(SalesAgentReview, {
        foreignKey: 'trial_class_id',
        sourceKey: 'id',
        as: 'salesAgentReviews'
    });

    // Translation File associations
    TranslationFile.hasMany(TranslationWord, {
        foreignKey: 'file_id',
        as: 'TranslationWords',
        onDelete: 'CASCADE'
    });

    // Translation Word associations
    TranslationWord.belongsTo(TranslationFile, {
        foreignKey: 'file_id',
        as: 'TranslationFile'
    });

    // Practice Session - Practice Result (one-to-one)
    PracticeSession.hasOne(PracticeResult, {
        foreignKey: 'session_id',
        as: 'PracticeResult',
        onDelete: 'CASCADE'
    });

    PracticeResult.belongsTo(PracticeSession, {
        foreignKey: 'session_id',
        as: 'PracticeSession'
    });

    // Practice Session - Words Practiced (one-to-many)
    PracticeSession.hasMany(WordPracticed, {
        foreignKey: 'session_id',
        as: 'WordsPracticed',
        onDelete: 'CASCADE'
    });

    WordPracticed.belongsTo(PracticeSession, {
        foreignKey: 'session_id',
        as: 'PracticeSession'
    });

    // Words Practiced - Translation Word (many-to-one)
    TranslationWord.hasMany(WordPracticed, {
        foreignKey: 'word_id',
        as: 'PracticeInstances'
    });

    WordPracticed.belongsTo(TranslationWord, {
        foreignKey: 'word_id',
        as: 'Word'
    });

    // User - Practice Session (one-to-many)
    User.hasMany(PracticeSession, {
        foreignKey: 'user_id',
        as: 'PracticeSessions'
    });

    PracticeSession.belongsTo(User, {
        foreignKey: 'user_id',
        as: 'User'
    });

    PracticeSession.hasOne(MemoryGameProgress, {
        foreignKey: 'session_id',
        as: 'MemoryGameProgress',
        onDelete: 'CASCADE'
    });

    MemoryGameProgress.belongsTo(PracticeSession, {
        foreignKey: 'session_id',
        as: 'PracticeSession'
    });

    QuizQuestion.hasMany(QuizOption, {
        foreignKey: 'question_id',
        as: 'Options',
        onDelete: 'CASCADE'
    });

    QuizOption.belongsTo(QuizQuestion, {
        foreignKey: 'question_id',
        as: 'Question'
    });

    // New associations for Fill in the Blank
    FillBlankQuestion.hasMany(FillBlankOption, {
        foreignKey: 'question_id',
        as: 'Options',
        onDelete: 'CASCADE'
    });

    FillBlankOption.belongsTo(FillBlankQuestion, {
        foreignKey: 'question_id',
        as: 'Question'
    });

    // New associations for Practice Questions
    PracticeSession.hasMany(PracticeQuestion, {
        foreignKey: 'session_id',
        as: 'Questions',
        onDelete: 'CASCADE'
    });

    PracticeQuestion.belongsTo(PracticeSession, {
        foreignKey: 'session_id',
        as: 'Session'
    });

    // Subscription Duration and Lesson Length associations
    SubscriptionDuration.hasMany(LessonLength, {
        foreignKey: 'duration_id',
        sourceKey: 'id',
        as: 'LessonLengths'
    });

    LessonLength.belongsTo(SubscriptionDuration, {
        foreignKey: 'duration_id',
        targetKey: 'id',
        as: 'Duration'
    });

    // Lesson Length and Lessons Per Month associations
    LessonLength.hasMany(LessonsPerMonth, {
        foreignKey: 'lesson_length_id',
        sourceKey: 'id',
        as: 'LessonsPerMonthOptions'
    });

    LessonsPerMonth.belongsTo(LessonLength, {
        foreignKey: 'lesson_length_id',
        targetKey: 'id',
        as: 'LessonLength'
    });

    // Subscription Plan associations
    SubscriptionDuration.hasMany(SubscriptionPlan, {
        foreignKey: 'duration_id',
        sourceKey: 'id',
        as: 'SubscriptionPlans'
    });

    SubscriptionPlan.belongsTo(SubscriptionDuration, {
        foreignKey: 'duration_id',
        targetKey: 'id',
        as: 'Duration'
    });

    LessonLength.hasMany(SubscriptionPlan, {
        foreignKey: 'lesson_length_id',
        sourceKey: 'id',
        as: 'SubscriptionPlans'
    });

    SubscriptionPlan.belongsTo(LessonLength, {
        foreignKey: 'lesson_length_id',
        targetKey: 'id',
        as: 'LessonLength'
    });

    LessonsPerMonth.hasMany(SubscriptionPlan, {
        foreignKey: 'lessons_per_month_id',
        sourceKey: 'id',
        as: 'SubscriptionPlans'
    });

    SubscriptionPlan.belongsTo(LessonsPerMonth, {
        foreignKey: 'lessons_per_month_id',
        targetKey: 'id',
        as: 'LessonsPerMonth'
    });

    // User Subscription Details and Subscription Plan associations
    SubscriptionPlan.hasMany(UserSubscriptionDetails, {
        foreignKey: 'plan_id',
        sourceKey: 'id',
        as: 'UserSubscriptions'
    });

    UserSubscriptionDetails.belongsTo(SubscriptionPlan, {
        foreignKey: 'plan_id',
        targetKey: 'id',
        as: 'SubscriptionPlan'
    });

    // TrialClassRegistration and User (transferred_to) associations
    TrialClassRegistration.belongsTo(User, {
        foreignKey: 'transferred_to',
        targetKey: 'id',
        as: 'salesUserTransferred',
        onDelete: 'SET NULL'
    });

    User.hasMany(TrialClassRegistration, {
        foreignKey: 'transferred_to',
        sourceKey: 'id',
        as: 'transferredTrialClasses'
    });

    // TrialStudentTransfer associations
    TrialStudentTransfer.belongsTo(TrialClassRegistration, {
        foreignKey: 'trial_class_id',
        targetKey: 'id',
        as: 'trialClass',
        onDelete: 'CASCADE'
    });

    TrialClassRegistration.hasMany(TrialStudentTransfer, {
        foreignKey: 'trial_class_id',
        sourceKey: 'id',
        as: 'transfers'
    });

    TrialStudentTransfer.belongsTo(User, {
        foreignKey: 'appointment_setter_id',
        targetKey: 'id',
        as: 'appointmentSetter',
        onDelete: 'RESTRICT'
    });

    User.hasMany(TrialStudentTransfer, {
        foreignKey: 'appointment_setter_id',
        sourceKey: 'id',
        as: 'trialTransfersInitiated'
    });

    TrialStudentTransfer.belongsTo(User, {
        foreignKey: 'sales_user_id',
        targetKey: 'id',
        as: 'salesUser',
        onDelete: 'RESTRICT'
    });

    User.hasMany(TrialStudentTransfer, {
        foreignKey: 'sales_user_id',
        sourceKey: 'id',
        as: 'trialTransfersReceived'
    });

    TrialStudentTransfer.belongsTo(User, {
        foreignKey: 'student_id',
        targetKey: 'id',
        as: 'student',
        onDelete: 'SET NULL'
    });

    // TrialPaymentLink associations
    TrialPaymentLink.belongsTo(TrialStudentTransfer, {
        foreignKey: 'transfer_id',
        targetKey: 'id',
        as: 'transfer',
        onDelete: 'CASCADE'
    });

    TrialStudentTransfer.hasMany(TrialPaymentLink, {
        foreignKey: 'transfer_id',
        sourceKey: 'id',
        as: 'paymentLinks'
    });

    TrialPaymentLink.belongsTo(User, {
        foreignKey: 'sales_user_id',
        targetKey: 'id',
        as: 'salesUser',
        onDelete: 'RESTRICT'
    });

    User.hasMany(TrialPaymentLink, {
        foreignKey: 'sales_user_id',
        sourceKey: 'id',
        as: 'createdTrialPaymentLinks'
    });

    TrialPaymentLink.belongsTo(SubscriptionPlan, {
        foreignKey: 'subscription_plan_id',
        targetKey: 'id',
        as: 'subscriptionPlan',
        onDelete: 'SET NULL'
    });

    TrialPaymentLink.belongsTo(TrialClassRegistration, {
        foreignKey: 'trial_class_id',
        targetKey: 'id',
        as: 'trialClass',
        onDelete: 'SET NULL'
    });

    TrialClassRegistration.hasMany(TrialPaymentLink, {
        foreignKey: 'trial_class_id',
        sourceKey: 'id',
        as: 'paymentLinks'
    });

    // TrialTransferNotification associations
    TrialTransferNotification.belongsTo(TrialStudentTransfer, {
        foreignKey: 'transfer_id',
        targetKey: 'id',
        as: 'transfer',
        onDelete: 'CASCADE'
    });

    TrialStudentTransfer.hasMany(TrialTransferNotification, {
        foreignKey: 'transfer_id',
        sourceKey: 'id',
        as: 'notifications'
    });

    TrialTransferNotification.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'user',
        onDelete: 'CASCADE'
    });

    User.hasMany(TrialTransferNotification, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'trialTransferNotifications'
    });

    // TrialTransferActivityLog associations
    TrialTransferActivityLog.belongsTo(TrialStudentTransfer, {
        foreignKey: 'transfer_id',
        targetKey: 'id',
        as: 'transfer',
        onDelete: 'CASCADE'
    });

    TrialStudentTransfer.hasMany(TrialTransferActivityLog, {
        foreignKey: 'transfer_id',
        sourceKey: 'id',
        as: 'activityLogs'
    });

    TrialTransferActivityLog.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'user',
        onDelete: 'CASCADE'
    });

    User.hasMany(TrialTransferActivityLog, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'trialTransferActivities'
    });
    User.belongsTo(TrialClassRegistration, {
        foreignKey: 'trial_user_id',
        targetKey: 'id',
        as: 'trialClassRegistration',
        onDelete: 'SET NULL'
    });

    TrialClassRegistration.hasOne(User, {
        foreignKey: 'trial_user_id',
        sourceKey: 'id',
        as: 'convertedUser'
    });

    // 🆕 NEW: Question Bank and User Question Response associations
    UserQuestionResponse.belongsTo(QuestionBank, {
        foreignKey: 'question_id',
        as: 'question',
        targetKey: 'id'
    });

    QuestionBank.hasMany(UserQuestionResponse, {
        foreignKey: 'question_id',
        as: 'responses',
        sourceKey: 'id'
    });

    // 🆕 NEW: User and User Question Response associations
    UserQuestionResponse.belongsTo(User, {
        foreignKey: 'user_id',
        as: 'user',
        targetKey: 'id'
    });

    User.hasMany(UserQuestionResponse, {
        foreignKey: 'user_id',
        as: 'questionResponses',
        sourceKey: 'id'
    });

    // StudentClassQuery associations with class
    StudentClassQuery.belongsTo(Class, {
        foreignKey: 'class_id',
        targetKey: 'id',
        as: 'Class'
    });

    // 🆕 NEW: Support Permission System Associations

    // User and Role associations (if not already present)
    User.belongsTo(Role, {
        foreignKey: 'role_id',
        targetKey: 'id',
        as: 'Role',
        onDelete: 'SET NULL'
    });

    Role.hasMany(User, {
        foreignKey: 'role_id',
        sourceKey: 'id',
        as: 'Users'
    });

    // User and SupportUserPermission associations
    User.hasMany(SupportUserPermission, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'UserPermissions',
        onDelete: 'CASCADE'
    });

    SupportUserPermission.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'User'
    });

    // SupportPermission and SupportUserPermission associations
    SupportPermission.hasMany(SupportUserPermission, {
        foreignKey: 'permission_id',
        sourceKey: 'id',
        as: 'UserPermissions',
        onDelete: 'CASCADE'
    });

    SupportUserPermission.belongsTo(SupportPermission, {
        foreignKey: 'permission_id',
        targetKey: 'id',
        as: 'Permission'
    });

    SupportUserPermission.belongsTo(User, {
        foreignKey: 'granted_by',
        targetKey: 'id',
        as: 'GrantedByUser',
        onDelete: 'SET NULL'
    });

    User.hasMany(SupportUserPermission, {
        foreignKey: 'granted_by',
        sourceKey: 'id',
        as: 'GrantedPermissions'
    });

    UserSubscriptionDetails.belongsTo(PaymentTransaction, {
        foreignKey: 'payment_id',
        as: 'Payment'
    });
    PaymentTransaction.hasMany(UserSubscriptionDetails, {
        foreignKey: 'payment_id',
        as: 'Subscriptions'
    });

    TeacherSalaryProfile.belongsTo(CompensationGroup, {
        foreignKey: 'compensation_group_id',
        as: 'compensation_group'
    });

    CompensationGroup.hasMany(TeacherSalaryProfile, {
        foreignKey: 'compensation_group_id',
        as: 'salary_profiles'
    });


    // PaymentTransaction associations with User (Sales Agent)
    PaymentTransaction.belongsTo(User, {
        foreignKey: 'generated_by',
        targetKey: 'id',
        as: 'SalesAgent',
        onDelete: 'SET NULL'
    });

    User.hasMany(PaymentTransaction, {
        foreignKey: 'generated_by',
        sourceKey: 'id',
        as: 'GeneratedTransactions'
    });

    // PaymentTransaction associations with User (Student)
    PaymentTransaction.belongsTo(User, {
        foreignKey: 'student_id',
        targetKey: 'id',
        as: 'StudentUser',
        onDelete: 'SET NULL'
    });

    // PaymentTransaction associations with SubscriptionPlan (if you use plan_id)
    PaymentTransaction.belongsTo(SubscriptionPlan, {
        foreignKey: 'plan_id',
        targetKey: 'id',
        as: 'SubscriptionPlan',
        onDelete: 'SET NULL'
    });

    SubscriptionPlan.hasMany(PaymentTransaction, {
        foreignKey: 'plan_id',
        sourceKey: 'id',
        as: 'PaymentTransactions'
    });

    // Family and FamilyChild associations
    Family.hasMany(FamilyChild, {
        foreignKey: 'family_id',
        as: 'children',
        onDelete: 'CASCADE'
    });

    FamilyChild.belongsTo(Family, {
        foreignKey: 'family_id',
        as: 'family',
        onDelete: 'CASCADE'
    });

    // Family and User associations (creator)
    Family.belongsTo(User, {
        foreignKey: 'created_by',
        targetKey: 'id',
        as: 'creator',
        onDelete: 'SET NULL'
    });

    User.hasMany(Family, {
        foreignKey: 'created_by',
        sourceKey: 'id',
        as: 'createdFamilies'
    });

    // FamilyCartItem associations
    FamilyCartItem.belongsTo(Family, {
        foreignKey: 'family_id',
        as: 'family',
        onDelete: 'CASCADE'
    });

    FamilyCartItem.belongsTo(FamilyChild, {
        foreignKey: 'child_id',
        as: 'child',
        onDelete: 'CASCADE'
    });

    FamilyCartItem.belongsTo(User, {
        foreignKey: 'sales_user_id',
        targetKey: 'id',
        as: 'salesUser',
        onDelete: 'CASCADE'
    });

    User.hasMany(FamilyCartItem, {
        foreignKey: 'sales_user_id',
        sourceKey: 'id',
        as: 'cartItems'
    });

    // FamilyPaymentLink associations
    FamilyPaymentLink.belongsTo(User, {
        foreignKey: 'sales_user_id',
        targetKey: 'id',
        as: 'salesUser',
        onDelete: 'RESTRICT'
    });

    User.hasMany(FamilyPaymentLink, {
        foreignKey: 'sales_user_id',
        sourceKey: 'id',
        as: 'familyPaymentLinks'
    });

    FamilyPaymentLink.hasMany(FamilyPaymentTransaction, {
        foreignKey: 'payment_link_id',
        as: 'transactions',
        onDelete: 'CASCADE'
    });

    FamilyPaymentTransaction.belongsTo(FamilyPaymentLink, {
        foreignKey: 'payment_link_id',
        as: 'paymentLink',
        onDelete: 'CASCADE'
    });

    // FamilyPaymentTransaction associations
    FamilyPaymentTransaction.belongsTo(Family, {
        foreignKey: 'family_id',
        as: 'family',
        onDelete: 'CASCADE'
    });

    Family.hasMany(FamilyPaymentTransaction, {
        foreignKey: 'family_id',
        as: 'paymentTransactions'
    });

    // FamilyActivityLog associations
    FamilyActivityLog.belongsTo(Family, {
        foreignKey: 'family_id',
        as: 'family',
        onDelete: 'CASCADE'
    });

    FamilyActivityLog.belongsTo(FamilyChild, {
        foreignKey: 'child_id',
        as: 'child',
        onDelete: 'CASCADE'
    });

    FamilyActivityLog.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'user',
        onDelete: 'CASCADE'
    });

    User.hasMany(FamilyActivityLog, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'familyActivityLogs'
    });

    // PastDuePayment associations
    PastDuePayment.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'User'
    });

    PastDuePayment.belongsTo(UserSubscriptionDetails, {
        foreignKey: 'subscription_id',
        targetKey: 'id',
        as: 'Subscription'
    });

    User.hasMany(PastDuePayment, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'PastDuePayments'
    });

    UserSubscriptionDetails.hasMany(PastDuePayment, {
        foreignKey: 'subscription_id',
        sourceKey: 'id',
        as: 'PastDuePayments'
    });

    // DunningSchedule associations
    DunningSchedule.belongsTo(PastDuePayment, {
        foreignKey: 'past_due_payment_id',
        targetKey: 'id',
        as: 'PastDuePayment'
    });

    DunningSchedule.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'User'
    });

    DunningSchedule.belongsTo(User, {
        foreignKey: 'paused_by_user_id',
        targetKey: 'id',
        as: 'PausedByUser'
    });

    PastDuePayment.hasOne(DunningSchedule, {
        foreignKey: 'past_due_payment_id',
        sourceKey: 'id',
        as: 'DunningSchedule'
    });

    User.hasMany(DunningSchedule, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'DunningSchedules'
    });

    // SubscriptionChargeSkip associations
    SubscriptionChargeSkip.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'User'
    });

    SubscriptionChargeSkip.belongsTo(UserSubscriptionDetails, {
        foreignKey: 'subscription_id',
        targetKey: 'id',
        as: 'Subscription'
    });

    SubscriptionChargeSkip.belongsTo(User, {
        foreignKey: 'created_by_user_id',
        targetKey: 'id',
        as: 'CreatedByUser'
    });

    User.hasMany(SubscriptionChargeSkip, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'ChargeSkips'
    });

    UserSubscriptionDetails.hasMany(SubscriptionChargeSkip, {
        foreignKey: 'subscription_id',
        sourceKey: 'id',
        as: 'ChargeSkips'
    });

    // ReferralLink associations
    User.hasMany(ReferralLink, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'referralLinks'
    });

    ReferralLink.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'user'
    });

    // Referral associations
    Referral.belongsTo(User, {
        foreignKey: 'referrer_id',
        targetKey: 'id',
        as: 'referrer'
    });

    Referral.belongsTo(User, {
        foreignKey: 'referee_id',
        targetKey: 'id',
        as: 'referee'
    });

    User.hasMany(Referral, {
        foreignKey: 'referrer_id',
        sourceKey: 'id',
        as: 'referralsMade'
    });

    User.hasMany(Referral, {
        foreignKey: 'referee_id',
        sourceKey: 'id',
        as: 'referredBy'
    });

    Referral.belongsTo(ReferralLink, {
        foreignKey: 'invite_code',
        targetKey: 'invite_code',
        as: 'referralLink'
    });

    // ReferralReward associations
    ReferralReward.belongsTo(Referral, {
        foreignKey: 'referral_id',
        targetKey: 'id',
        as: 'referral'
    });

    Referral.hasMany(ReferralReward, {
        foreignKey: 'referral_id',
        sourceKey: 'id',
        as: 'rewards'
    });

    ReferralReward.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'user'
    });

    User.hasMany(ReferralReward, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'referralRewards'
    });

    // UserReferralSettings associations
    User.hasOne(UserReferralSettings, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'referralSettings'
    });

    UserReferralSettings.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'user'
    });

    // ReferralNotification associations
    ReferralNotification.belongsTo(Referral, {
        foreignKey: 'referral_id',
        targetKey: 'id',
        as: 'referral'
    });

    ReferralNotification.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'user'
    });

    // ReferralFraudLog associations
    ReferralFraudLog.belongsTo(User, {
        foreignKey: 'referee_id',
        targetKey: 'id',
        as: 'referee'
    });

    ReferralFraudLog.belongsTo(User, {
        foreignKey: 'referrer_id',
        targetKey: 'id',
        as: 'referrer'
    });

    // ✅ Add the missing reviewer association
    ReferralFraudLog.belongsTo(User, {
        foreignKey: 'reviewed_by',
        targetKey: 'id',
        as: 'reviewer'
    });

    // ReferralRetentionTracking associations
    ReferralRetentionTracking.belongsTo(User, {
        foreignKey: 'referee_id',
        targetKey: 'id',
        as: 'referee'
    });

    ReferralRetentionTracking.belongsTo(User, {
        foreignKey: 'referrer_id',
        targetKey: 'id',
        as: 'referrer'
    });

    // ReferralTier and ReferralTierClaim associations
    ReferralTierClaim.belongsTo(User, {
        foreignKey: 'user_id',
        targetKey: 'id',
        as: 'user'
    });

    User.hasMany(ReferralTierClaim, {
        foreignKey: 'user_id',
        sourceKey: 'id',
        as: 'tierClaims'
    });

    ReferralTierClaim.belongsTo(ReferralTier, {
        foreignKey: 'tier_level',
        targetKey: 'tier_level',
        as: 'tier'
    });

    ReferralTier.hasMany(ReferralTierClaim, {
        foreignKey: 'tier_level',
        sourceKey: 'tier_level',
        as: 'claims'
    });
    // -----------------------------------------
    // Referral → ReferralFraudLog (One-to-Many)
    // -----------------------------------------
    Referral.hasMany(ReferralFraudLog, {
        foreignKey: 'referral_id',
        sourceKey: 'id',
        as: 'fraud_logs'
    });

    ReferralFraudLog.belongsTo(Referral, {
        foreignKey: 'referral_id',
        targetKey: 'id',
        as: 'referral'
    });
};
// // 🎮 Game Options → Game Option Items
// GameOption.hasMany(GameOptionItem, {
//     foreignKey: 'game_option_id',
//     as: 'items',
//     onDelete: 'CASCADE',
//     constraints: true
// });

// GameOptionItem.belongsTo(GameOption, {
//     foreignKey: 'game_option_id',
//     as: 'option'
// });

    // ============================================================
    // ENGAGEMENT NOTIFICATION SYSTEM ASSOCIATIONS
    // ============================================================

    // NotificationLog belongs to NotificationRule
    NotificationLog.belongsTo(NotificationRule, {
        foreignKey: 'rule_id',
        as: 'rule'
    });

    // NotificationRule has many NotificationLogs
    NotificationRule.hasMany(NotificationLog, {
        foreignKey: 'rule_id',
        as: 'logs'
    });

    // NotificationLog belongs to User (student)
    NotificationLog.belongsTo(User, {
        foreignKey: 'student_id',
        as: 'student'
    });

    // StudentActivity belongs to User
    StudentActivity.belongsTo(User, {
        foreignKey: 'student_id',
        as: 'student'
    });

    // User has one StudentActivity
    User.hasOne(StudentActivity, {
        foreignKey: 'student_id',
        as: 'activity'
    });

    // ============================================================
    // USER IN-APP NOTIFICATIONS
    // ============================================================

    // UserNotification belongs to User
    UserNotification.belongsTo(User, {
        foreignKey: 'user_id',
        as: 'user'
    });

    // User has many UserNotifications
    User.hasMany(UserNotification, {
        foreignKey: 'user_id',
        as: 'notifications'
    });

    // UserNotification optionally belongs to NotificationRule
    UserNotification.belongsTo(NotificationRule, {
        foreignKey: 'rule_id',
        as: 'rule'
    });

    // NotificationRule has many UserNotifications
    NotificationRule.hasMany(UserNotification, {
        foreignKey: 'rule_id',
        as: 'userNotifications'
    });



module.exports = setupAssociations;