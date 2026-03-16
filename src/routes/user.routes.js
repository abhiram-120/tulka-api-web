const express = require('express');
const userController = require('../controller/user.controller');
const fileController = require('../controller/file.controller');
const wordController = require('../controller/word.controller');
const practiceModeController = require('../controller/practiceMode.controller');
const practiceController = require('../controller/practice.controller');
const quizController = require('../controller/quiz.controller');
const fillBlankController = require('../controller/fillBlank.controller');
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
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    },
    storage: multerS3({
        s3: s3,
        bucket: config.AWS_BUCKET,
        acl: 'public-read-write', // Set ACL
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key: function (req, file, cb) {
            cb(null, 'homeworks/' + 'homework_answer_attachment/' + file.originalname);
        }
    })
});

// upload quizzes's files
const uploadQuizzes = multer({
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    },
    storage: multerS3({
        s3: s3,
        bucket: config.AWS_BUCKET,
        acl: 'public-read-write', // Set ACL
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key: function (req, file, cb) {
            cb(null, 'quizzes/' + 'quiz_answer_attachment/' + file.originalname);
        }
    })
});

// Upload configuration for class query attachments
const uploadClassQuery = multer({
    limits: {
        fileSize: 100 * 1024 * 1024 // 50MB limit
    },
    storage: multerS3({
        s3: s3,
        bucket: config.AWS_BUCKET,
        acl: 'public-read-write',
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key: function (req, file, cb) {
            // Add timestamp to prevent filename collisions
            const timestamp = Date.now();
            cb(null, 'class_queries/' + 'class_query_attachments/' + timestamp + '-' + file.originalname);
        }
    })
});


// user profile routes
router.get('/view-profile', AuthValidator, userController.viewProfile);
router.get('/view-profilev2', AuthValidator, userController.viewProfileV2);

// teacher routes
router.get('/teachers', AuthValidator, userController.teachers);
router.get('/my-teacher', AuthValidator, userController.myTeachers);
router.post('/add-channel-name', AuthValidator, userController.addNewChat);
router.get('/view-teacher-details/teacher/:id', AuthValidator, userController.viewTeacherDetails);


// class routes
router.post('/add-class', AuthValidator, userController.addClass);
router.post('/add-classv2', AuthValidator, userController.addClassV2);
router.post('/add-classv3', AuthValidator, userController.addClassV3);
router.get('/view-classes', AuthValidator, userController.viewClasses);
router.get('/view-classes/:id', AuthValidator, userController.viewClassDetails);
router.get('/view-classes-home', AuthValidator, userController.viewClassesHome);
router.patch('/edit-class/class/:id', AuthValidator, userController.editClass);
router.patch('/edit-class/classv2/:id', AuthValidator, userController.editClassV2);
router.patch('/cancel-class/class/:id', AuthValidator, userController.cancelClass);
router.patch('/cancel-class/classv2/:id', AuthValidator, userController.cancelClassV2);
router.patch('/cancel-class/classv3/:id', AuthValidator, userController.cancelClassV3);
router.post('/cancel-class-with-reason/:id', AuthValidator, userController.cancelClassWithReason);

// particular teacher available times and dates
router.get('/teacher-availability/teacher/:id', AuthValidator, userController.teacherAvailability);
router.get('/teacher-availability/teacherv2/:id', AuthValidator, userController.teacherAvailabilityV2);
router.get('/teacher-availability/teacherv3/:id', AuthValidator, userController.teacherAvailabilityV3);
router.get('/teacher-rescheduling-availability/teacher/:id', AuthValidator, userController.teacherAvailabilityV4);

// list of homeworks for particular user
router.get('/homeworks', AuthValidator, userController.homeWorks);
router.get('/homeworksv2', AuthValidator, userController.homeWorksV2);
router.delete('/delete-homeworks/homework/:id', AuthValidator, userController.deleteHomework);
router.get('/homeworks-filter', AuthValidator, userController.filterHomework);
router.get('/homeworks-filterv2', AuthValidator, userController.filterHomeworkV2);
router.get('/teacher-homeworks/teacher/:id', AuthValidator, userController.teacherHomeWorks);
router.post('/submit-homework/homework/:id', upload.single('answer_attachment'), AuthValidator, userController.submitHomework);

// feedback routes
router.get('/feedbacks', AuthValidator, userController.feedbacks);
router.get('/view-feedbacks-details/feedback/:id', AuthValidator, userController.viewFeedbacksDetails);
router.get('/view-teachers-feedbacks/teacher/:id', AuthValidator, userController.viewTeacherFeedbacks);



// File routes
router.get('/files', AuthValidator, fileController.getAllFiles);
router.get('/files/:id', AuthValidator, fileController.getFileById);
router.post('/files', AuthValidator, fileController.createFile);
router.put('/files/:id', AuthValidator, fileController.updateFile);
router.delete('/files/:id', AuthValidator, fileController.deleteFile);
router.put('/files/practice/:id', AuthValidator, fileController.updatePracticeSession);
router.get('/files-filter', AuthValidator, fileController.filterFiles);
router.put('/files/favorite/:id', AuthValidator, fileController.toggleFileFavorite);
router.get('/files/favorites', AuthValidator, fileController.getFavoriteFiles);

// Word routes
router.get('/words/file/:fileId', AuthValidator, wordController.getWordsByFile);
router.post('/words', AuthValidator, wordController.addWord);
router.put('/words/:id', AuthValidator, wordController.updateWord);
router.delete('/words/:id', AuthValidator, wordController.deleteWord);
router.put('/words/favorite/:id', AuthValidator, wordController.toggleFavorite);
router.get('/words/favorites', AuthValidator, wordController.getFavorites);
router.get('/words-filter', AuthValidator, wordController.filterWords);

router.put('/words/performance/:id', AuthValidator, wordController.updateWordPerformance);
router.get('/words/memory-status', AuthValidator, wordController.filterByMemoryStatus);

// Practice Mode routes
router.get('/practice-modes', practiceModeController.getAllModes);
router.get('/practice-modes/:id', practiceModeController.getModeById);
router.get('/practice-modes/key/:key', practiceModeController.getModeByKey);
router.get('/practice/statistics',AuthValidator, practiceController.getPracticeStatistics);

// Practice routes
router.get('/lessons', AuthValidator, practiceController.getLessonsByDate);
router.get('/lessons/:lessonId', AuthValidator, practiceController.getLessonDetails);
router.post('/practice/session', AuthValidator, practiceController.createPracticeSession);
router.post('/practice/session/:sessionId/response', AuthValidator, practiceController.recordWordResponse);
router.post('/practice/session/:sessionId/complete', AuthValidator, practiceController.completePracticeSession);
router.get('/words/memory-status', AuthValidator, practiceController.getWordsByMemoryStatus);

// Memory Game routes
router.get('/practice/memory-game/:sessionId', AuthValidator, practiceController.getMemoryGameCards);
router.post('/practice/memory-game/:sessionId/move', AuthValidator, practiceController.recordMemoryGameMove);
// router.post('/practice/memory-game/:sessionId/hint', AuthValidator, practiceController.useMemoryGameHint);
router.post('/practice/memory-game/:sessionId/complete', AuthValidator, practiceController.completeMemoryGame);


router.get('/words/memory-status/paginated', AuthValidator, practiceController.getWordsByMemoryStatusPaginated);

// quiz game section routes
router.get('/practice/quiz/:sessionId', AuthValidator, quizController.getQuizQuestions);
router.post('/practice/quiz/:sessionId/answer', AuthValidator, quizController.submitQuizAnswer);
router.get('/practice/quiz/:sessionId/results', AuthValidator, quizController.getQuizResults);

// fill in the blank section routes
router.get('/practice/fill-blank/:sessionId', AuthValidator, fillBlankController.getFillBlankQuestions);
router.post('/practice/fill-blank/:sessionId/answer', AuthValidator, fillBlankController.submitFillBlankAnswer);
router.get('/practice/fill-blank/:questionId/hint', AuthValidator, fillBlankController.getQuestionHint);
router.get('/practice/fill-blank/:questionId/translation', AuthValidator, fillBlankController.getQuestionTranslation);
router.get('/practice/fill-blank/:sessionId/results', AuthValidator, fillBlankController.getFillBlankResults);

// feedback to teacher routes
router.get('/getFeedBackToTeacher', AuthValidator, userController.getFeedBackToTeacher);
router.post('/submitFeedBackToTeacher', AuthValidator, userController.submitFeedBackToTeacher);


// routes/teacherRoutes.js
router.get('/getNextClassTeacher', AuthValidator, userController.getNextClassTeacher);

// filter routes
router.get('/category-filter', userController.filterCategories);
router.get('/class-filter', AuthValidator, userController.filterClass);
router.get('/class-filterv2', AuthValidator, userController.filterClassV2);

// Quizzes routes
router.get('/view-quizzes', AuthValidator, userController.viewQuizzes);
router.get('/quizzes-filter', AuthValidator, userController.filterQuizzes);
router.post('/submit-quizzes/quizzes/:id', uploadQuizzes.single('answer_attachment'), AuthValidator, userController.submitQuizzesAnswer);

// review routes
router.post('/submit-review/teacher/:id', AuthValidator, userController.submitReview);
router.get('/review-list/teacher/:id', AuthValidator, userController.viewReviewList);

// download notes
router.get('/download-file/homework/:id', AuthValidator, userController.downloadMaterials);

// download homework answer attachment file
router.get('/download-answer-attachment/homework/:id', AuthValidator, userController.downloadStudentAttachment);

// download quizzes notes
router.get('/download-quiz-notes/quiz/:id', AuthValidator, userController.downloadQuizNotes);

// download homework answer attachment file
router.get('/download-quiz-attachment/quiz/:id', AuthValidator, userController.downloadQuizAttachment);

router.get('/remainingClass', AuthValidator, userController.rC);

// language
router.post('/language', AuthValidator, userController.updateUserLanguage);

// language
router.post('/cancel-subscription', AuthValidator, userController.cancelSubscription);

// chat
router.get('/unread-message', AuthValidator, userController.getChatCount);
router.post('/send-message', AuthValidator, userController.sendMessage);
router.post('/read-message', AuthValidator, userController.readUnreadMessage);

// kid
router.post('/add-kid', AuthValidator, userController.addNewKid);


// Google Calendar routes
router.post('/google-calendar/store-tokens', AuthValidator, userController.storeGoogleTokens);
router.post('/google-calendar/add-event', AuthValidator, userController.addCalendarEvent);
router.post('/google-calendar/disconnect', AuthValidator, userController.disconnectGoogleCalendar);
router.get('/google-calendar/check-connection', AuthValidator, userController.checkGoogleConnection);

// Class query routes
router.post('/submit-class-query/class/:id', uploadClassQuery.array('attachments', 10), AuthValidator, userController.submitClassQuery);
router.get('/view-class-queries/class/:id', AuthValidator, userController.viewClassQueries);
router.get('/download-class-query-attachment/query/:id', AuthValidator, userController.downloadClassQueryAttachment);
router.delete('/delete-class-query/query/:id', AuthValidator, userController.deleteClassQuery);

// Demo files route - single endpoint
router.get('/demo-files', AuthValidator, userController.getDemoAudioBroadcasts);

router.get('/audio-podcast', AuthValidator, userController.getDemoAudioBroadcasts);


// Store payment data and return short ID
router.post('/update-payment-data', userController.updatePaymentData);
router.get('/announcement', AuthValidator, userController.getAnnouncement);

// Get one month date range from today
router.get('/date-range', AuthValidator, userController.getOneMonthDateRange);

router.get('/teacher-availability', AuthValidator, userController.getTeacherAvailability);

router.get('/urgent-teachers-availability', AuthValidator, userController.getAllUrgentTeachersAvailability);

router.post('/test-broadcast', userController.testBroadcastNotification);

// router.get('/classes-for-extension', userController.getClassesForExtension);
// router.post('/extend-classes-after-date', userController.extendClassesAfterDate);

// router.get('/teacher-availability-for-extension', userController.getTeacherAvailabilityForExtension);
// router.post('/extend-teacher-availability', userController.extendTeacherAvailability);

// router.get('/classes-for-revert', userController.getClassesForRevert);
// router.post('/revert-classes-after-date', userController.revertClassesAfterDate);

// Regular classes with closed teacher availability in a window (default: 2 months from today)
router.get('/regular-classes/unavailable-availability', userController.getRegularClassesWithClosedAvailability);

router.get('/class-duplicates', userController.getDuplicateClasses);

router.get('/missing-classes', userController.getMissingClasses);
router.post('/recreate-missing-classes', userController.recreateMissingClasses);


/** module exports */
module.exports = router;