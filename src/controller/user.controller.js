const { Op, Sequelize } = require('sequelize');
const { sequelize } = require('../connection/connection');
const moment = require('moment-timezone');
const Joi = require('joi');
const fs = require('fs');
const { google } = require('googleapis');

//cronjobs
const { whatsappReminderAddClass } = require('../cronjobs/reminder');

//utils
const { convertToTimezones, getNext7Days, getLocalDateTime, getLocalDate, convertScheduleToUserTimezone, convertToTimezonesV2, formatDate } = require('../utils/date.utils');
const securePassword = require('../utils/encryptPassword');

//models
const Users = require('../models/users');
const Class = require('../models/classes');
const PubnubChat = require('../models/pubnubChat');
const Homework = require('../models/homework');
const Feedback = require('../models/lessonFeedback');
const StudentClassQuery = require('../models/studentClassQuery')
const TeacherHoliday = require('../models/teacherHoliday');
const TeacherAvailability = require('../models/teacherAvailability');
const UserSubscriptionDetails = require('../models/UserSubscriptionDetails');
const UserReview = require('../models/userReviews');
const UserOccupation = require('../models/usersOccupation');
const AudioBroadcast = require('../models/AudioBroadcast');
const Announcement = require('../models/announcements');
const Quizzes = require('../models/quizzesNew');
const Messages = require('../models/messages');
const User = require('../models/users');
const GoogleTokens = require('../models/googleTokens');
const PaymentLinks = require('../models/payment_links');
const RegularClass = require('../models/regularClass');
const ClassBookingFailure = require('../models/classBookingFailures');
const TrialClassRegistration = require('../models/trialClassRegistration');
const ClassSummary = require('../models/class-summary');
const Games = require('../models/game');


async function rC(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // Assuming you have a model named UserSubscriptionDetail
        const userSubscription = await UserSubscriptionDetails.findAll({
            where: {
                user_id: user.id,
                status: 'active'
            }
        });

        const currentDate = new Date();
        const currentMonth = currentDate.getMonth() + 1;

        const leftLesson = await Class.count({
            where: {
                student_id: user.id,
                status: {
                    [Op.not]: 'canceled'
                },
                [Op.and]: [Sequelize.where(Sequelize.fn('MONTH', Sequelize.col('meeting_start')), '=', currentMonth)]
            }
        });

        // Assuming you have retrieved userSubscription and leftLesson
        const leftLessonPerWeek = userSubscription ? userSubscription.weekly_lesson - leftLesson : 0;

        // Assuming you are sending this value in a JSON response
        res.status(200).json({
            status: 'success',
            message: 'User Data',
            left_lesson_per_week: leftLessonPerWeek,
            subscription: userSubscription
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'An error occurred' });
    }
}

// view profile
async function viewProfile(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });
        const mobileParts = user.mobile.split('+');
        const phoneNumber = mobileParts[0];

        // Extract email address
        const emailParts = user.email.replace(/\+(.*?)@/, '@');
        // const emailAddress = emailParts[0];

        // Modify user object to replace mobile and email fields with extracted values
        user.mobile = phoneNumber;
        user.email = emailParts;
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // Initialize remainingClasses to 0
        let remainingClasses = 1;

        // if (user.trial_expired === false) {
        //     remainingClasses = 0
        // }

        if (user.subscription_type == null) {
            remainingClasses = 0;
        }

        let totalClasses = 0;
        let result;
        let currentSubscriptionMonth;
        let subscribedUser;

        if (user.subscription_type != null) {
            subscribedUser = await UserSubscriptionDetails.findOne({
                // attributes: ['id', 'weekly_lesson', 'left_lessons', 'type', 'lesson_min', 'renew_date', 'lesson_reset_at', 'created_at'],
                where: {
                    user_id: user.id
                },
                order: [['created_at', 'DESC']],
                limit: 1
            });

            subscribedUser = subscribedUser.toJSON();


            if (subscribedUser) {
                currentSubscriptionMonth = calculateSubscriptionDates(subscribedUser.created_at);

                // let totalClasses;

                result = await Class.findAll({
                    where: {
                        student_id: user.id,
                        meeting_start: {
                            [Op.gte]: currentSubscriptionMonth.start,
                            [Op.lt]: currentSubscriptionMonth.end
                        },
                        status: {
                            [Op.ne]: 'canceled'
                        }
                        // subscription_id: subscribedUser.id
                    }
                });
                result = JSON.parse(JSON.stringify(result));

                // let totalClasses1 = await Class.findAll({
                //     where: {
                //         student_id: user.id,
                //         meeting_start: {
                //             [Op.gte]: currentSubscriptionMonth.start,
                //             [Op.lt]: currentSubscriptionMonth.end,
                //         },
                //         status: {
                //             [Op.ne]: 'canceled',
                //         },
                //         subscription_id: subscribedUser.id,
                //     },
                // });

                totalClasses = await Class.count({
                    where: {
                        student_id: user.id,
                        // meeting_start: {
                        //     [Op.gte]: currentSubscriptionMonth.start,
                        //     [Op.lt]: currentSubscriptionMonth.end
                        // },
                        status: {
                            [Op.ne]: 'canceled'
                        }
                        // subscription_id: subscribedUser.id
                    }
                });

            }
            remainingClasses = subscribedUser.left_lessons;
        } else {
            totalClasses = await Class.count({
                where: {
                    student_id: user.id,
                    status: {
                        [Op.ne]: 'canceled'
                    }
                }
            });
        }

        // Construct response data
        let response = {
            user,
            remainingClasses,
            subscribedUser: subscribedUser || {
                weekly_lesson: '0',
                type: '',
                lesson_min: '25',
                renew_date: '',
                lesson_reset_at: '',
                created_at: ''
            }
        };

        const lessonResetAtFormatted = getLocalDateTime(response.subscribedUser.lesson_reset_at, user.timezone);
        const renewDateFormatted = getLocalDateTime(response.subscribedUser.renew_date, user.timezone);

        response = {
            ...response,
            subscribedUser: {
                ...response.subscribedUser,
                lesson_reset_at: lessonResetAtFormatted,
                renew_date: renewDateFormatted
            }
        };

        // Send the response
        res.status(200).json({
            status: 'success',
            message: 'Your Profile',
            totalClasses: totalClasses,
            response: response
        });
    } catch (error) {
        // Handle errors appropriately
        // console.error(error);
        res.status(500).json({ status: 'error', message: 'An error occurred' });
    }
}

async function viewProfileV2(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }
        const userData = user.toJSON();
        const mobileParts = userData.mobile && userData.mobile.split('+');
        const phoneNumber = mobileParts && mobileParts[0];

        // Extract email address
        const emailParts = userData.email ? userData.email.replace(/\+(.*?)@/, '@') : userData.email;
        // const emailAddress = emailParts[0];

        // Modify user data to replace mobile and email fields with extracted values
        userData.mobile = phoneNumber;
        userData.email = emailParts;

        // Initialize remainingClasses to 0
        let remainingClasses = 1;

        // if (user.trial_expired === false) {
        //     remainingClasses = 0
        // }

        if (user.subscription_type == null) {
            remainingClasses = 0;
        }

        let totalClasses = 0;
        let qna;
        let result;
        let currentSubscriptionMonth;
        let subscribedUser;

        if (user.subscription_type != null) {
            subscribedUser = await UserSubscriptionDetails.findOne({
                // attributes: ['id', 'weekly_lesson', 'left_lessons', 'type', 'lesson_min', 'renew_date', 'lesson_reset_at', 'created_at'],
                where: {
                    user_id: user.id
                },
                order: [['created_at', 'DESC']],
                limit: 1
            });

            subscribedUser = subscribedUser.toJSON();

            if (subscribedUser) {
                currentSubscriptionMonth = calculateSubscriptionDates(subscribedUser.created_at);

                // let totalClasses;

                result = await Class.findAll({
                    where: {
                        student_id: user.id,
                        meeting_start: {
                            [Op.gte]: currentSubscriptionMonth.start,
                            [Op.lt]: currentSubscriptionMonth.end
                        },
                        status: {
                            [Op.ne]: 'canceled'
                        }
                        // subscription_id: subscribedUser.id
                    }
                });
                result = JSON.parse(JSON.stringify(result));

                // let totalClasses1 = await Class.findAll({
                //     where: {
                //         student_id: user.id,
                //         meeting_start: {
                //             [Op.gte]: currentSubscriptionMonth.start,
                //             [Op.lt]: currentSubscriptionMonth.end,
                //         },
                //         status: {
                //             [Op.ne]: 'canceled',
                //         },
                //         subscription_id: subscribedUser.id,
                //     },
                // });

                totalClasses = await Class.count({
                    where: {
                        student_id: user.id,
                        // meeting_start: {
                        //     [Op.gte]: currentSubscriptionMonth.start,
                        //     [Op.lt]: currentSubscriptionMonth.end
                        // },
                        status: {
                            [Op.ne]: 'canceled'
                        }
                        // subscription_id: subscribedUser.id
                    }
                });
                qna = await Class.findOne({
                    attributes: ['id', 'question_and_answer'],
                    where: {
                        student_id: user.id
                    }
                });

            }
            remainingClasses = subscribedUser.left_lessons;
        } else {
            totalClasses = await Class.count({
                where: {
                    student_id: user.id,
                    status: {
                        [Op.ne]: 'canceled'
                    }
                }
            });
            qna = await Class.findOne({
                attributes: ['id', 'question_and_answer'],
                where: {
                    student_id: user.id
                }
            });
        }
        
        // ✅ HomeScreenTrialCheck logic
        let hasPreviousSubscription = await UserSubscriptionDetails.count({
            where: { user_id: user.id }
        });

        let homeScreenTrialCheck = true;
                
        if (totalClasses == 1 || hasPreviousSubscription > 0) {
            homeScreenTrialCheck = false;
        }

        // Construct response data
        let response = {
            user,
            remainingClasses,
            homeScreenTrialCheck, // ✅ added to response
            subscribedUser: subscribedUser || {
                weekly_lesson: '0',
                type: '',
                lesson_min: '25',
                renew_date: '',
                lesson_reset_at: '',
                created_at: ''
            }
        };

        const lessonResetAtFormatted = getLocalDateTime(response.subscribedUser.lesson_reset_at, user.timezone);
        const renewDateFormatted = getLocalDateTime(response.subscribedUser.renew_date, user.timezone);

        response = {
            ...response,
            subscribedUser: {
                ...response.subscribedUser,
                lesson_reset_at: lessonResetAtFormatted,
                renew_date: renewDateFormatted
            },
        };

        // Send the response
        res.status(200).json({
            status: 'success',
            message: 'Your Profile',
            totalClasses: totalClasses,
            qna: qna,
            native_language: userData.native_language || null,
            response: response
        });
    } catch (error) {
        console.error('viewProfileV2 error:', error);
        return res.status(500).json({ 
            status: 'error', 
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
        });
    }
}

// teacherDetails
async function getTeacherDetails(args) {
    const teachers = await Users.findAll({
        attributes: ['id', 'full_name', 'about', 'language', 'avatar', 'video_demo', 'video_demo_thumb', 'enable_zoom_link', 'add_zoom_link', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code'],
        where: {
            role_name: 'teacher',
            status: 'active',
            ...(args &&
                args.teacherId &&
                args.teacherId.length > 0 && {
                id: {
                    [Op.in]: args.teacherId
                }
            })
        }
    });

    if (!teachers || teachers.length === 0) {
        return [];
    }

    const teacherDetails = [];

    for (const teacher of teachers) {
        const teacherId = teacher.id;

        const occupations = await UserOccupation.findAll({
            attributes: ['type', 'value'],
            where: {
                user_id: teacherId
            }
        });

        const totalReviewer = await UserReview.count({
            where: {
                instructor_id: teacherId
            }
        });

        const rates = await UserReview.findAll({
            attributes: ['rates'],
            where: {
                instructor_id: teacherId
            }
        });

        const ratesArray = rates.map((rate) => parseFloat(rate.rates));
        const totalRates = ratesArray.reduce((acc, rate) => acc + rate, 0);
        const totalAvgRates = totalRates / totalReviewer;

        const teacherData = {
            id: teacher.id,
            full_name: teacher.full_name,
            about: teacher.about,
            language: teacher.language,
            avatar: teacher.avatar,
            video_demo: teacher.video_demo,
            video_demo_thumb: teacher.video_demo_thumb,
            enable_zoom_link: teacher.enable_zoom_link,
            add_zoom_link: teacher.add_zoom_link,
            add_zoom_link_meeting_id: teacher.dataValues.add_zoom_link_meeting_id,
            add_zoom_link_access_code: teacher.dataValues.add_zoom_link_access_code,
            occupations: {
                specialties: occupations.filter((occ) => occ.type === 'specialties').map((occ) => occ.value),
                also_speaking: occupations.filter((occ) => occ.type === 'also_speaking').map((occ) => occ.value),
                teachings: occupations.filter((occ) => occ.type === 'teachings').map((occ) => occ.value),
                levels: occupations.filter((occ) => occ.type === 'levels').map((occ) => occ.value)
            },
            rate: {
                total_reviews: totalReviewer,
                avgRate: totalAvgRates
            }
        };

        teacherDetails.push(teacherData);
    }

    return teacherDetails;
}

// list of teachers
async function teachers(req, res) {
    try {
        const teacherDetails = await getTeacherDetails();
        if (!teacherDetails || teacherDetails.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Teacher not found' });
        }

        // Response
        res.status(200).json({
            status: 'success',
            message: 'Teacher Details',
            data: teacherDetails
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// My Teachers
async function myTeachers(req, res) {
    try {
        // Step 1: Get the student using the provided student_id
        const student = await PubnubChat.findAll({
            where: { student_id: req.userId }
        });

        if (!student) {
            return res.status(404).json({ status: 'error', message: 'Student not found' });
        }

        // Extract the teacher IDs from the studentTeachers array
        const teacherIds = student.map((teacher) => teacher.teacher_id);

        if (teacherIds.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Teachers not found for the student' });
        }

        // Step 3: Find the details (names and IDs) of the teachers from the Users table using the teacherIds array
        const teachers = await Users.findAll({
            attributes: ['id', 'full_name', 'avatar', 'video_demo'],
            where: { id: teacherIds }
        });
        let teacherDetails = await Promise.all(
            teachers.map(async (teacher) => {
                const lastMessageFromTeacher = await Messages.findOne({
                    where: {
                        from_user: teacher.id,
                        to_user: req.userId
                    },
                    order: [['created_at', 'DESC']],
                    attributes: ['id', 'body', 'attachment', 'created_at']
                });

                const lastMessageFromStudent = await Messages.findOne({
                    where: {
                        from_user: req.userId,
                        to_user: teacher.id
                    },
                    order: [['created_at', 'DESC']],
                    attributes: ['id', 'body', 'attachment', 'created_at']
                });

                const unreadMessagesCount = await Messages.count({
                    where: {
                        from_user: teacher.id,
                        to_user: req.userId,
                        statu: 'unread'
                    }
                });
                let lastMessage;
                if (lastMessageFromTeacher && lastMessageFromStudent) {
                    lastMessage = lastMessageFromTeacher.created_at > lastMessageFromStudent.created_at ? lastMessageFromTeacher : lastMessageFromStudent;
                } else {
                    lastMessage = lastMessageFromTeacher || lastMessageFromStudent;
                }
                return {
                    ...teacher.dataValues,
                    lastMessage: lastMessage ? lastMessage.dataValues : null,
                    unreadMessagesCount: unreadMessagesCount
                };
            })
        );

        // Sort the teachers based on the timestamp of the last message
        teacherDetails.sort((a, b) => {
            if (!a.lastMessage && !b.lastMessage) return 0;
            if (!a.lastMessage) return 1;
            if (!b.lastMessage) return -1;
            return new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at);
        });

        if (teacherDetails.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Teachers not found' });
        }
        // Response
        res.status(200).json({
            status: 'success',
            message: 'Teacher Details',
            data: teacherDetails,
            totalTeachers: teachers.length
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

//Add new chat with channel name

async function addNewChat(req, res) {
    const user = await Users.findOne({
        where: { id: req.userId }
    });

    const teacherData = await Users.findOne({
        where: { id: req.body.teacher_id }
    });
    try {
        newClass = await PubnubChat.create({
            student_id: req.body.student_id,
            teacher_id: req.body.teacher_id,
            channel_name: req.body.channel_name
        });
        res.status(200).json({
            status: 'success',
            message: 'Channel Name Added Successfully',
            data: newClass
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// teachers Details
async function viewTeacherDetails(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const teacherId = req.params.id;

        const teacher = await Users.findOne({
            attributes: ['id', 'full_name', 'about', 'language', 'avatar', 'video_demo', 'video_demo_thumb'],
            where: { id: teacherId }
        });

        if (!teacher) {
            return res.status(404).json({ status: 'error', message: 'Teacher not found' });
        }

        // find teacher's occupation
        const occupations = await UserOccupation.findAll({
            attributes: ['type', 'value'],
            where: {
                user_id: teacherId
            }
        });

        // count total reviews for this teacher
        const totalReviewer = await UserReview.count({
            where: {
                instructor_id: teacherId
            }
        });

        // find total rates for this teacher
        const rates = await UserReview.findAll({
            attributes: ['rates'],
            where: {
                instructor_id: teacherId
            }
        });

        // Extract the rates from the database response and convert them to a flat array
        const ratesArray = rates.map((rate) => parseFloat(rate.rates));

        // Function to add all the rates
        const addAllRates = (rates) => {
            if (rates.length === 0) return 0;
            return rates.reduce((acc, rate) => acc + rate, 0);
        };

        // total rates
        const totalRates = addAllRates(ratesArray);

        // total average rates
        const totalAvgRates = totalRates / totalReviewer;

        // Modify the data structure to group occupations under "data" key
        const data = {
            id: teacher.id,
            full_name: teacher.full_name,
            about: teacher.about,
            language: teacher.language,
            avatar: teacher.avatar,
            video_demo: teacher.video_demo,
            video_demo_thumb: teacher.video_demo_thumb,
            occupations: {
                specialties: [],
                also_speaking: [],
                teachings: []
            },
            rate: {
                total_reviews: totalReviewer,
                avgRate: totalAvgRates
            }
        };

        occupations.forEach((occupation) => {
            if (occupation.type === 'specialties') {
                data.occupations.specialties.push(occupation.value);
            } else if (occupation.type === 'teachings') {
                data.occupations.teachings.push(occupation.value);
            } else if (occupation.type === 'also_speaking') {
                data.occupations.also_speaking.push(occupation.value);
            }
        });

        // response
        res.status(200).json({
            status: 'success',
            message: 'Teacher Details',
            data: data
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

/**
 * ! count remaining class subscription date
 */
function calculateSubscriptionDates(subscriptionStartDate) {
    // Parse the input date using Moment.js
    const startDate = moment(subscriptionStartDate).utc();
    const currentDate = moment().utc();

    // Calculate the month gap between the subscription start date and the current date
    const monthGap = currentDate.diff(startDate, 'months');

    // Calculate the start date by adding the month gap to the subscription start date
    const currentStart = startDate.clone().add(monthGap, 'months');

    // Calculate the end date by adding one more month to the current start date
    const currentEnd = currentStart.clone().add(1, 'month');

    // Format the dates as required (DD/MM/YYYY)
    const formattedStartDate = currentStart.toDate();
    const formattedEndDate = currentEnd.toDate();

    return {
        start: formattedStartDate,
        end: formattedEndDate
    };
}

// add class
async function addClass(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        const teacherData = await Users.findOne({
            where: { id: req.body.teacher_id }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }
        let newClass = '';

        // if (user.trial_expired != true) {
        if (user.subscription_id !== null) {
            const subscribedUser = await UserSubscriptionDetails.findOne({
                // attributes: ['id', 'weekly_lesson', 'type', 'lesson_min', 'left_lessons', 'renew_date', 'lesson_reset_at', 'created_at'],
                where: {
                    user_id: user.id
                },
                order: [['created_at', 'DESC']],
                limit: 1
            });

            if (!subscribedUser) {
                return res.status(401).json({ status: 'error', message: 'Your free trial ended, Please subscribe to your plan...' });
            }

            let currentSubscriptionMonth = calculateSubscriptionDates(subscribedUser.created_at);
            let totalClasses = await Class.count({
                where: {
                    student_id: user.id,
                    meeting_start: {
                        [Op.gte]: currentSubscriptionMonth.start,
                        [Op.lt]: currentSubscriptionMonth.end
                    },
                    status: {
                        [Op.ne]: 'canceled'
                    }
                    // subscription_id: subscribedUser.id,
                }
            });
            // let totalClassesData = await Class.findAll({
            //     where: {
            //         student_id: user.id,
            //         updated_at: {
            //             [Op.gte]: currentSubscriptionMonth.start,
            //             [Op.lt]: currentSubscriptionMonth.end,
            //         },
            //         status: {
            //             [Op.ne]: 'canceled',
            //         },
            //         // subscription_id: subscribedUser.id,
            //     },
            // });

            if (subscribedUser.left_lessons == 0) {
                return res.status(402).json({
                    status: 'error',
                    message: 'You have reached your limit for this month',
                    left_lessons: subscribedUser.left_lessons
                    // totalClassesData
                });
            }

            // if (totalClasses >= subscribedUser.weekly_lesson) {
            //     return res.status(402).json({
            //         status: 'error', message: 'You have reached your limit for this month',
            //         weekly_lesson: subscribedUser.weekly_lesson,
            //         totalClassesData
            //     });
            // }

            // let lesson_min = await UserSubscriptionDetails.findOne({
            //     attributes: ['id', 'lesson_min', 'left_lessons'],
            //     where: {
            //         user_id: user.id,
            //     },
            //     order: [['created_at', 'DESC']],
            //     limit: 1,
            // });

            let left_lessons = subscribedUser.left_lessons;

            if (subscribedUser || subscribedUser.left_lessons > 0) {
                const meetingStart = moment(new Date(req.body.meeting_start));

                if (!isNaN(meetingStart)) {
                    if (subscribedUser?.lesson_min > 30) {
                        const nextSlot = meetingStart.clone().add(30, 'minutes');
                        const meetingEnd = moment(meetingStart).add('minute', subscribedUser.lesson_min);
                        const teacherHolidays = await TeacherHoliday.findAll({
                            where: {
                                user_id: req.body.teacher_id,
                                status: 'approved',
                                form_date: { [Op.lte]: nextSlot.toDate() },
                                to_date: { [Op.gte]: nextSlot.toDate() }
                            }
                        });

                        if (teacherHolidays.length > 0) {
                            return res.status(402).json({ status: 'error', message: 'Slot is busy' });
                        }

                        let teachers = await TeacherAvailability.findAll({
                            where: { user_id: req.body.teacher_id }
                        });
                        const dayOfWeek = meetingStart.format('ddd').toLowerCase();
                        const nextSlotformat = nextSlot.toDate();
                        const dateString = nextSlotformat.toISOString();
                        const timeString = dateString.split('T')[1];

                        // Extract just the time part (hours:minutes)
                        const time = timeString.substring(0, 5);

                        const teacherAvailability = teachers.some((teacher) => {
                            const availabilityData = teacher.dataValues[dayOfWeek];
                            const availability = JSON.parse(availabilityData);
                            const isAvailable = availability[time];

                            return isAvailable;
                        });

                        if (!teacherAvailability) {
                            return res.status(402).json({ status: 'error', message: 'Slot is busy' });
                        }

                        let classes = await Class.count({
                            where: {
                                teacher_id: req.body.teacher_id,
                                status: {
                                    [Op.ne]: 'canceled'
                                },
                                meeting_start: nextSlot.toDate()
                            }
                        });
                        if (classes > 0) {
                            return res.status(402).json({ status: 'error', message: 'Slot is busy' });
                        }

                        newClass = await Class.create({
                            student_id: user.id,
                            teacher_id: req.body.teacher_id,
                            meeting_start: meetingStart.toDate(),
                            meeting_end: meetingEnd.toDate(),
                            join_url: teacherData?.enable_zoom_link ? teacherData?.add_zoom_link : null,
                            admin_url: teacherData?.enable_zoom_link ? teacherData?.add_zoom_link : null,
                            // subscription_id: subscribedUser.id,
                            status: 'pending',
                            question_and_answer: totalClasses === 0 ? JSON.stringify(req.body.question_and_answer) : null
                        });

                        await UserSubscriptionDetails.update(
                            {
                                left_lessons: left_lessons - 1
                            },
                            { where: { id: subscribedUser.id } }
                        );
                    } else {
                        const meetingEnd = moment(meetingStart).add('minute', subscribedUser.lesson_min);

                        newClass = await Class.create({
                            student_id: user.id,
                            teacher_id: req.body.teacher_id,
                            meeting_start: meetingStart.toDate(),
                            meeting_end: meetingEnd.toDate(),
                            join_url: teacherData?.enable_zoom_link ? teacherData?.add_zoom_link : null,
                            admin_url: teacherData?.enable_zoom_link ? teacherData?.add_zoom_link : null,
                            // subscription_id: subscribedUser.id,
                            status: 'pending',
                            question_and_answer: totalClasses === 0 ? JSON.stringify(req.body.question_and_answer) : null
                        });

                        await UserSubscriptionDetails.update(
                            {
                                left_lessons: left_lessons - 1
                            },
                            { where: { id: subscribedUser.id } }
                        );
                    }
                } else {
                    return res.status(403).json({ status: 'error', message: 'Invalid meeting_start date' });
                }
            }
            //  else {
            //     const CLASS_DURATION_MINUTES = 25;
            //     const meetingStart = moment(new Date(req.body.meeting_start));
            //     const meetingEnd = moment(meetingStart).add("minute", CLASS_DURATION_MINUTES);

            //     newClass = await Class.create({
            //         student_id: user.id,
            //         teacher_id: req.body.teacher_id,
            //         meeting_start: meetingStart.toDate(),
            //         meeting_end: meetingEnd.toDate(),
            //         // subscription_id: subscribedUser.id,
            //         status: 'pending'
            //     });

            //     await UserSubscriptionDetails.update({
            //         left_lessons: left_lessons - 1
            //     },
            //         { where: { id: subscribedUser.id } }
            //     );
            // }
        } else {
            let totalClasses = await Class.count({
                where: {
                    student_id: user.id,
                    // meeting_start: {
                    //     [Op.gte]: currentSubscriptionMonth.start,
                    //     [Op.lt]: currentSubscriptionMonth.end
                    // },
                    status: {
                        [Op.ne]: 'canceled'
                    }
                    // subscription_id: subscribedUser.id,
                }
            });

            if (totalClasses > 0) {
                return res.status(401).json({ status: 'error', message: 'Your free trial ended, Please subscribe to your plan...' });
            }
            const meetingStart = new Date(req.body.meeting_start);
            const meetingEnd = new Date(meetingStart.getTime() + 25 * 60 * 1000);

            newClass = await Class.create({
                student_id: user.id,
                teacher_id: req.body.teacher_id,
                meeting_start: meetingStart,
                meeting_end: meetingEnd,
                is_trial: true,
                join_url: teacherData?.enable_zoom_link ? teacherData?.add_zoom_link : null,
                admin_url: teacherData?.enable_zoom_link ? teacherData?.add_zoom_link : null,
                question_and_answer: totalClasses === 0 ? JSON.stringify(req.body.question_and_answer) : null
            });
        }
        try {
            // const meetingStart = new Date(req.body.meeting_start);
            const teacherData2 = await Users.findOne({
                where: { id: req.body.teacher_id }
            });
            // Prepare notification options for instructor
            const notifyOptionsTeacher = {
                'instructor.name': teacherData2.full_name,
                'student.name': user.full_name,
                'time.date': moment(req.body.meeting_start).tz(teacherData2.timezone).format('DD/MM/YYYY HH:mm')
                // link: classes_url
            };
            const notifyOptionsStudent = {
                'student.name': user.full_name,
                'instructor.name': teacherData2.full_name,
                'time.date': moment(req.body.meeting_start).tz(user.timezone).format('DD/MM/YYYY HH:mm')
                // link: classes_url
            };

            await whatsappReminderAddClass('lesson_booked', notifyOptionsTeacher, req.body.teacher_id);
            await whatsappReminderAddClass('booking_done', notifyOptionsStudent, user.id);
        } catch (error) {
            console.error('Error calling whatsappReminderAddClass:', error);
            // Handle error appropriately
        }
        // update user trail status
        // await user.update({
        //     trial_expired: true,
        //     where: { id: user.id },
        // });

        // response
        res.status(200).json({
            status: 'success',
            message: 'Class Added Successfully',
            data: newClass
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function addClassV2(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        const teacherData = await Users.findOne({
            where: { id: req.body.teacher_id }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }
        let newClass = '';

        // if (user.trial_expired != true) {
        if (user.subscription_id !== null) {
            const subscribedUser = await UserSubscriptionDetails.findOne({
                // attributes: ['id', 'weekly_lesson', 'type', 'lesson_min', 'left_lessons', 'renew_date', 'lesson_reset_at', 'created_at'],
                where: {
                    user_id: user.id
                },
                order: [['created_at', 'DESC']],
                limit: 1
            });

            if (!subscribedUser) {
                return res.status(401).json({ status: 'error', message: 'Your free trial ended, Please subscribe to your plan...' });
            }
            let nextMonthClasses = await Class.count({
                where: {
                    student_id: user.id,
                    meeting_start: {
                        [Op.gte]: subscribedUser.lesson_reset_at
                    },
                    is_regular_hide: 0,
                    status: 'pending'

                    // subscription_id: subscribedUser.id,
                }
            });

            if (subscribedUser && nextMonthClasses >= subscribedUser.weekly_lesson) {
                return res.status(402).json({
                    status: 'nextMonthClassError',
                    message: `You can't book more then ` + subscribedUser?.weekly_lesson + ` classes because your old subscription only have ` + subscribedUser?.weekly_lesson + ` lessons`
                });
            }
            // if (subscribedUser && subscribedUser.lesson_reset_at < new Date(req.body.meeting_start)) {
            //     return res.status(402).json({ status: 'error', message: 'Time is longer than your subscribed package.' });
            // }

            let currentSubscriptionMonth = calculateSubscriptionDates(subscribedUser.created_at);
            let totalClasses = await Class.count({
                where: {
                    student_id: user.id,
                    meeting_start: {
                        [Op.gte]: currentSubscriptionMonth.start,
                        [Op.lt]: currentSubscriptionMonth.end
                    },
                    status: {
                        [Op.ne]: 'canceled'
                    }
                    // subscription_id: subscribedUser.id,
                }
            });
            // let totalClassesData = await Class.findAll({
            //     where: {
            //         student_id: user.id,
            //         updated_at: {
            //             [Op.gte]: currentSubscriptionMonth.start,
            //             [Op.lt]: currentSubscriptionMonth.end,
            //         },
            //         status: {
            //             [Op.ne]: 'canceled',
            //         },
            //         // subscription_id: subscribedUser.id,
            //     },
            // });
            if (subscribedUser.left_lessons == 0 && req.body.next_month_class_term != 1) {
                return res.status(402).json({
                    status: 'limitError',
                    message: 'You have reached your limit for this month',
                    left_lessons: subscribedUser.left_lessons
                    // totalClassesData
                });
            }

            let left_lessons = subscribedUser.left_lessons;

            if (subscribedUser || subscribedUser.left_lessons > 0) {
                const meetingStart = moment.parseZone(new Date(req.body.meeting_start));
                const meetingStartUTC = moment.parseZone(req.body.meeting_start);
                // const meetingStart = moment.tz(req.body.meeting_start, user.timezone);
                const utcTime = moment.utc(meetingStart).format('HH:mm');

                const meetingEndFor = meetingStart.add('minute', subscribedUser.lesson_min);


                let meetingEnd = "";
                if (!isNaN(meetingStartUTC)) {
                    let teachers = await TeacherAvailability.findAll({
                        where: { user_id: req.body.teacher_id }
                    });
                    const dayOfWeek = meetingStartUTC.format('ddd').toLowerCase();
                    if (subscribedUser?.lesson_min > 30) {
                        const nextSlot = meetingStartUTC.clone().add(30, 'minutes');
                        meetingEnd = moment(meetingStartUTC).add('minute', subscribedUser.lesson_min);
                        const teacherHolidays = await TeacherHoliday.findAll({
                            where: {
                                user_id: req.body.teacher_id,
                                status: 'approved',
                                form_date: { [Op.lte]: nextSlot.toDate() },
                                to_date: { [Op.gte]: nextSlot.toDate() }
                            }
                        });

                        if (teacherHolidays.length > 0) {
                            return res.status(402).json({ status: 'error', message: 'Slot is busy' });
                        }

                        const nextSlotformat = nextSlot.toDate();
                        const dateString = nextSlotformat.toISOString();
                        const timeString = dateString.split('T')[1];

                        // Extract just the time part (hours:minutes)
                        const time = timeString.substring(0, 5);

                        const teacherAvailability = teachers.some((teacher) => {
                            const availabilityData = teacher.dataValues[dayOfWeek];
                            const availability = JSON.parse(availabilityData);
                            const isAvailable = availability[time] && availability[utcTime];

                            return isAvailable;
                        });

                        if (!teacherAvailability) {
                            return res.status(402).json({ status: 'error', message: 'Slot is busy' });
                        }

                        let classes = await Class.count({
                            where: {
                                teacher_id: req.body.teacher_id,
                                status: {
                                    [Op.ne]: 'canceled'
                                },
                                meeting_start: nextSlot.toDate()
                            }
                        });
                        if (classes > 0) {
                            return res.status(402).json({ status: 'error', message: 'Slot is busy' });
                        }


                    } else {
                        meetingEnd = moment(meetingStartUTC).add('minute', subscribedUser.lesson_min);

                        const teacherHolidays = await TeacherHoliday.findAll({
                            where: {
                                user_id: req.body.teacher_id,
                                status: 'approved',
                                form_date: { [Op.lte]: meetingStartUTC.toDate() },
                                to_date: { [Op.gt]: meetingStartUTC.toDate() }
                            }
                        });

                        if (teacherHolidays?.length > 0) {
                            return res.status(402).json({ status: 'teacherError', message: 'Teacher is on holiday' });
                        }

                        const teacherAvailability = teachers.some((teacher) => {
                            const availabilityData = teacher.dataValues[dayOfWeek];
                            const availability = JSON.parse(availabilityData);
                            const isAvailable = availability[utcTime];

                            return isAvailable;
                        });

                        if (!teacherAvailability) {
                            return res.status(402).json({ status: 'teacherError', message: 'Teacher is not available' });
                        }


                    }
                    // Do not book class with same student with 2 different teacher for same slot
                    let sameClasses1 = await Class.count({
                        where: {
                            student_id: user.id,
                            status: {
                                [Op.ne]: 'canceled'
                            },
                            meeting_start: meetingStartUTC,
                            meeting_end: meetingEndFor
                        }
                    });

                    let sameClasses2 = await Class.count({
                        where: {
                            student_id: user.id,
                            status: {
                                [Op.ne]: 'canceled'
                            },
                            meeting_start: { [Op.lt]: meetingEndFor },
                            meeting_end: { [Op.gt]: meetingStartUTC }
                        }
                    });

                    if (sameClasses1 > 0 || sameClasses2 > 0) {
                        return res.status(402).json({ status: 'classError', message: 'You already have a class with another teacher with this slot.' });
                    }

                    // Do not book class with 2 student with same teacher for same slot

                    let sameClassesForTeacher1 = await Class.count({
                        where: {
                            teacher_id: req.body.teacher_id,
                            status: {
                                [Op.ne]: 'canceled'
                            },
                            meeting_start: meetingStartUTC,
                            meeting_end: meetingEndFor
                        }
                    });

                    let sameClassesForTeacher2 = await Class.count({
                        where: {
                            teacher_id: req.body.teacher_id,
                            status: {
                                [Op.ne]: 'canceled'
                            },
                            meeting_start: { [Op.lt]: meetingEndFor },
                            meeting_end: { [Op.gt]: meetingStartUTC }
                        }
                    });

                    if (sameClassesForTeacher1 > 0 || sameClassesForTeacher2 > 0) {
                        return res.status(402).json({ status: 'classError', message: 'Error happened when trying to create your booking' });
                    }
                    const meetingStartDate = meetingStartUTC.toDate();
                    const meetingEndDate = meetingEnd.toDate();

                    newClass = await Class.create({
                        student_id: user.id,
                        teacher_id: req.body.teacher_id,
                        meeting_start: meetingStartDate,
                        meeting_end: meetingEndDate,
                        join_url: teacherData?.enable_zoom_link ? teacherData?.add_zoom_link : null,
                        admin_url: teacherData?.enable_zoom_link ? teacherData?.add_zoom_link : null,
                        // subscription_id: subscribedUser.id,
                        status: 'pending',
                        question_and_answer: totalClasses === 0 ? JSON.stringify(req.body.question_and_answer) : null,
                        next_month_class_term: req.body.next_month_class_term
                    });

                    if (!req.body.next_month_class_term) {
                        await UserSubscriptionDetails.update(
                            {
                                left_lessons: left_lessons - 1
                            },
                            { where: { id: subscribedUser.id } }
                        );
                    }
                } else {
                    return res.status(403).json({ status: 'error', message: 'Invalid meeting_start date' });
                }
            }
            //  else {
            //     const CLASS_DURATION_MINUTES = 25;
            //     const meetingStart = moment(new Date(req.body.meeting_start));
            //     const meetingEnd = moment(meetingStart).add("minute", CLASS_DURATION_MINUTES);

            //     newClass = await Class.create({
            //         student_id: user.id,
            //         teacher_id: req.body.teacher_id,
            //         meeting_start: meetingStart.toDate(),
            //         meeting_end: meetingEnd.toDate(),
            //         // subscription_id: subscribedUser.id,
            //         status: 'pending'
            //     });

            //     await UserSubscriptionDetails.update({
            //         left_lessons: left_lessons - 1
            //     },
            //         { where: { id: subscribedUser.id } }
            //     );
            // }
        } else {
            let totalClasses = await Class.count({
                where: {
                    student_id: user.id,
                    // meeting_start: {
                    //     [Op.gte]: currentSubscriptionMonth.start,
                    //     [Op.lt]: currentSubscriptionMonth.end
                    // },
                    status: {
                        [Op.ne]: 'canceled'
                    }
                    // subscription_id: subscribedUser.id,
                }
            });

            if (totalClasses > 0) {
                return res.status(401).json({ status: 'error', message: 'Your free trial ended, Please subscribe to your plan...' });
            }
            const meetingStartUTC = moment.parseZone(req.body.meeting_start);
            const meetingEndUTC = meetingStartUTC.clone().add(25, 'minutes');

            const meetingStartDate = meetingStartUTC.toDate();
            const meetingEndDate = meetingEndUTC.toDate();

            newClass = await Class.create({
                student_id: user.id,
                teacher_id: req.body.teacher_id,
                meeting_start: meetingStartDate,
                meeting_end: meetingEndDate,
                is_trial: true,
                join_url: teacherData?.enable_zoom_link ? teacherData?.add_zoom_link : null,
                admin_url: teacherData?.enable_zoom_link ? teacherData?.add_zoom_link : null,
                question_and_answer: totalClasses === 0 ? JSON.stringify(req.body.question_and_answer) : null
            });
            await Users.update(
                { trial_expired: totalClasses === 0 ? true : false },
                {
                    where: {
                        id: user.id
                    }
                }
            );
        }
        try {
            // const meetingStart = new Date(req.body.meeting_start);
            const teacherData2 = await Users.findOne({
                where: { id: req.body.teacher_id }
            });
            // Prepare notification options for instructor
            const notifyOptionsTeacher = {
                'instructor.name': teacherData2.full_name,
                'student.name': user.full_name,
                'time.date': moment(req.body.meeting_start).tz(teacherData2.timezone).format('DD/MM/YYYY HH:mm')
                // link: classes_url
            };
            const notifyOptionsStudent = {
                'student.name': user.full_name,
                'instructor.name': teacherData2.full_name,
                'time.date': moment(req.body.meeting_start).tz(user.timezone).format('DD/MM/YYYY HH:mm')
                // link: classes_url
            };

            await whatsappReminderAddClass('lesson_booked', notifyOptionsTeacher, req.body.teacher_id);
            await whatsappReminderAddClass('booking_done', notifyOptionsStudent, user.id);
        } catch (error) {
            console.error('Error calling whatsappReminderAddClass:', error);
            // Handle error appropriately
        }
        // update user trail status
        // await user.update({
        //     trial_expired: true,
        //     where: { id: user.id },
        // });

        // response
        res.status(200).json({
            status: 'success',
            message: 'Class Added Successfully',
            data: newClass
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function addClassV3(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        const teacherData = await Users.findOne({
            where: { id: req.body.teacher_id }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }
        let newClass = '';

        // if (user.trial_expired != true) {
        if (user.subscription_id !== null) {
            const subscribedUser = await UserSubscriptionDetails.findOne({
                // attributes: ['id', 'weekly_lesson', 'type', 'lesson_min', 'left_lessons', 'renew_date', 'lesson_reset_at', 'created_at'],
                where: {
                    user_id: user.id
                },
                order: [['created_at', 'DESC']],
                limit: 1
            });

            if (!subscribedUser) {
                return res.status(401).json({ status: 'error', message: 'Your free trial ended, Please subscribe to your plan...' });
            }
            let nextMonthClasses = await Class.count({
                where: {
                    student_id: user.id,
                    meeting_start: {
                        [Op.gte]: subscribedUser.lesson_reset_at
                    },
                    is_regular_hide: 0,
                    status: 'pending'

                    // subscription_id: subscribedUser.id,
                }
            });
            const meetingUserTimezone = moment(req.body.meeting_start);
            if (!subscribedUser || meetingUserTimezone.isSameOrAfter(moment(subscribedUser.lesson_reset_at).tz(user.timezone).startOf('day'))) {
                if (subscribedUser && nextMonthClasses >= subscribedUser.weekly_lesson) {
                    return res.status(402).json({
                        status: 'nextMonthClassError',
                        message: `You can't book more then ` + subscribedUser?.weekly_lesson + ` classes because your old subscription only have ` + subscribedUser?.weekly_lesson + ` lessons`
                    });
                }
            }
            // if (subscribedUser && subscribedUser.lesson_reset_at < new Date(req.body.meeting_start)) {
            //     return res.status(402).json({ status: 'error', message: 'Time is longer than your subscribed package.' });
            // }

            let currentSubscriptionMonth = calculateSubscriptionDates(subscribedUser.created_at);
            let totalClasses = await Class.count({
                where: {
                    student_id: user.id,
                    meeting_start: {
                        [Op.gte]: currentSubscriptionMonth.start,
                        [Op.lt]: currentSubscriptionMonth.end
                    },
                    status: {
                        [Op.ne]: 'canceled'
                    }
                    // subscription_id: subscribedUser.id,
                }
            });
            // let totalClassesData = await Class.findAll({
            //     where: {
            //         student_id: user.id,
            //         updated_at: {
            //             [Op.gte]: currentSubscriptionMonth.start,
            //             [Op.lt]: currentSubscriptionMonth.end,
            //         },
            //         status: {
            //             [Op.ne]: 'canceled',
            //         },
            //         // subscription_id: subscribedUser.id,
            //     },
            // });

            if (subscribedUser.left_lessons == 0 && req.body.next_month_class_term != 1) {
                return res.status(402).json({
                    status: 'limitError',
                    message: 'You have reached your limit for this month',
                    left_lessons: subscribedUser.left_lessons
                    // totalClassesData
                });
            }

            // if (totalClasses >= subscribedUser.weekly_lesson) {
            //     return res.status(402).json({
            //         status: 'error', message: 'You have reached your limit for this month',
            //         weekly_lesson: subscribedUser.weekly_lesson,
            //         totalClassesData
            //     });
            // }

            // let lesson_min = await UserSubscriptionDetails.findOne({
            //     attributes: ['id', 'lesson_min', 'left_lessons'],
            //     where: {
            //         user_id: user.id,
            //     },
            //     order: [['created_at', 'DESC']],
            //     limit: 1,
            // });

            let left_lessons = subscribedUser.left_lessons;

            if (subscribedUser || subscribedUser.left_lessons > 0) {
                const meetingStart = moment(new Date(req.body.meeting_start));
                // const meetingStart = moment.tz(req.body.meeting_start, user.timezone);
                const utcTime = moment.utc(meetingStart).format('HH:mm');
                const meetingEndFor = moment.utc(meetingStart).add('minute', subscribedUser.lesson_min);


                let meetingEnd = "";
                if (!isNaN(meetingStart)) {
                    let teachers = await TeacherAvailability.findAll({
                        where: { user_id: req.body.teacher_id }
                    });
                    const dayOfWeek = meetingStart.format('ddd').toLowerCase();
                    if (subscribedUser?.lesson_min > 30) {
                        const nextSlot = meetingStart.clone().add(30, 'minutes');
                        meetingEnd = moment(meetingStart).add('minute', subscribedUser.lesson_min);
                        const teacherHolidays = await TeacherHoliday.findAll({
                            where: {
                                user_id: req.body.teacher_id,
                                status: 'approved',
                                form_date: { [Op.lte]: nextSlot.toDate() },
                                to_date: { [Op.gte]: nextSlot.toDate() }
                            }
                        });

                        if (teacherHolidays.length > 0) {
                            return res.status(402).json({ status: 'error', message: 'Slot is busy' });
                        }

                        const nextSlotformat = nextSlot.toDate();
                        const dateString = nextSlotformat.toISOString();
                        const timeString = dateString.split('T')[1];

                        // Extract just the time part (hours:minutes)
                        const time = timeString.substring(0, 5);

                        const teacherAvailability = teachers.some((teacher) => {
                            const availabilityData = teacher.dataValues[dayOfWeek];
                            const availability = JSON.parse(availabilityData);
                            const isAvailable = availability[time] && availability[utcTime];

                            return isAvailable;
                        });

                        if (!teacherAvailability) {
                            return res.status(402).json({ status: 'error', message: 'Slot is busy' });
                        }

                        let classes = await Class.count({
                            where: {
                                teacher_id: req.body.teacher_id,
                                status: {
                                    [Op.ne]: 'canceled'
                                },
                                meeting_start: nextSlot.toDate()
                            }
                        });
                        if (classes > 0) {
                            return res.status(402).json({ status: 'error', message: 'Slot is busy' });
                        }


                    } else {
                        meetingEnd = moment(meetingStart).add('minute', subscribedUser.lesson_min);

                        const teacherHolidays = await TeacherHoliday.findAll({
                            where: {
                                user_id: req.body.teacher_id,
                                status: 'approved',
                                form_date: { [Op.lte]: meetingStart.toDate() },
                                to_date: { [Op.gt]: meetingStart.toDate() }
                            }
                        });

                        if (teacherHolidays?.length > 0) {
                            return res.status(402).json({ status: 'teacherError', message: 'Teacher is on holiday' });
                        }

                        const teacherAvailability = teachers.some((teacher) => {
                            const availabilityData = teacher.dataValues[dayOfWeek];
                            const availability = JSON.parse(availabilityData);
                            const isAvailable = availability[utcTime];

                            return isAvailable;
                        });

                        if (!teacherAvailability) {
                            return res.status(402).json({ status: 'teacherError', message: 'Teacher is not available' });
                        }


                    }
                    // Do not book class with same student with 2 different teacher for same slot
                    let sameClasses1 = await Class.count({
                        where: {
                            student_id: user.id,
                            status: {
                                [Op.ne]: 'canceled'
                            },
                            meeting_start: moment.utc(meetingStart),
                            meeting_end: meetingEndFor
                        }
                    });

                    let sameClasses2 = await Class.count({
                        where: {
                            student_id: user.id,
                            status: {
                                [Op.ne]: 'canceled'
                            },
                            meeting_start: { [Op.lt]: meetingEndFor },
                            meeting_end: { [Op.gt]: moment.utc(meetingStart) }
                        }
                    });

                    if (sameClasses1 > 0 || sameClasses2 > 0) {
                        return res.status(402).json({ status: 'classError', message: 'You already have a class with another teacher with this slot.' });
                    }

                    // Do not book class with 2 student with same teacher for same slot

                    let sameClassesForTeacher1 = await Class.count({
                        where: {
                            teacher_id: req.body.teacher_id,
                            status: {
                                [Op.ne]: 'canceled'
                            },
                            meeting_start: moment.utc(meetingStart),
                            meeting_end: meetingEndFor
                        }
                    });

                    let sameClassesForTeacher2 = await Class.count({
                        where: {
                            teacher_id: req.body.teacher_id,
                            status: {
                                [Op.ne]: 'canceled'
                            },
                            meeting_start: { [Op.lt]: meetingEndFor },
                            meeting_end: { [Op.gt]: moment.utc(meetingStart) }
                        }
                    });
                    const reset30DaysBack = moment(subscribedUser.lesson_reset_at).subtract(30, 'days');
                    const resetDate = moment(subscribedUser.lesson_reset_at).format('YYYY-MM-DD 23:59');

                    // Query the lessons count
                    const lessonCount = await Class.count({
                        where: {
                            meeting_end: {
                                [Op.gt]: reset30DaysBack.toDate(),
                                [Op.lt]: new Date(resetDate)
                            },
                            status: {
                                [Op.ne]: 'canceled'
                            },
                            student_id: user.id
                        }
                    });
                    const meetingData = {
                        student_id: user.id,
                        teacher_id: req.body.teacher_id,
                        meeting_start: meetingStart.toDate(),
                        meeting_end: meetingEnd.toDate(),
                        join_url: teacherData?.enable_zoom_link ? teacherData?.add_zoom_link : null,
                        admin_url: teacherData?.enable_zoom_link ? teacherData?.add_zoom_link : null,
                        // subscription_id: subscribedUser.id,
                        status: 'pending',
                        question_and_answer: totalClasses === 0 ? JSON.stringify(req.body.question_and_answer) : null,
                        next_month_class_term: req.body.next_month_class_term
                    };

                    // Bonus class handling
                    if (lessonCount >= subscribedUser.weekly_lesson && req.body.next_month_class_term != 1) {
                        if (subscribedUser.bonus_class > 0 && subscribedUser.left_lessons <= subscribedUser.bonus_class && subscribedUser.bonus_class !== subscribedUser.bonus_completed_class) {
                            const bonusExpireDate = moment(subscribedUser.bonus_expire_date).format('YYYY-MM-DD');
                            const bonusExpireDateUserTimezone = moment(bonusExpireDate).tz(user.timezone).endOf('day');

                            if (bonusExpireDateUserTimezone.isBefore(meetingUserTimezone)) {
                                return res.status(402).json({ status: 'classError', message: 'You can\'t book a bonus class after the expiry date.' });
                            }
                        }
                    }
                    if (lessonCount >= subscribedUser.weekly_lesson && req.body.next_month_class_term != 1) {
                        if (subscribedUser.bonus_class > 0 && subscribedUser.left_lessons <= subscribedUser.bonus_class && subscribedUser.bonus_class !== subscribedUser.bonus_completed_class) {
                            const bonusExpireDate = moment(subscribedUser.bonus_expire_date).format('YYYY-MM-DD');
                            const bonusExpireDateUserTimezone = moment(bonusExpireDate).tz(user.timezone).endOf('day');

                            if (!bonusExpireDateUserTimezone.isBefore(meetingUserTimezone)) {
                                meetingData.bonus_class = 1;
                                subscribedUser.bonus_completed_class += 1;
                                await subscribedUser.save();
                            }
                        }
                    }

                    if (sameClassesForTeacher1 > 0 || sameClassesForTeacher2 > 0) {
                        return res.status(402).json({ status: 'classError', message: 'Error happened when trying to create your booking' });
                    }

                    newClass = await Class.create(meetingData);
                    // await Users.update(
                    //     { trial_expired: totalClasses === 0 ? true : false },
                    //     {
                    //         where: {
                    //             id: user.id
                    //         }
                    //     }
                    // );
                    if (!req.body.next_month_class_term) {
                        await UserSubscriptionDetails.update(
                            {
                                left_lessons: left_lessons - 1
                            },
                            { where: { id: subscribedUser.id } }
                        );
                    }
                } else {
                    return res.status(403).json({ status: 'error', message: 'Invalid meeting_start date' });
                }
            }
            //  else {
            //     const CLASS_DURATION_MINUTES = 25;
            //     const meetingStart = moment(new Date(req.body.meeting_start));
            //     const meetingEnd = moment(meetingStart).add("minute", CLASS_DURATION_MINUTES);

            //     newClass = await Class.create({
            //         student_id: user.id,
            //         teacher_id: req.body.teacher_id,
            //         meeting_start: meetingStart.toDate(),
            //         meeting_end: meetingEnd.toDate(),
            //         // subscription_id: subscribedUser.id,
            //         status: 'pending'
            //     });

            //     await UserSubscriptionDetails.update({
            //         left_lessons: left_lessons - 1
            //     },
            //         { where: { id: subscribedUser.id } }
            //     );
            // }
        } else {
            let totalClasses = await Class.count({
                where: {
                    student_id: user.id,
                    // meeting_start: {
                    //     [Op.gte]: currentSubscriptionMonth.start,
                    //     [Op.lt]: currentSubscriptionMonth.end
                    // },
                    status: {
                        [Op.ne]: 'canceled'
                    }
                    // subscription_id: subscribedUser.id,
                }
            });

            if (totalClasses > 0) {
                return res.status(401).json({ status: 'error', message: 'Your free trial ended, Please subscribe to your plan...' });
            }
            const meetingStart = new Date(req.body.meeting_start);
            const meetingEnd = new Date(meetingStart.getTime() + 25 * 60 * 1000);

            newClass = await Class.create({
                student_id: user.id,
                teacher_id: req.body.teacher_id,
                meeting_start: meetingStart,
                meeting_end: meetingEnd,
                is_trial: true,
                join_url: teacherData?.enable_zoom_link ? teacherData?.add_zoom_link : null,
                admin_url: teacherData?.enable_zoom_link ? teacherData?.add_zoom_link : null,
                question_and_answer: totalClasses === 0 ? JSON.stringify(req.body.question_and_answer) : null
            });
            await Users.update(
                { trial_expired: totalClasses === 0 ? true : false },
                {
                    where: {
                        id: user.id
                    }
                }
            );
        }
        try {
            // const meetingStart = new Date(req.body.meeting_start);
            const teacherData2 = await Users.findOne({
                where: { id: req.body.teacher_id }
            });
            // Prepare notification options for instructor
            const notifyOptionsTeacher = {
                'instructor.name': teacherData2.full_name,
                'student.name': user.full_name,
                'time.date': moment(req.body.meeting_start).tz(teacherData2.timezone).format('DD/MM/YYYY HH:mm')
                // link: classes_url
            };
            const notifyOptionsStudent = {
                'student.name': user.full_name,
                'instructor.name': teacherData2.full_name,
                'time.date': moment(req.body.meeting_start).tz(user.timezone).format('DD/MM/YYYY HH:mm')
                // link: classes_url
            };

            await whatsappReminderAddClass('lesson_booked', notifyOptionsTeacher, req.body.teacher_id);
            await whatsappReminderAddClass('booking_done', notifyOptionsStudent, user.id);
        } catch (error) {
            console.error('Error calling whatsappReminderAddClass:', error);
            // Handle error appropriately
        }
        // update user trail status
        // await user.update({
        //     trial_expired: true,
        //     where: { id: user.id },
        // });

        // response
        res.status(200).json({
            status: 'success',
            message: 'Class Added Successfully',
            data: newClass
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Edit class
async function editClass(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const classId = req.params.id;

        let classes = await Class.findOne({
            where: { id: classId }
        });

        if (!classes || classes.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Class does not exist' });
        }

        let lesson_min = await UserSubscriptionDetails.findOne({
            attributes: ['lesson_min'],
            where: {
                user_id: user.id
            },
            order: [['created_at', 'DESC']],
            limit: 1
        });

        let [rowsUpdated] = '';

        if (lesson_min || lesson_min.lesson_min > 0) {
            const meetingStart = moment(new Date(req.body.meeting_start));
            if (!isNaN(meetingStart)) {
                const meetingEnd = moment(meetingStart).add('minute', lesson_min.lesson_min);
                [rowsUpdated] = await Class.update(
                    {
                        student_id: user.id,
                        meeting_start: meetingStart,
                        meeting_end: meetingEnd,
                        status: 'pending'
                    },
                    { where: { id: classId } }
                );
            } else {
                return res.status(403).json({ status: 'error', message: 'Invalid meeting_start date' });
            }
        } else {
            const CLASS_DURATION_MINUTES = 25;
            const meetingStart = moment(new Date(req.body.meeting_start));
            const meetingEnd = moment(meetingStart).add('minute', CLASS_DURATION_MINUTES);
            [rowsUpdated] = await Class.update(
                {
                    student_id: user.id,
                    teacher_id: req.body.teacher_id,
                    meeting_start: meetingStart,
                    meeting_end: meetingEnd,
                    status: 'pending'
                },
                { where: { id: classId } }
            );
        }

        if (rowsUpdated === 0) {
            return res.status(400).json({ status: 'error', message: 'Failed rescheduling class' });
        }

        // Fetch the updated class
        const updatedClass = await Class.findOne({ where: { id: classId } });

        // response
        res.status(200).json({
            status: 'success',
            message: 'Class Rescheduled Successfully',
            data: updatedClass
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function editClassV2(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const classId = req.params.id;

        let classes = await Class.findOne({
            where: { id: classId }
        });

        if (!classes || classes.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Class does not exist' });
        }

        let subscribedUser = await UserSubscriptionDetails.findOne({
            attributes: ['id', 'lesson_min', 'lesson_reset_at', 'weekly_lesson', 'left_lessons'],
            where: {
                user_id: user.id
            },
            order: [['created_at', 'DESC']],
            limit: 1
        });

        if (user.subscription_id !== null) {
            let nextMonthClasses = await Class.count({
                where: {
                    student_id: user.id,
                    meeting_start: {
                        [Op.gte]: subscribedUser.lesson_reset_at
                    },
                    status: 'pending'

                    // subscription_id: subscribedUser.id,
                }
            });

            // if (subscribedUser && nextMonthClasses >= subscribedUser.weekly_lesson) {
            //     return res.status(402).json({
            //         status: 'nextMonthClassError',
            //         message: `You can't book more then ` + subscribedUser?.weekly_lesson + ` classes because your old subscription only have ` + subscribedUser?.weekly_lesson + ` lessons`
            //     });
            // }
        }
        // if (subscribedUser && subscribedUser.lesson_reset_at < new Date(req.body.meeting_start)) {
        //     return res.status(402).json({ status: 'error', message: 'Time is longer than your subscribed package.' });
        // }

        let [rowsUpdated] = '';

        if (subscribedUser || subscribedUser?.lesson_min > 0) {
            const meetingStart = moment(new Date(req.body.meeting_start));
            // const meetingStart = moment.tz(req.body.meeting_start, user.timezone);
            const utcTime = moment.utc(meetingStart).format('HH:mm');
            const meetingEndFor = moment.utc(meetingStart).add('minute', subscribedUser.lesson_min);

            // Do not book class with same student with 2 different teacher for same slot
            let sameClasses1 = await Class.count({
                where: {
                    student_id: user.id,
                    status: {
                        [Op.ne]: 'canceled'
                    },
                    meeting_start: { [Op.gte]: moment.utc(meetingStart) },
                    meeting_end: { [Op.lte]: meetingEndFor }
                }
            });

            let sameClasses2 = await Class.count({
                where: {
                    student_id: user.id,
                    status: {
                        [Op.ne]: 'canceled'
                    },
                    meeting_start: { [Op.lt]: meetingEndFor },
                    meeting_end: { [Op.gt]: moment.utc(meetingStart) }
                }
            });

            if (sameClasses1 > 0 || sameClasses2 > 0) {
                return res.status(402).json({ status: 'classError', message: 'You already have a class with another teacher with this slot.' });
            }

            // Do not book class with 2 student with same teacher for same slot

            let sameClassesForTeacher1 = await Class.count({
                where: {
                    teacher_id: req.body.teacher_id,
                    status: {
                        [Op.ne]: 'canceled'
                    },
                    meeting_start: { [Op.gte]: moment.utc(meetingStart) },
                    meeting_end: { [Op.lte]: meetingEndFor }
                }
            });

            let sameClassesForTeacher2 = await Class.count({
                where: {
                    teacher_id: req.body.teacher_id,
                    status: {
                        [Op.ne]: 'canceled'
                    },
                    meeting_start: { [Op.lt]: meetingEndFor },
                    meeting_end: { [Op.gt]: moment.utc(meetingStart) }
                }
            });

            if (sameClassesForTeacher1 > 0 || sameClassesForTeacher2 > 0) {
                return res.status(402).json({ status: 'classError', message: 'Error happened when trying to create your booking' });
            }

            if (!isNaN(meetingStart)) {
                let teachers = await TeacherAvailability.findAll({
                    where: { user_id: req.body.teacher_id }
                });
                const dayOfWeek = meetingStart.format('ddd').toLowerCase();
                if (subscribedUser?.lesson_min > 30) {
                    const nextSlot = meetingStart.clone().add(30, 'minutes');
                    const meetingEnd = moment(meetingStart).add('minute', subscribedUser?.lesson_min);

                    const teacherHolidays = await TeacherHoliday.findAll({
                        where: {
                            user_id: req.body.teacher_id,
                            status: 'approved',
                            form_date: { [Op.lte]: nextSlot.toDate() },
                            to_date: { [Op.gte]: nextSlot.toDate() }
                        }
                    });

                    if (teacherHolidays.length > 0) {
                        return res.status(402).json({ status: 'error', message: 'Slot is busy' });
                    }

                    const nextSlotformat = nextSlot.toDate();
                    const dateString = nextSlotformat.toISOString();
                    const timeString = dateString.split('T')[1];

                    // Extract just the time part (hours:minutes)
                    const time = timeString.substring(0, 5);

                    const teacherAvailability = teachers.some((teacher) => {
                        const availabilityData = teacher.dataValues[dayOfWeek];
                        const availability = JSON.parse(availabilityData);
                        const isAvailable = availability[time] && availability[utcTime];

                        return isAvailable;
                    });

                    if (!teacherAvailability) {
                        return res.status(402).json({ status: 'error', message: 'Slot is busy' });
                    }

                    let teacherclasses = await Class.count({
                        where: {
                            teacher_id: classes.teacher_id,
                            status: {
                                [Op.ne]: 'canceled'
                            },
                            meeting_start: nextSlot.toDate()
                        }
                    });

                    if (teacherclasses > 0) {
                        return res.status(402).json({ status: 'error', message: 'Slot is busy' });
                    }

                    [rowsUpdated] = await Class.update(
                        {
                            student_id: user.id,
                            meeting_start: meetingStart,
                            meeting_end: meetingEnd,
                            status: 'pending',
                            next_month_class_term: req.body.next_month_class_term,
                            class_type: 'app'
                        },
                        { where: { id: classId } }
                    );
                } else {
                    const meetingEnd = moment(meetingStart).add('minute', subscribedUser?.lesson_min);

                    const teacherHolidays = await TeacherHoliday.findAll({
                        where: {
                            user_id: req.body.teacher_id,
                            status: 'approved',
                            form_date: { [Op.lte]: meetingStart.toDate() },
                            to_date: { [Op.gt]: meetingStart.toDate() }
                        }
                    });

                    if (teacherHolidays.length > 0) {
                        return res.status(402).json({ status: 'teacherError', message: 'Teacher is on holiday' });
                    }

                    const teacherAvailability = teachers.some((teacher) => {
                        const availabilityData = teacher.dataValues[dayOfWeek];
                        const availability = JSON.parse(availabilityData);
                        const isAvailable = availability[utcTime];

                        return isAvailable;
                    });

                    if (!teacherAvailability) {
                        return res.status(402).json({ status: 'teacherError', message: 'Teacher is not available' });
                    }
                    [rowsUpdated] = await Class.update(
                        {
                            student_id: user.id,
                            meeting_start: meetingStart,
                            meeting_end: meetingEnd,
                            status: 'pending',
                            next_month_class_term: req.body.next_month_class_term,
                            class_type: 'app'
                        },
                        { where: { id: classId } }
                    );
                }

                if (subscribedUser?.lesson_reset_at < new Date(req.body.meeting_start) && !classes?.next_month_class_term) {
                    await UserSubscriptionDetails.update(
                        {
                            left_lessons: subscribedUser?.left_lessons + 1
                        },
                        { where: { id: subscribedUser?.id } }
                    );
                }

                if (subscribedUser?.lesson_reset_at > new Date(req.body.meeting_start) && classes?.next_month_class_term) {
                    await UserSubscriptionDetails.update(
                        {
                            left_lessons: subscribedUser?.left_lessons - 1
                        },
                        { where: { id: subscribedUser?.id } }
                    );
                }
            } else {
                return res.status(403).json({ status: 'error', message: 'Invalid meeting_start date' });
            }
        } else {
            const CLASS_DURATION_MINUTES = 25;
            const meetingStart = moment(new Date(req.body.meeting_start));
            // const meetingStart = moment.tz(req.body.meeting_start, user.timezone);
            const meetingEnd = moment(meetingStart).add('minute', CLASS_DURATION_MINUTES);
            [rowsUpdated] = await Class.update(
                {
                    student_id: user.id,
                    teacher_id: req.body.teacher_id,
                    meeting_start: meetingStart,
                    meeting_end: meetingEnd,
                    status: 'pending',
                    class_type: 'app'
                },
                { where: { id: classId } }
            );
        }

        // Prepare notification options for instructor
        try {
            const teacherData2 = await Users.findOne({
                where: { id: classes.teacher_id }
            });
            const notifyOptionsTeacher = {
                'student.name': user.full_name,
                'old.time': moment(classes.meeting_start).tz(teacherData2.timezone).format('DD/MM/YYYY HH:mm'),
                'new.time': moment(req.body.meeting_start).tz(teacherData2.timezone).format('DD/MM/YYYY HH:mm')
                // link: classes_url
            };

            await whatsappReminderAddClass('student_class_rescheduled', notifyOptionsTeacher, classes.teacher_id);
        } catch (error) {
            console.error('Error calling whatsappReminderAddClass:', error);
            // Handle error appropriately
        }
        if (rowsUpdated === 0) {
            return res.status(400).json({ status: 'error', message: 'Failed rescheduling class' });
        }

        // Fetch the updated class
        const updatedClass = await Class.findOne({ where: { id: classId } });

        // response
        res.status(200).json({
            status: 'success',
            message: 'Class Rescheduled Successfully',
            data: updatedClass
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function viewClasses(req, res) {
    try {
        const userId = req.userId;

        // 1. Get user data
        let user = await Users.findOne({
            where: { id: userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const DEFAULT_PAGE_SIZE = 25;
        const page = Number(req.query.page || 1);
        const limit = Number(req.query.limit || DEFAULT_PAGE_SIZE);
        const offset = (page - 1) * limit;

        const status = req.query.status;
        const whereClause = {
            student_id: user.id,
            status: {
                [Op.not]: 'canceled'
            },
            is_regular_hide: {
                [Op.not]: 1
            }
        };

        if (status) {
            whereClause.status = status;
        }

        // 2. Get class data and total count in parallel
        const [classData, totalCount] = await Promise.all([
            Class.findAll({
                attributes: ['id', 'teacher_id', 'is_trial', 'meeting_start', 'meeting_end', 'status', 'join_url', 'admin_url', 'feedback_id', 'is_regular_hide', 'is_present'],
                where: whereClause,
                order: [
                    ['status', 'DESC'],
                    ['meeting_start', 'DESC']
                ],
                limit: limit,
                offset: offset
            }),
            Class.count({ where: whereClause })
        ]);

        if (!classData || classData.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Classes do not exist for this user' });
        }

        // 3. Get all teacher IDs
        const teacherIds = [...new Set(classData.map(item => item.teacher_id))];

        // 4. Get all class IDs
        const classIds = classData.map(item => item.id);

        // 5. Fetch teachers, homework data and class queries in parallel
        const [teachers, allHomework, allStudentAnswers, allClassQueries] = await Promise.all([
            Users.findAll({
                attributes: ['id', 'full_name', 'about', 'language', 'avatar', 'video_demo', 'video_demo_thumb', 'enable_zoom_link', 'add_zoom_link', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code'],
                where: { id: teacherIds }
            }),
            Homework.findAll({
                attributes: [
                    'id',
                    'description',
                    'teacher_id',
                    'student_id',
                    'lesson_id',
                    'toggle_attachment_for_student',
                    'toggle_description_for_student'
                ],
                where: {
                    teacher_id: teacherIds,
                    student_id: user.id,
                    lesson_id: classIds
                }
            }),
            Homework.findAll({
                attributes: ['lesson_id', 'student_answers', 'answer_attachment', 'attachment'],
                where: { lesson_id: classIds }
            }),
            StudentClassQuery.findAll({
                // attributes: ['id', 'class_id', 'query_text', 'attachment', 'created_at'],
                where: { 
                    student_id: user.id,
                    class_id: classIds
                }
            })
        ]);

        if (!teachers || teachers.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No teachers found for the classes' });
        }

        // 5.1. Fetch occupations and reviews for all teachers in parallel
        const [allOccupations, allReviews] = await Promise.all([
            UserOccupation.findAll({
                attributes: ['user_id', 'type', 'value'],
                where: {
                    user_id: teacherIds
                }
            }),
            UserReview.findAll({
                attributes: ['instructor_id', 'rates'],
                where: {
                    instructor_id: teacherIds
                }
            })
        ]);

        // Create lookup maps for faster access
        const teacherMap = teachers.reduce((acc, teacher) => {
            acc[teacher.id] = teacher;
            return acc;
        }, {});

        // Create occupations map grouped by teacher_id
        const occupationsMap = {};
        allOccupations.forEach((occ) => {
            if (!occupationsMap[occ.user_id]) {
                occupationsMap[occ.user_id] = [];
            }
            occupationsMap[occ.user_id].push(occ);
        });

        // Create reviews map grouped by instructor_id and calculate ratings
        const ratingsMap = {};
        allReviews.forEach((review) => {
            if (!ratingsMap[review.instructor_id]) {
                ratingsMap[review.instructor_id] = [];
            }
            ratingsMap[review.instructor_id].push(parseFloat(review.rates));
        });

        // Calculate average ratings for each teacher
        const teacherRatingsMap = {};
        teacherIds.forEach((teacherId) => {
            const rates = ratingsMap[teacherId] || [];
            const totalReviewer = rates.length;
            const totalRates = rates.reduce((acc, rate) => acc + rate, 0);
            const totalAvgRates = totalReviewer > 0 ? totalRates / totalReviewer : 0;
            
            teacherRatingsMap[teacherId] = {
                total_reviews: totalReviewer,
                avgRate: totalAvgRates
            };
        });

        const homeworkMap = allHomework.reduce((acc, hw) => {
            acc[hw.lesson_id] = hw;
            return acc;
        }, {});

        const studentAnswersMap = allStudentAnswers.reduce((acc, ans) => {
            acc[ans.lesson_id] = ans;
            return acc;
        }, {});

        // Group queries by class_id
        const classQueriesMap = allClassQueries.reduce((acc, query) => {
            if (!acc[query.class_id]) {
                acc[query.class_id] = [];
            }
            acc[query.class_id].push(query);
            return acc;
        }, {});

        // Get current time for the 4-hour calculation
        const currentTime = new Date();
        
        // 6. Process all data without async operations
        const response = classData.map((classItem) => {
            const teacher = teacherMap[classItem.teacher_id];
            const homework = homeworkMap[classItem.id];
            const studentAnswers = studentAnswersMap[classItem.id];
            const classQueries = classQueriesMap[classItem.id] || [];

            const utcMeetingStartTime = classItem.meeting_start;
            const utcMeetingEndTime = classItem.meeting_end;
            const timezone = user.timezone;
            
            // Calculate if class is within 4 hours
            const meetingStartTime = new Date(utcMeetingStartTime);
            const fourHoursInMillis = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
            const isWithinFourHours = (meetingStartTime - currentTime) <= fourHoursInMillis && 
                                      (meetingStartTime - currentTime) > 0;

            // Get occupations for this teacher
            const teacherOccupations = occupationsMap[classItem.teacher_id] || [];
            const teacherRating = teacherRatingsMap[classItem.teacher_id] || { total_reviews: 0, avgRate: 0 };

            return {
                id: classItem.id,
                teacher_id: classItem.teacher_id,
                full_name: teacher ? teacher.full_name : 'Unknown Teacher',
                avatar: teacher ? teacher.avatar : '',
                teacher: teacher ? {
                    id: teacher.id,
                    full_name: teacher.full_name,
                    about: teacher.about,
                    language: teacher.language,
                    avatar: teacher.avatar,
                    video_demo: teacher.video_demo,
                    video_demo_thumb: teacher.video_demo_thumb,
                    enable_zoom_link: teacher.enable_zoom_link,
                    add_zoom_link: teacher.add_zoom_link,
                    add_zoom_link_meeting_id: teacher.dataValues.add_zoom_link_meeting_id,
                    add_zoom_link_access_code: teacher.dataValues.add_zoom_link_access_code,
                    occupations: {
                        specialties: teacherOccupations.filter((occ) => occ.type === 'specialties').map((occ) => occ.value),
                        also_speaking: teacherOccupations.filter((occ) => occ.type === 'also_speaking').map((occ) => occ.value),
                        teachings: teacherOccupations.filter((occ) => occ.type === 'teachings').map((occ) => occ.value),
                        levels: teacherOccupations.filter((occ) => occ.type === 'levels').map((occ) => occ.value)
                    },
                    rate: {
                        total_reviews: teacherRating.total_reviews,
                        avgRate: teacherRating.avgRate
                    }
                } : null,
                timezone: timezone,
                is_trial: classItem.is_trial,
                meeting_start: getLocalDateTime(utcMeetingStartTime, timezone),
                meeting_end: getLocalDateTime(utcMeetingEndTime, timezone),
                status: classItem.status,
                is_present: classItem.is_present,
                join_url: classItem.join_url,
                admin_url: classItem.admin_url,
                feedback_id: classItem.feedback_id,
                feedback: !!classItem.feedback_id,
                homework: !!homework,
                student_answers: studentAnswers?.student_answers || null,
                answer_attachment: studentAnswers?.answer_attachment || null,
                attachment: studentAnswers?.attachment || null,
                homework_description: homework?.description || null,
                class_queries: classQueries.length > 0 ? classQueries : null,
                has_queries: classQueries.length > 0,
                is_within_four_hours: isWithinFourHours // New field indicating if class is within 4 hours
            };
        });

        const totalPages = Math.ceil(totalCount / limit);

        res.status(200).json({
            status: 'success',
            message: 'Classes and Details',
            currentPage: page,
            limit: limit,
            totalClasses: totalCount,
            totalPages: totalPages,
            data: response
        });

    } catch (error) {
        console.error('Error in viewClasses:', error);
        res.status(500).json({ status: 'error', message: 'An error occurred' });
    }
}

// view class details by ID
async function viewClassDetails(req, res) {
    try {
        const userId = req.userId;
        const classId = req.params.id;

        if (!classId) {
            return res.status(400).json({ status: 'error', message: 'Class ID is required' });
        }

        // 1. Get user data
        let user = await Users.findOne({
            where: { id: userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // 2. Get class data
        const classItem = await Class.findOne({
            attributes: [
                'id', 'teacher_id', 'is_trial', 'meeting_start', 'meeting_end',
                'status', 'join_url', 'admin_url', 'feedback_id',
                'is_regular_hide', 'is_present', 'recording_status',   
                'recording_url'  
            ],
            where: {
                id: classId,
                student_id: user.id,
                is_regular_hide: {
                    [Op.not]: 1
                }
            }
        });

        if (!classItem) {
            return res.status(404).json({ status: 'error', message: 'Class not found or you do not have access to this class' });
        }

        // 3. Get teacher data
        const teacher = await Users.findOne({
            // attributes: ['id', 'full_name', 'avatar'],
            where: { id: classItem.teacher_id }
        });

        if (!teacher) {
            return res.status(404).json({ status: 'error', message: 'Teacher not found for this class' });
        }

        // 3.1. Fetch teacher occupations and reviews
        const [occupations, totalReviewer, rates] = await Promise.all([
            UserOccupation.findAll({
                attributes: ['type', 'value'],
                where: {
                    user_id: teacher.id
                }
            }),
            UserReview.count({
                where: {
                    instructor_id: teacher.id
                }
            }),
            UserReview.findAll({
                attributes: ['rates'],
                where: {
                    instructor_id: teacher.id
                }
            })
        ]);

        // Calculate average rating
        const ratesArray = rates.map((rate) => parseFloat(rate.rates));
        const totalRates = ratesArray.reduce((acc, rate) => acc + rate, 0);
        const totalAvgRates = totalReviewer > 0 ? totalRates / totalReviewer : 0;

        // 4. Fetch homework, answers, queries, and class summary in parallel
        const [homework, studentAnswers, classQueries, classSummary, gamesData] = await Promise.all([
            Homework.findOne({
                attributes: [
                    'id',
                    'description',
                    'teacher_id',
                    'student_id',
                    'lesson_id',
                    'toggle_attachment_for_student',
                    'toggle_description_for_student'
                ],
                where: {
                    teacher_id: classItem.teacher_id,
                    student_id: user.id,
                    lesson_id: classItem.id
                }
            }),
            Homework.findOne({
                attributes: ['lesson_id', 'student_answers', 'answer_attachment', 'attachment'],
                where: { lesson_id: classItem.id }
            }),
            StudentClassQuery.findAll({
                where: { 
                    student_id: user.id,
                    class_id: classItem.id
                }
            }),
            ClassSummary.findOne({
                attributes: ['summary_text', 'vocabulary_learned', 'strengths', 'areas_for_improvement'],
                where: {
                    class_id: classItem.id
                }
            }),
            Games.findAll({
                attributes: ['exercise_type', 'exercise_explanation'],
                where: {
                    class_id: classItem.id,
                    student_id: user.id,
                                    },
                group: ['exercise_type', 'exercise_explanation']
            })
        ]);

        // Format games available (only type + exercise_explanation)
        const gamesAvailable = gamesData.map((game) => ({
            exercise_type: game.exercise_type,
            exercise_explanation: game.exercise_explanation
        }));

        // Get current time for the 4-hour calculation
        const currentTime = new Date();
        
        const utcMeetingStartTime = classItem.meeting_start;
        const utcMeetingEndTime = classItem.meeting_end;
        const timezone = user.timezone;
        
        // Calculate if class is within 4 hours
        const meetingStartTime = new Date(utcMeetingStartTime);
        const fourHoursInMillis = 4 * 60 * 60 * 1000;
        const isWithinFourHours =
            (meetingStartTime - currentTime) <= fourHoursInMillis &&
            (meetingStartTime - currentTime) > 0;

        // Calculate class duration
        let classDuration = null;
        if (utcMeetingStartTime && utcMeetingEndTime) {
            const start = new Date(utcMeetingStartTime);
            const end = new Date(utcMeetingEndTime);
            const diffMs = end - start;

            const totalMinutes = Math.floor(diffMs / 60000);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;

            classDuration = `${hours}h ${minutes}m`;
        }

        // Final response object
        const response = {
            id: classItem.id,
            teacher: {
                id: teacher.id,
                full_name: teacher.full_name,
                about: teacher.about,
                language: teacher.language,
                avatar: teacher.avatar,
                video_demo: teacher.video_demo,
                video_demo_thumb: teacher.video_demo_thumb,
                enable_zoom_link: teacher.enable_zoom_link,
                add_zoom_link: teacher.add_zoom_link,
                add_zoom_link_meeting_id: teacher.dataValues.add_zoom_link_meeting_id,
                add_zoom_link_access_code: teacher.dataValues.add_zoom_link_access_code,
                occupations: {
                    specialties: occupations.filter((occ) => occ.type === 'specialties').map((occ) => occ.value),
                    also_speaking: occupations.filter((occ) => occ.type === 'also_speaking').map((occ) => occ.value),
                    teachings: occupations.filter((occ) => occ.type === 'teachings').map((occ) => occ.value),
                    levels: occupations.filter((occ) => occ.type === 'levels').map((occ) => occ.value)
                },
                rate: {
                    total_reviews: totalReviewer,
                    avgRate: totalAvgRates
                }
            },
            teacher_feedback: {
                strengths: classSummary?.strengths || null,
                areas_for_improvement: classSummary?.areas_for_improvement || null
            },

            timezone: timezone,
            is_trial: classItem.is_trial,
            meeting_start: getLocalDateTime(utcMeetingStartTime, timezone),
            meeting_end: getLocalDateTime(utcMeetingEndTime, timezone),
            status: classItem.status,
            is_present: classItem.is_present,
            join_url: classItem.join_url,
            admin_url: classItem.admin_url,
            feedback_id: classItem.feedback_id,
            feedback: !!classItem.feedback_id,
            homework: !!homework,
            student_answers: studentAnswers?.student_answers || null,
            answer_attachment: studentAnswers?.answer_attachment || null,
            attachment: studentAnswers?.attachment || null,
            homework_description: homework?.description || null,
            class_queries: classQueries.length > 0 ? classQueries : null,
            has_queries: classQueries.length > 0,
            is_within_four_hours: isWithinFourHours,
            lesson_summary: classSummary?.summary_text || null,
            word_learned: classSummary?.vocabulary_learned || [],
            class_duration: classDuration,
            recording_status: classItem.recording_status,
            recording_url: classItem.recording_url,
            games_available: gamesAvailable
        };

        res.status(200).json({
            status: 'success',
            message: 'Class Details',
            data: response
        });

    } catch (error) {
        console.error('Error in viewClassDetails:', error);
        res.status(500).json({ status: 'error', message: 'An error occurred' });
    }
}



// view classes Home
async function viewClassesHome_old(req, res) {
    try {
        const userId = req.userId;

        let user = await Users.findOne({
            where: { id: userId }
        });
        const filePath = 'test.txt';
        const userCheck = `-----------------Start------------------------${userId}----------Start-------------`;
        const userCheckEnd = `-----------------End------------------------${userId}----------End-------------`;
        const responseuserString = JSON.stringify(user);

        const dataToAppendUser = `${userCheck}\n${responseuserString}\n${userCheckEnd}\n`;

        fs.appendFile(filePath, dataToAppendUser, 'utf8', (err) => {
            if (err) {
                // console.error('Error appending to file:', err);
                return;
            }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const whereClause = {
            student_id: user.id
        };

        const today = new Date();
        // Calculate the date 30 days from now
        const next30Days = new Date();
        next30Days.setDate(next30Days.getDate() + 30);

        whereClause.meeting_start = {
            [Sequelize.Op.and]: {
                [Op.and]: [
                    { [Op.gte]: today }, // Greater than or equal to today
                    { [Op.lte]: next30Days } // Less than or equal to 30 days from now
                ]
            }
        };

        let classData = await Class.findAll({
            attributes: ['id', 'teacher_id', 'is_trial', 'meeting_start', 'meeting_end', 'status', 'join_url', 'admin_url', 'join_url', 'feedback_id'],
            where: whereClause,
            order: [['meeting_start', 'ASC']]
        });

        if (!classData || classData.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Classes do not exist for this user' });
        }

        let teacherIds = classData.map((classItem) => classItem.teacher_id);

        let teachers = await Users.findAll({
            attributes: ['id', 'full_name', 'avatar'],
            where: { id: teacherIds }
        });

        if (!teachers || teachers.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No teachers found for the classes' });
        }

        let response = await Promise.all(
            classData.map(async (classItem) => {
                let teacher = teachers.find((teacher) => teacher.id === classItem.teacher_id);

                // Check if teacher is found before accessing its properties
                let full_name = teacher ? teacher.full_name : 'Unknown Teacher';
                let avatar = teacher ? teacher.avatar : '';

                const utcMeetingStartTime = classItem.meeting_start;
                const utcMeetingEndTime = classItem.meeting_end;
                const timezone = user.timezone;

                const localMeetingStartTime = getLocalDateTime(utcMeetingStartTime, timezone);
                const localMeetingEndTime = getLocalDateTime(utcMeetingEndTime, timezone);

                return {
                    id: classItem.id,
                    teacher_id: classItem.teacher_id,
                    full_name: full_name,
                    avatar: avatar,
                    timezone: user.timezone,
                    is_trial: classItem.is_trial,
                    // meeting_start: classItem.meeting_start,
                    // meeting_end: classItem.meeting_end,
                    meeting_start: localMeetingStartTime,
                    meeting_end: localMeetingEndTime,
                    status: classItem.status,
                    join_url: classItem.join_url,
                    join_url: classItem.join_url,
                    admin_url: classItem.admin_url
                };
            })
        );

        // File path where you want to write the response

        const userEmailCheck = `-----------------Start------------------${user.email}----------------Start-------------`;
        const userEmailCheckEnd = `-----------------End------------------${user.email}----------------End-------------`;
        const responseString = JSON.stringify(response);

        const dataToAppend = `${userEmailCheck}\n${responseString}\n${userEmailCheckEnd}\n`;

        fs.appendFile(filePath, dataToAppend, 'utf8', (err) => {
            if (err) {
                return;
            }
        });
        // Send the response
        res.status(200).json({
            status: 'success',
            message: 'Classes and Details',
            data: response
        });
    } catch (error) {
        // Handle errors appropriately
        res.status(500).json({ status: 'error', message: 'An error occurred' });
    }
}

// new viewclass
async function viewClassesHome(req, res) {
    try {
        const userId = req.userId;

        let user = await Users.findOne({
            where: { id: userId }
        });


        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const whereClause = {
            student_id: user.id
        };

        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);

        // const startOfToday = new Date(today.setHours(0, 0, 0, 0)); // Resets to local midnight

        // Calculate the date 30 days from now
        const next30Days = new Date();
        next30Days.setDate(next30Days.getDate() + 30);

        whereClause.meeting_start = {
            [Sequelize.Op.and]: {
                [Op.and]: [
                    { [Op.gte]: today }, // Greater than or equal to today
                    { [Op.lte]: next30Days } // Less than or equal to 30 days from now
                ]
            }
        };
        whereClause.is_regular_hide = {
            [Op.not]: 1
        };

        let classData = await Class.findAll({
            attributes: ['id', 'teacher_id', 'is_trial', 'meeting_start', 'meeting_end', 'status', 'join_url', 'admin_url', 'join_url', 'feedback_id', 'is_regular_hide', 'is_present'],
            where: whereClause,
            order: [['meeting_start', 'ASC']]
        });

        // exit();
        if (!classData || classData.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Classes do not exist for this user' });
        }

        let teacherIds = classData.map((classItem) => classItem.teacher_id);

        let teachers = await Users.findAll({
            attributes: ['id', 'full_name', 'avatar'],
            where: { id: teacherIds }
        });

        if (!teachers || teachers.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No teachers found for the classes' });
        }

        let response = await Promise.all(
            classData.map(async (classItem) => {
                let teacher = teachers.find((teacher) => teacher.id === classItem.teacher_id);

                // Check if teacher is found before accessing its properties
                let full_name = teacher ? teacher.full_name : 'Unknown Teacher';
                let avatar = teacher ? teacher.avatar : '';

                const utcMeetingStartTime = classItem.meeting_start;
                const utcMeetingEndTime = classItem.meeting_end;
                const timezone = user.timezone;

                const localMeetingStartTime = getLocalDateTime(utcMeetingStartTime, timezone);
                const localMeetingEndTime = getLocalDateTime(utcMeetingEndTime, timezone);

                return {
                    id: classItem.id,
                    teacher_id: classItem.teacher_id,
                    full_name: full_name,
                    avatar: avatar,
                    timezone: user.timezone,
                    is_trial: classItem.is_trial,
                    // meeting_start: classItem.meeting_start,
                    // meeting_end: classItem.meeting_end,
                    meeting_start: localMeetingStartTime,
                    meeting_end: localMeetingEndTime,
                    status: classItem.status,
                    is_present: classItem.is_present,
                    join_url: classItem.join_url,
                    join_url: classItem.join_url,
                    admin_url: classItem.admin_url
                };
            })
        );

        // Send the response
        res.status(200).json({
            status: 'success',
            message: 'Classes and Details',
            data: response
        });
    } catch (error) {
        // Handle errors appropriately
        // console.error(error);
        res.status(500).json({ status: 'error', message: 'An error occurred' });
    }
}

// cancel class by student
async function cancelClass(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const classId = req.params.id;

        let classes = await Class.findOne({
            where: { id: classId }
        });
        if (!classes || classes.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Class does not exist' });
        }
        // check class already cancelled or not
        if (classes.status === 'canceled') {
            return res.status(401).json({ status: 'error', message: 'Class already canceled' });
        }

        // Update the class with the new status
        const [rowsUpdated] = await Class.update({ status: 'canceled' }, { where: { id: classId } });

        if (rowsUpdated === 0) {
            return res.status(404).json({ status: 'error', message: 'Class cancel Failed' });
        }

        let lesson_min = await UserSubscriptionDetails.findOne({
            attributes: ['id', 'lesson_min', 'left_lessons'],
            where: {
                user_id: user.id
            },
            order: [['created_at', 'DESC']],
            limit: 1
        });

        let left_lessons = lesson_min.left_lessons;

        await UserSubscriptionDetails.update(
            {
                left_lessons: left_lessons + 1
            },
            { where: { id: lesson_min.id } }
        );

        const teacherData2 = await Users.findOne({
            where: { id: classes.teacher_id }
        });
        // Prepare notification options for instructor
        try {
            const notifyOptionsTeacher = {
                'instructor.name': teacherData2.full_name,
                'student.name': user.full_name,
                'class.time': moment(classes.meeting_start).tz(teacherData2.timezone).format('DD/MM/YYYY HH:mm')
                // link: classes_url
            };
            await whatsappReminderAddClass('student_class_cancelled', notifyOptionsTeacher, classes.teacher_id);
        } catch (error) {
            // console.error('Error calling whatsappReminderAddClass:', error);
            // Handle error appropriately
        }

        // response
        res.status(200).json({
            status: 'success',
            message: 'Class has been canceled'
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function cancelClassV2(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const classId = req.params.id;

        let classes = await Class.findOne({
            where: { id: classId }
        });
        if (!classes || classes.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Class does not exist' });
        }

        // check class already cancelled or not
        if (classes.status === 'canceled') {
            return res.status(401).json({ status: 'error', message: 'Class already canceled' });
        }

        // Update the class with the new status
        const [rowsUpdated] = await Class.update({ status: 'canceled', class_type: 'app' }, { where: { id: classId } });

        if (rowsUpdated === 0) {
            return res.status(404).json({ status: 'error', message: 'Class cancel Failed' });
        }

        let lesson_min = await UserSubscriptionDetails.findOne({
            attributes: ['id', 'lesson_min', 'left_lessons'],
            where: {
                user_id: user.id
            },
            order: [['created_at', 'DESC']],
            limit: 1
        });

        if (lesson_min && !classes?.next_month_class_term) {
            let left_lessons = lesson_min?.left_lessons;

            await UserSubscriptionDetails.update(
                {
                    left_lessons: left_lessons + 1
                },
                { where: { id: lesson_min.id } }
            );
        }

        const teacherData2 = await Users.findOne({
            where: { id: classes.teacher_id }
        });
        // Prepare notification options for instructor
        try {
            const notifyOptionsTeacher = {
                'student.name': user.full_name,
                'class.time': moment(classes.meeting_start).tz(teacherData2.timezone).format('DD/MM/YYYY HH:mm')
                // link: classes_url
            };
            await whatsappReminderAddClass('student_class_cancelled', notifyOptionsTeacher, classes.teacher_id);
        } catch (error) {
            // console.error('Error calling whatsappReminderAddClass:', error);
            // Handle error appropriately
        }

        // response
        res.status(200).json({
            status: 'success',
            message: 'Class has been canceled'
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function cancelClassV3(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const classId = req.params.id;

        let classes = await Class.findOne({
            where: { id: classId }
        });
        if (!classes || classes.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Class does not exist' });
        }

        // check class already cancelled or not
        if (classes.status === 'canceled') {
            return res.status(401).json({ status: 'error', message: 'Class already canceled' });
        }

        // Update the class with the new status
        const [rowsUpdated] = await Class.update({ status: 'canceled', class_type: 'app' }, { where: { id: classId } });

        if (rowsUpdated === 0) {
            return res.status(404).json({ status: 'error', message: 'Class cancel Failed' });
        }

        let subscription = await UserSubscriptionDetails.findOne({
            attributes: ['id', 'lesson_min', 'left_lessons', 'weekly_lesson', 'bonus_class', 'bonus_completed_class'],
            where: {
                user_id: user.id
            },
            order: [['created_at', 'DESC']],
            limit: 1
        });
        let left_lessons = subscription.left_lessons;
        let bonus_completed_class = subscription.bonus_completed_class;
        if (subscription && !classes?.next_month_class_term) {
            if (subscription.left_lessons < subscription.weekly_lesson && subscription.bonus_class > 0 && classes.bonus_class) {
                if (subscription.bonus_class >= subscription.bonus_completed_class && subscription.bonus_completed_class > 0) {
                    bonus_completed_class -= 1;
                    // subscription.bonus_completed_class -= 1;

                    await UserSubscriptionDetails.update(
                        { bonus_completed_class },
                        { where: { id: subscription.id } }
                    );
                }
            }
            left_lessons += 1;

            await UserSubscriptionDetails.update(
                { left_lessons },
                { where: { id: subscription.id } }
            );
        }
        // if (subscription && !classes?.next_month_class_term) {
        //     let left_lessons = subscription?.left_lessons;

        //     await UserSubscriptionDetails.update(
        //         {
        //             left_lessons: left_lessons + 1
        //         },
        //         { where: { id: subscription.id } }
        //     );
        // }

        const teacherData2 = await Users.findOne({
            where: { id: classes.teacher_id }
        });
        // Prepare notification options for instructor
        try {
            const notifyOptionsTeacher = {
                'student.name': user.full_name,
                'class.time': moment(classes.meeting_start).tz(teacherData2.timezone).format('DD/MM/YYYY HH:mm')
                // link: classes_url
            };
            await whatsappReminderAddClass('student_class_cancelled', notifyOptionsTeacher, classes.teacher_id);
        } catch (error) {
            // console.error('Error calling whatsappReminderAddClass:', error);
            // Handle error appropriately
        }

        // response
        res.status(200).json({
            status: 'success',
            message: 'Class has been canceled'
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// cancel class with reason
async function cancelClassWithReason(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const classId = req.params.id;
        const { cancellation_reason } = req.body;

        // Validate cancellation_reason
        if (!cancellation_reason || cancellation_reason.trim() === '') {
            return res.status(400).json({ status: 'error', message: 'Cancellation reason is required' });
        }

        let classes = await Class.findOne({
            where: { id: classId }
        });

        if (!classes) {
            return res.status(404).json({ status: 'error', message: 'Class does not exist' });
        }

        // Check if class already cancelled
        if (classes.status === 'canceled') {
            return res.status(401).json({ status: 'error', message: 'Class already canceled' });
        }

        // Prepare update data with cancellation fields
        const updateData = {
            status: 'canceled',
            class_type: 'app',
            cancellation_reason: cancellation_reason.trim(),
            cancelled_by: user.id,
            cancelled_at: new Date()
        };

        // Update the class with the new status and cancellation details
        const [rowsUpdated] = await Class.update(updateData, { where: { id: classId } });

        if (rowsUpdated === 0) {
            return res.status(404).json({ status: 'error', message: 'Class cancel Failed' });
        }

        let lesson_min = await UserSubscriptionDetails.findOne({
            attributes: ['id', 'lesson_min', 'left_lessons'],
            where: {
                user_id: user.id
            },
            order: [['created_at', 'DESC']],
            limit: 1
        });

        if (lesson_min && !classes?.next_month_class_term) {
            let left_lessons = lesson_min?.left_lessons;

            await UserSubscriptionDetails.update(
                {
                    left_lessons: left_lessons + 1
                },
                { where: { id: lesson_min.id } }
            );
        }

        const teacherData2 = await Users.findOne({
            where: { id: classes.teacher_id }
        });

        // Prepare notification options for instructor
        try {
            const notifyOptionsTeacher = {
                'student.name': user.full_name,
                'class.time': moment(classes.meeting_start).tz(teacherData2.timezone).format('DD/MM/YYYY HH:mm')
            };
            await whatsappReminderAddClass('student_class_cancelled', notifyOptionsTeacher, classes.teacher_id);
        } catch (error) {
            // Handle error appropriately
        }

        // response
        res.status(200).json({
            status: 'success',
            message: 'Class has been canceled with reason'
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// teacher availability
async function teacherAvailability(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        let teachers = await TeacherAvailability.findAll({
            where: { user_id: req.params.id }
        });

        let teachers_holiday = await TeacherHoliday.findAll({
            where: { user_id: req.params.id, status: 'approved' }
        });

        const today = new Date();
        const next7Days = new Date(today);
        next7Days.setDate(today.getDate() + 35);

        const teacher_holiday_dates = teachers_holiday
            .filter((holiday) => {
                const startDate = new Date(holiday.dataValues.form_date);
                return startDate >= today && startDate <= next7Days;
            })
            .map((holiday) => ({
                startDate: new Date(holiday.dataValues.form_date),
                endDate: new Date(holiday.dataValues.to_date)
            }));

        if (!teachers || teachers.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Teacher does not exist' });
        }

        let teacher = teachers[0];
        let ultimateData = getNext7Days();

        // Fetch booked classes for the specified teacher
        let bookedClasses = await Class.findAll({
            where: {
                teacher_id: req.params.id,
                meeting_start: {
                    [Op.gte]: moment(ultimateData[0].date, 'DD/MM/YYYY').toDate(),
                    [Op.lte]: moment(ultimateData[ultimateData.length - 1].date, 'DD/MM/YYYY').toDate()
                },
                status: 'pending'
                // status: {
                //     [Op.ne]: 'canceled',
                // },
            }
        });

        // bookedClasses = bookedClasses.toJSON();

        bookedClasses = bookedClasses.map((classInstance) => classInstance.get());

        ultimateData = ultimateData.map((item) => {
            const { date, day } = item;
            // Get current date and time
            const currentDate = new Date();
            const currentHour = currentDate.getHours();

            // Calculate the end time for next 8 hours
            const next8Hours = new Date(currentDate);
            next8Hours.setHours(next8Hours.getHours() + 8);
            let timeSlots = Object.entries(JSON.parse(teacher[day]))
                .sort()
                .map(([time, isAvailable]) => {
                    let { utc, utcTime, local, localTime } = convertToTimezones(`${date} ${time}`, user.timezone);

                    let isClassBooked = bookedClasses.some((bookedClass) => {
                        let meeting_start_ts = new Date(bookedClass.meeting_start).getTime();
                        let meeting_end_ts = new Date(bookedClass.meeting_end).getTime();
                        let utc_ts = new Date(utc).getTime();
                        let utc_end_ts = moment(new Date(utc)).add(29, 'minute').toDate().getTime();
                        return (
                            (meeting_start_ts >= utc_ts && meeting_start_ts <= utc_end_ts) ||
                            (meeting_end_ts >= utc_ts && meeting_end_ts <= utc_end_ts) ||
                            (meeting_start_ts <= utc_ts && meeting_end_ts >= utc_end_ts)
                        );
                    });

                    let isHoliday = teacher_holiday_dates.some((holiday) => {
                        let utc_end_ts = moment(new Date(utc)).add(29, 'minute').toDate().getTime();
                        return (
                            (utc >= holiday.startDate && utc <= holiday.endDate) ||
                            (utc_end_ts >= holiday.startDate && utc_end_ts <= holiday.endDate) ||
                            (holiday.startDate >= utc && holiday.endDate <= utc_end_ts)
                        );
                    });

                    // Check if the time slot falls within the next 8 hours
                    const timeSlotDate = new Date(utc);
                    const isWithinNext8Hours = timeSlotDate > currentDate && timeSlotDate < next8Hours;

                    return {
                        isAvailable: isAvailable && !isClassBooked && !isHoliday && !isWithinNext8Hours, // Mark availability based on existing availability and class booking
                        time,
                        utcTime,
                        utcDate: utc,
                        localTime,
                        localDate: local
                    };
                });

            return {
                day,
                date,
                timeSlots: timeSlots
            };
        });

        // response
        res.status(200).json({
            status: 'success',
            message: 'available time',
            // bookedClasses,
            data: ultimateData
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function teacherAvailabilityV2(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        let teachers = await TeacherAvailability.findAll({
            where: { user_id: req.params.id }
        });

        let teachers_holiday = await TeacherHoliday.findAll({
            where: { user_id: req.params.id, status: 'approved' }
        });

        const today = new Date();
        const next7Days = new Date(today);
        next7Days.setDate(today.getDate() + 35);

        const teacher_holiday_dates = teachers_holiday
            .filter((holiday) => {
                const startDate = new Date(holiday.dataValues.form_date);
                return startDate >= today && startDate <= next7Days;
            })
            .map((holiday) => ({
                startDate: new Date(holiday.dataValues.form_date),
                endDate: new Date(holiday.dataValues.to_date)
            }));

        if (!teachers || teachers.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Teacher does not exist' });
        }

        let teacher = teachers[0];
        let ultimateData = getNext7Days();

        // Fetch booked classes for the specified teacher
        let bookedClasses = await Class.findAll({
            where: {
                teacher_id: req.params.id,
                meeting_start: {
                    [Op.gte]: moment(ultimateData[0].date, 'DD/MM/YYYY').toDate(),
                    [Op.lte]: moment(ultimateData[ultimateData.length - 1].date, 'DD/MM/YYYY').toDate()
                },
                status: 'pending'
                // status: {
                //     [Op.ne]: 'canceled',
                // },
            }
        });

        // bookedClasses = bookedClasses.toJSON();

        bookedClasses = bookedClasses.map((classInstance) => classInstance.get());
        const storedSchedule = {
            mon: JSON.parse(teacher['mon']),
            tue: JSON.parse(teacher['tue']),
            wed: JSON.parse(teacher['wed']),
            thu: JSON.parse(teacher['thu']),
            fri: JSON.parse(teacher['fri']),
            sat: JSON.parse(teacher['sat']),
            sun: JSON.parse(teacher['sun'])
        };
        // Example usage
        const userTimezone = user.timezone; // Change this to the user's timezone
        const convertedSchedule = convertScheduleToUserTimezone(storedSchedule, userTimezone);

        ultimateData = ultimateData.map((item) => {
            const { date, day } = item;
            // Get current date and time
            const currentDate = new Date();
            const currentHour = currentDate.getHours();

            // Calculate the end time for next 8 hours
            const next8Hours = new Date(currentDate);
            next8Hours.setHours(next8Hours.getHours() + 8);
            // File path where you want to write the response
            const filePath = 'day.txt';

            const userEmailCheck = `-----------------Start------------------${day}----------------Start-------------`;
            const userEmailCheckEnd = `-----------------End------------------${day}----------------End-------------`;
            const responseString = JSON.stringify(convertedSchedule[day]);
            const dataToAppend = `${userEmailCheck}\n${responseString}\n${userEmailCheckEnd}\n`;

            fs.appendFile(filePath, dataToAppend, 'utf8', (err) => {
                if (err) {
                    // console.error('Error appending to file:', err);
                    return;
                }
            });
            let timeSlots = Object.entries(convertedSchedule[day])
                .sort()
                .map(([time, isAvailable]) => {
                    let { utc, utcTime, local, localTime } = convertToTimezonesV2(`${date} ${time}`, user.timezone);

                    let isClassBooked = bookedClasses.some((bookedClass) => {
                        let meeting_start_ts = new Date(bookedClass.meeting_start).getTime();
                        let meeting_end_ts = new Date(bookedClass.meeting_end).getTime();
                        let utc_ts = new Date(utc).getTime();
                        let utc_end_ts = moment(new Date(utc)).add(29, 'minute').toDate().getTime();
                        return (
                            (meeting_start_ts >= utc_ts && meeting_start_ts <= utc_end_ts) ||
                            (meeting_end_ts >= utc_ts && meeting_end_ts <= utc_end_ts) ||
                            (meeting_start_ts <= utc_ts && meeting_end_ts >= utc_end_ts)
                        );
                    });

                    let isHoliday = teacher_holiday_dates.some((holiday) => {
                        let utc_end_ts = moment(new Date(utc)).add(29, 'minute').toDate().getTime();
                        return (
                            (utc >= holiday.startDate && utc <= holiday.endDate) ||
                            (utc_end_ts >= holiday.startDate && utc_end_ts <= holiday.endDate) ||
                            (holiday.startDate >= utc && holiday.endDate <= utc_end_ts)
                        );
                    });

                    // Check if the time slot falls within the next 8 hours
                    const timeSlotDate = new Date(utc);
                    const isWithinNext8Hours = timeSlotDate > currentDate && timeSlotDate < next8Hours;

                    return {
                        isAvailable: isAvailable && !isClassBooked && !isHoliday && !isWithinNext8Hours, // Mark availability based on existing availability and class booking
                        time,
                        utcTime,
                        utcDate: utc,
                        localTime,
                        localDate: local
                    };
                });
            return {
                day,
                date,
                timeSlots: timeSlots
            };
        });

        // response
        res.status(200).json({
            status: 'success',
            message: 'available time',
            // bookedClasses,
            data: ultimateData
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function teacherAvailabilityV3(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        let teachers = await TeacherAvailability.findAll({
            where: { user_id: req.params.id }
        });

        let teachers_holiday = await TeacherHoliday.findAll({
            where: { user_id: req.params.id, status: 'approved' }
        });

        const today = new Date();
        const next7Days = new Date(today);
        next7Days.setDate(today.getDate() + 35);

        const teacher_holiday_dates = teachers_holiday
            .filter((holiday) => {
                const startDate = new Date(holiday.dataValues.form_date);
                return startDate >= today && startDate <= next7Days;
            })
            .map((holiday) => ({
                startDate: new Date(holiday.dataValues.form_date),
                endDate: new Date(holiday.dataValues.to_date)
            }));

        if (!teachers || teachers.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Teacher does not exist' });
        }

        let teacher = teachers[0];
        let ultimateData = getNext7Days();

        // Fetch booked classes for the specified teacher
        let bookedClasses = await Class.findAll({
            where: {
                teacher_id: req.params.id,
                meeting_start: {
                    [Op.gte]: moment(ultimateData[0].date, 'DD/MM/YYYY').toDate(),
                    [Op.lte]: moment(ultimateData[ultimateData.length - 1].date, 'DD/MM/YYYY').toDate()
                },
                status: 'pending'
                // status: {
                //     [Op.ne]: 'canceled',
                // },
            }
        });

        // bookedClasses = bookedClasses.toJSON();

        bookedClasses = bookedClasses.map((classInstance) => classInstance.get());

        ultimateData = ultimateData.map((item) => {
            const { date, day } = item;
            const currentDate = new Date();
            const currentHour = currentDate.getHours();

            const next8Hours = new Date(currentDate);
            next8Hours.setHours(next8Hours.getHours() + 8);
            let timeSlots = Object.entries(JSON.parse(teacher[day]))
                .sort()
                .map(([time, isAvailable]) => {
                    let { utc, utcTime, local, localTime } = convertToTimezones(`${date} ${time}`, user.timezone);

                    let isClassBooked = bookedClasses.some((bookedClass) => {
                        let meeting_start_ts = new Date(bookedClass.meeting_start).getTime();
                        let meeting_end_ts = new Date(bookedClass.meeting_end).getTime();
                        let utc_ts = new Date(utc).getTime();
                        let utc_end_ts = moment(new Date(utc)).add(29, 'minute').toDate().getTime();
                        return (
                            (meeting_start_ts >= utc_ts && meeting_start_ts <= utc_end_ts) ||
                            (meeting_end_ts >= utc_ts && meeting_end_ts <= utc_end_ts) ||
                            (meeting_start_ts <= utc_ts && meeting_end_ts >= utc_end_ts)
                        );
                    });

                    let isHoliday = teacher_holiday_dates.some((holiday) => {
                        let utc_end_ts = moment(new Date(utc)).add(29, 'minute').toDate().getTime();
                        return (
                            (utc >= holiday.startDate && utc <= holiday.endDate) ||
                            (utc_end_ts >= holiday.startDate && utc_end_ts <= holiday.endDate) ||
                            (holiday.startDate >= utc && holiday.endDate <= utc_end_ts)
                        );
                    });

                    const timeSlotDate = new Date(utc);
                    const isPastTime = timeSlotDate <= currentDate;
                    const isWithinNext8Hours = timeSlotDate > currentDate && timeSlotDate <= next8Hours;

                    return {
                        isAvailable: isAvailable && !isClassBooked && !isHoliday && !isPastTime && !isWithinNext8Hours,
                        time,
                        utcTime,
                        utcDate: utc,
                        localTime,
                        localDate: local
                    };

                    // return {
                    //     isAvailable: isAvailable && !isClassBooked && !isHoliday,
                    //     time,
                    //     utcTime,
                    //     utcDate: utc,
                    //     localTime,
                    //     localDate: local
                    // };
                });

            // Sort the timeSlots by localDate
            timeSlots.sort((a, b) => new Date(a.localDate) - new Date(b.localDate));

            return {
                day,
                date,
                timeSlots: timeSlots
            };
        });

        // Sort ultimateData based on the localDate of the first timeSlot
        ultimateData.sort((a, b) => {
            const aFirstLocalDate = a.timeSlots[0] ? new Date(a.timeSlots[0].localDate) : new Date();
            const bFirstLocalDate = b.timeSlots[0] ? new Date(b.timeSlots[0].localDate) : new Date();
            return aFirstLocalDate - bFirstLocalDate;
        });

        // Grouping time slots by local date and correcting the day association
        const groupedUltimateData = ultimateData.reduce((acc, { day, date, timeSlots }) => {
            timeSlots.forEach((slot) => {
                const slotLocalDate = slot.localDate.split('T')[0]; // Get only the date part
                if (!acc[slotLocalDate]) {
                    acc[slotLocalDate] = [];
                }
                acc[slotLocalDate].push(slot);
            });
            return acc;
        }, {});

        // Logging the grouped data
        const newUltimateData = Object.keys(groupedUltimateData).map((localDate) => {
            const slots = groupedUltimateData[localDate];
            const { day, date } = ultimateData.find(({ timeSlots }) =>
                timeSlots.some((slot) => slot.localDate.split('T')[0] === localDate)
            );

            const allSlotsUnavailable = slots.every(slot => !slot.isAvailable);
            
            return {
                day,
                date: formatDate(localDate),
                timeSlots: slots,
                noAvailableSlots: allSlotsUnavailable
            };
        });

        res.status(200).json({
            status: 'success',
            message: 'available time',
            // bookedClasses,
            data: newUltimateData
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function teacherAvailabilityV4(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // Get the lesson duration from the user's subscription
        const userSubscription = await UserSubscriptionDetails.findOne({
            where: { user_id: req.userId }
        });
        
        // Default to 30 minutes if no subscription found, otherwise use the subscription's lesson_min
        const lessonDuration = userSubscription ? userSubscription.lesson_min : 30;

        let teachers = await TeacherAvailability.findAll({
            where: { user_id: req.params.id }
        });

        let teachers_holiday = await TeacherHoliday.findAll({
            where: { user_id: req.params.id, status: 'approved' }
        });

        const today = new Date();
        const next7Days = new Date(today);
        next7Days.setDate(today.getDate() + 35);

        const teacher_holiday_dates = teachers_holiday
            .filter((holiday) => {
                const startDate = new Date(holiday.dataValues.form_date);
                return startDate >= today && startDate <= next7Days;
            })
            .map((holiday) => ({
                startDate: new Date(holiday.dataValues.form_date),
                endDate: new Date(holiday.dataValues.to_date)
            }));

        if (!teachers || teachers.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Teacher does not exist' });
        }

        let teacher = teachers[0];
        let ultimateData = getNext7Days();

        // Fetch booked classes for the specified teacher
        let bookedClasses = await Class.findAll({
            where: {
                teacher_id: req.params.id,
                meeting_start: {
                    [Op.gte]: moment(ultimateData[0].date, 'DD/MM/YYYY').toDate(),
                    [Op.lte]: moment(ultimateData[ultimateData.length - 1].date, 'DD/MM/YYYY').toDate()
                },
                status: 'pending'
            }
        });

        bookedClasses = bookedClasses.map((classInstance) => classInstance.get());

        const currentDate = new Date();
        const currentHour = currentDate.getHours();
        const next8Hours = new Date(currentDate);
        next8Hours.setHours(next8Hours.getHours() + 8);

        ultimateData = ultimateData.map((item) => {
            const { date, day } = item;
            
            // Get all time slots for this day
            let allTimeSlots = Object.entries(JSON.parse(teacher[day]))
                .sort()
                .map(([time, isAvailable]) => {
                    let { utc, utcTime, local, localTime } = convertToTimezones(`${date} ${time}`, user.timezone);

                    let isClassBooked = bookedClasses.some((bookedClass) => {
                        let meeting_start_ts = new Date(bookedClass.meeting_start).getTime();
                        let meeting_end_ts = new Date(bookedClass.meeting_end).getTime();
                        let utc_ts = new Date(utc).getTime();
                        let utc_end_ts = moment(new Date(utc)).add(29, 'minute').toDate().getTime();
                        return (
                            (meeting_start_ts >= utc_ts && meeting_start_ts <= utc_end_ts) ||
                            (meeting_end_ts >= utc_ts && meeting_end_ts <= utc_end_ts) ||
                            (meeting_start_ts <= utc_ts && meeting_end_ts >= utc_end_ts)
                        );
                    });

                    let isHoliday = teacher_holiday_dates.some((holiday) => {
                        let utc_end_ts = moment(new Date(utc)).add(29, 'minute').toDate().getTime();
                        return (
                            (utc >= holiday.startDate && utc <= holiday.endDate) ||
                            (utc_end_ts >= holiday.startDate && utc_end_ts <= holiday.endDate) ||
                            (holiday.startDate >= utc && holiday.endDate <= utc_end_ts)
                        );
                    });

                    const timeSlotDate = new Date(utc);
                    const isWithinNext8Hours = timeSlotDate > currentDate && timeSlotDate < next8Hours;

                    return {
                        baseIsAvailable: isAvailable && !isClassBooked && !isHoliday && !isWithinNext8Hours,
                        isAvailable: isAvailable && !isClassBooked && !isHoliday && !isWithinNext8Hours, // Will be updated later
                        time,
                        utcTime,
                        utcDate: utc,
                        localTime,
                        localDate: local
                    };
                });

            // Sort the timeSlots by localDate
            allTimeSlots.sort((a, b) => new Date(a.localDate) - new Date(b.localDate));

            // Now check for consecutive slots if lesson duration is > 30 minutes
            if (lessonDuration > 30) {
                // Create a map of time slots by local time for easier lookup
                const timeSlotMap = new Map(allTimeSlots.map(slot => [slot.localTime, slot]));
                
                // Process each time slot to check if there are enough consecutive slots
                allTimeSlots = allTimeSlots.map(slot => {
                    if (!slot.baseIsAvailable) {
                        return slot; // If not available, no need to check consecutive slots
                    }
                    
                    // Calculate how many additional 30-min slots we need
                    const requiredAdditionalSlots = Math.ceil(lessonDuration / 30) - 1;
                    
                    // Check if we have enough consecutive slots
                    let hasEnoughTime = true;
                    const currentTime = moment(slot.localTime, 'HH:mm');
                    
                    for (let i = 1; i <= requiredAdditionalSlots; i++) {
                        const nextTime = moment(currentTime)
                            .add(i * 30, 'minutes')
                            .format('HH:mm');
                        const nextSlot = timeSlotMap.get(nextTime);
                        
                        // If any of the required consecutive slots is not available, mark as unavailable
                        if (!nextSlot || !nextSlot.baseIsAvailable) {
                            hasEnoughTime = false;
                            break;
                        }
                    }
                    
                    // Update the isAvailable flag based on consecutive slot availability
                    return {
                        ...slot,
                        isAvailable: hasEnoughTime
                    };
                });
            }

            return {
                day,
                date,
                timeSlots: allTimeSlots
            };
        });

        // Sort ultimateData based on the localDate of the first timeSlot
        ultimateData.sort((a, b) => {
            const aFirstLocalDate = a.timeSlots[0] ? new Date(a.timeSlots[0].localDate) : new Date();
            const bFirstLocalDate = b.timeSlots[0] ? new Date(b.timeSlots[0].localDate) : new Date();
            return aFirstLocalDate - bFirstLocalDate;
        });

        // Grouping time slots by local date and correcting the day association
        const groupedUltimateData = ultimateData.reduce((acc, { day, date, timeSlots }) => {
            timeSlots.forEach((slot) => {
                const slotLocalDate = slot.localDate.split('T')[0]; // Get only the date part
                if (!acc[slotLocalDate]) {
                    acc[slotLocalDate] = [];
                }
                acc[slotLocalDate].push(slot);
            });
            return acc;
        }, {});

        // Create the final data structure
        const newUltimateData = Object.keys(groupedUltimateData).map((localDate) => {
            const slots = groupedUltimateData[localDate];
            const { day, date } = ultimateData.find(({ timeSlots }) =>
                timeSlots.some((slot) => slot.localDate.split('T')[0] === localDate)
            );

            return {
                day,
                date: formatDate(localDate),
                timeSlots: slots
            };
        });

        // Return the response
        res.status(200).json({
            status: 'success',
            message: 'available time',
            data: newUltimateData
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}
// add homework
async function homeWorks(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const page = Number(req.query.page || 1);
        const limit = Number(req.query.limit || 10);
        const offset = (page - 1) * limit;

        // Find the total count of homework for the user
        let totalCount = await Homework.count({ where: { student_id: user.id } });

        // Calculate the total number of pages
        let totalPages = Math.ceil(totalCount / limit);

        // Fetch homeworks for the specified page and limit
        let homeworks = await Homework.findAll({
            where: { student_id: user.id },
            limit: limit,
            offset: offset
        });

        // Check if there are no homeworks for the specified page
        if (!homeworks || homeworks.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Currently, there are no homework assignments.' });
        }

        // Fetch teacher information and update each homework using map and async/await
        const updatedHomeworks = await Promise.all(
            homeworks.map(async (homework) => {
                const teacher = await Users.findOne({
                    attributes: ['full_name', 'avatar'],
                    where: { id: homework.teacher_id }
                });

                if (teacher) {
                    homework = {
                        ...homework.toJSON(),
                        full_name: teacher.full_name,
                        avatar: teacher.avatar
                    };
                } else {
                    homework = {
                        ...homework.toJSON(),
                        full_name: 'Unknown Teacher',
                        avatar: ''
                    };
                }
                homework.created_at = await getLocalDateTime(homework.created_at, user.timezone);
                return homework;
            })
        );

        // Sort updatedHomeworks by created_at in descending order
        updatedHomeworks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // Response
        res.status(200).json({
            status: 'success',
            message: 'Homeworks',
            currentPage: page,
            limit: limit,
            totalClasses: totalCount,
            totalPages: totalPages,
            data: updatedHomeworks
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function homeWorksV2(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const page = Number(req.query.page || 1);
        const limit = Number(req.query.limit || 10);
        const offset = (page - 1) * limit;

        // Find the total count of homework for the user
        let totalCount = await Homework.count({ where: { student_id: user.id } });
        let totalPendingCount = await Homework.count({ where: { student_id: user.id, status: 'pending' } });

        // Calculate the total number of pages
        let totalPages = Math.ceil(totalCount / limit);

        // Fetch homeworks for the specified page and limit
        let homeworks = await Homework.findAll({
            where: { student_id: user.id },
            order: [['created_at', 'DESC']],
            limit: limit,
            offset: offset
        });

        // Check if there are no homeworks for the specified page
        if (!homeworks || homeworks.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Currently, there are no homework assignments.' });
        }

        // Fetch teacher information and update each homework using map and async/await
        const updatedHomeworks = await Promise.all(
            homeworks.map(async (homework) => {
                const teacher = await Users.findOne({
                    attributes: ['full_name', 'avatar'],
                    where: { id: homework.teacher_id }
                });

                if (teacher) {
                    homework = {
                        ...homework.toJSON(),
                        full_name: teacher.full_name,
                        avatar: teacher.avatar
                    };
                } else {
                    homework = {
                        ...homework.toJSON(),
                        full_name: 'Unknown Teacher',
                        avatar: ''
                    };
                }
                homework.created_at = await getLocalDateTime(homework.created_at, user.timezone);
                return homework;
            })
        );

        // Sort updatedHomeworks by created_at in descending order
        // updatedHomeworks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // Response
        res.status(200).json({
            status: 'success',
            message: 'Homeworks',
            currentPage: page,
            limit: limit,
            totalClasses: totalCount,
            totalPendingClasses: totalPendingCount,
            totalPages: totalPages,
            data: updatedHomeworks
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// add home work
async function deleteHomework(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        let homeworkId = req.params.id;

        // delete homework
        let deletedHomework = await Homework.destroy({
            where: { id: homeworkId }
        });

        if (!deletedHomework || deletedHomework.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Error in Homework deletion ' });
        }

        // Response
        res.status(200).json({
            status: 'success',
            message: 'Homework Deleted successfully'
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// submit home work
async function teacherHomeWorks(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const teacher_id = req.params.id;

        // find out total homeworks of this user
        let homeworks = await Homework.findAll({
            where: { student_id: user.id, teacher_id }
        });
        if (!homeworks || homeworks.length === 0) {
            return res.status(404).json({ status: 'error', message: 'currently there is not homework' });
        }

        // Fetch teacher information and update each homework using map and async/await
        const updatedHomeworks = await Promise.all(
            homeworks.map(async (homework) => {
                const teacher = await Users.findOne({
                    attributes: ['full_name', 'avatar'],
                    where: { id: homework.teacher_id }
                });

                if (teacher) {
                    homework = {
                        ...homework.toJSON(),
                        full_name: teacher.full_name,
                        avatar: teacher.avatar
                    };
                } else {
                    homework = {
                        ...homework.toJSON(),
                        full_name: 'Unknown Teacher',
                        avatar: ''
                    };
                }
                return homework;
            })
        );

        // Response
        res.status(200).json({
            status: 'success',
            message: 'Homeworks',
            data: updatedHomeworks
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// add home work
async function submitHomework(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const homeworkId = req.params.id;

        // find homeworks of this user
        let homework = await Homework.findOne({
            where: { id: homeworkId }
        });

        if (!homework || homework.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Homework does not exist' });
        }

        // check Ans is pending or not
        // if (homework.status != 'pending' || !homework.student_answers == null || !homework.student_answers == '') {
        //     return res.status(401).json({ status: 'error', message: 'Already submitted your answer' });
        // }

        if (homework.status != 'pending') {
            return res.status(401).json({ status: 'error', message: 'Already submitted your answer' });
        }

        const updateObject = {
            status: 'ended'
        };

        if (req.body.student_answers) {
            updateObject.student_answers = req.body.student_answers;
        }

        if (req.file && req.file.originalname) {
            updateObject.answer_attachment = '/homework_answer_attachment/' + req.file.originalname;
        }

        const [rowsUpdated] = await Homework.update(updateObject, { where: { id: homeworkId } });

        if (rowsUpdated === 0) {
            return res.status(404).json({ status: 'error', message: 'Failed...' });
        }

        // Fetch the updated class
        const submitHomework = await Homework.findByPk(homeworkId);

        // response
        return res.status(200).json({
            status: 'success',
            message: 'Homework submitted successfully',
            data: submitHomework
        });
    } catch (err) {

        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// view all feedback for particular students
async function feedbacks(req, res) {
    try {
        const { page = 1, limit = 10, teacher_id, from_date, to_date, sort_by = 'created_at', sort_order = 'DESC' } = req.query;
        const offset = (page - 1) * limit;

        // Normalize sort_order to ensure it's valid
        const validSortOrder = ['ASC', 'DESC'].includes(sort_order.toUpperCase()) 
            ? sort_order.toUpperCase() 
            : 'DESC';
            
        console.log(`Sort parameters - sort_by: ${sort_by}, sort_order: ${validSortOrder}`);

        const user = await Users.findOne({
            where: { id: req.userId }
        });
        
        if (!user) {
            return res.status(200).json({ status: 'error', message: 'User not found' });
        }

        // Basic where clause for student_id
        const whereClause = { student_id: user.id };
        
        // Date range filters if provided
        if (from_date) {
            whereClause.created_at = {
                ...(whereClause.created_at || {}),
                [Op.gte]: moment(from_date, 'YYYY-MM-DD').startOf('day').toDate()
            };
        }
        
        if (to_date) {
            whereClause.created_at = {
                ...(whereClause.created_at || {}),
                [Op.lte]: moment(to_date, 'YYYY-MM-DD').endOf('day').toDate()
            };
        }

        // Get all feedbacks - Apply the sort_order to database query
        const { count, rows: allFeedbacks } = await Feedback.findAndCountAll({
            where: whereClause,
            order: [['created_at', validSortOrder]] // Use the validSortOrder here
        });

        if (!allFeedbacks || allFeedbacks.length === 0) {
            return res.status(200).json({ status: 'error', message: 'No feedbacks found' });
        }

        // Get all lesson_ids from the feedbacks
        const lessonIds = allFeedbacks.map(f => f.lesson_id).filter(id => id);
        
        // Fetch all related classes
        const classes = await Class.findAll({
            where: { id: lessonIds },
            raw: true
        });

        // Get all teacher IDs
        const teacherIdsFromFeedbacks = allFeedbacks.map(f => f.teacher_id).filter(id => id);
        const teacherIdsFromClasses = classes.map(c => c.teacher_id).filter(id => id);
        const allTeacherIds = [...new Set([...teacherIdsFromFeedbacks, ...teacherIdsFromClasses])];

        // Fetch all teachers
        const teachers = await Users.findAll({
            where: { id: allTeacherIds },
            attributes: ['id', 'full_name', 'avatar', 'headline'],
            raw: true
        });

        // Create lookup maps
        const classMap = classes.reduce((map, cls) => {
            map[cls.id] = cls;
            return map;
        }, {});

        const teacherMap = teachers.reduce((map, teacher) => {
            map[teacher.id] = teacher;
            return map;
        }, {});

        // Format and enrich all feedbacks with teacher and class data
        let formattedFeedbacks = allFeedbacks.map(feedback => {
            const feedbackData = feedback.get({ plain: true });
            
            // Find related class and teacher
            const relatedClass = feedback.lesson_id ? classMap[feedback.lesson_id] : null;
            
            let relatedTeacher = null;
            let teacherId = null;
            
            // Try to get teacher ID from various sources
            if (relatedClass && relatedClass.teacher_id) {
                teacherId = relatedClass.teacher_id;
                relatedTeacher = teacherMap[teacherId];
            } else if (feedback.teacher_id) {
                teacherId = feedback.teacher_id;
                relatedTeacher = teacherMap[teacherId];
            }

            return {
                id: feedbackData.id,
                pronunciation: feedbackData.pronunciation,
                speaking: feedbackData.speaking,
                grammar: feedbackData.grammar,
                comment: feedbackData.comment,
                pronunciation_rate: feedbackData.pronunciation_rate,
                speaking_rate: feedbackData.speaking_rate,
                grammar_rate: feedbackData.grammar_rate,
                created_at: feedbackData.created_at,
                teacher_id: teacherId, // Store the teacher_id for filtering
                class: relatedClass ? {
                    id: relatedClass.id,
                    meeting_start: relatedClass.meeting_start,
                    meeting_end: relatedClass.meeting_end,
                    status: relatedClass.status,
                    join_url: relatedClass.join_url
                } : null,
                teacher: relatedTeacher ? {
                    id: relatedTeacher.id,
                    name: relatedTeacher.full_name,
                    avatar: relatedTeacher.avatar,
                    headline: relatedTeacher.headline
                } : null
            };
        });
        
        // Now apply teacher_id filter if provided
        if (teacher_id) {
            formattedFeedbacks = formattedFeedbacks.filter(feedback => 
                feedback.teacher && feedback.teacher.id.toString() === teacher_id.toString()
            );
        }
        
        // Apply sorting - also respecting the validSortOrder
        if (sort_by === 'teacher_name') {
            formattedFeedbacks.sort((a, b) => {
                const nameA = a.teacher?.name || '';
                const nameB = b.teacher?.name || '';
                return validSortOrder === 'ASC' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
            });
        } else {
            // Default sort by created_at
            formattedFeedbacks.sort((a, b) => {
                const dateA = new Date(a.created_at);
                const dateB = new Date(b.created_at);
                return validSortOrder === 'ASC' ? dateA - dateB : dateB - dateA;
            });
        }
        
        // Apply pagination to the filtered results
        const total = formattedFeedbacks.length;
        const paginatedFeedbacks = formattedFeedbacks.slice(offset, offset + parseInt(limit));
        
        if (paginatedFeedbacks.length === 0) {
            return res.status(200).json({ status: 'error', message: 'No feedbacks found' });
        }

        res.status(200).json({
            status: 'success',
            message: 'Feedbacks retrieved successfully',
            data: paginatedFeedbacks,
            pagination: {
                total: total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Error fetching feedbacks:', err);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching feedbacks'
        });
    }
}

async function getFeedBackToTeacher(req, res) {
    try {
        const student_id = req.userId;
        const { teacher_id } = req.query;

        // Check if there's any ended lesson
        const hasLessonBefore = await Class.findOne({
            where: {
                student_id: student_id,
                teacher_id: teacher_id,
                status: 'ended'
            }
        });

        // Get total ended lessons count
        const totalLesson = await Class.count({
            where: {
                student_id: student_id,
                teacher_id: teacher_id,
                status: 'ended'
            }
        });

        // Get review count from this user
        const reviewFromUser = await UserReview.count({
            where: {
                creator_id: student_id,
                instructor_id: teacher_id,
                // status: 'active'
            }
        });

        // Check conditions for feedback
        const shouldShowFeedback =
            hasLessonBefore &&
            totalLesson > 0 &&
            ((totalLesson > 0 && totalLesson < 15 && reviewFromUser === 0) ||
                (totalLesson > 1 && Math.floor(totalLesson / 15) + 1 > reviewFromUser));

        if (shouldShowFeedback) {
            return res.status(200).json({
                status: 'success',
                showFeedback: true,
                data: {
                    student_id,
                    teacher_id,
                    totalLessons: totalLesson,
                    existingReviews: reviewFromUser,
                    hasLessonBefore: hasLessonBefore !== null // Convert to boolean
                }
            });
        }

        return res.status(200).json({
            status: 'success',
            showFeedback: false,
            data: {
                student_id,
                teacher_id,
                totalLessons: totalLesson,
                existingReviews: reviewFromUser,
                hasLessonBefore: hasLessonBefore !== null // Convert to boolean
            }
        });

    } catch (error) {
        // console.error('Error in getFeedBackToTeacher:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            error: error.message
        });
    }
}

async function submitFeedBackToTeacher(req, res) {
    try {
        const student_id = req.userId;
        const {
            teacher_id,
            content,
            lessonContent,
            teacherAttitude,
            teacherSkill,
            punctuality
        } = req.body;

        // Validate required fields
        if (!teacher_id || !content || !lessonContent || !teacherAttitude || !teacherSkill || !punctuality) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields'
            });
        }

        // Calculate average rating
        const rates = [
            parseInt(lessonContent),
            parseInt(teacherAttitude),
            parseInt(teacherSkill),
            parseInt(punctuality)
        ].reduce((a, b) => a + b, 0);

        const averageRating = rates > 0 ? rates / 4 : 0;
        // Create feedback data
        const feedbackData = {
            creator_id: student_id,
            instructor_id: teacher_id,
            description: content || '',
            content_quality: lessonContent,
            instructor_skills: teacherAttitude,
            purchase_worth: teacherSkill,
            support_quality: punctuality,
            rates: averageRating,
            created_at: Math.floor(Date.now() / 1000),
            status: 'pending'
        };

        // Save feedback
        const feedback = await UserReview.create(feedbackData);

        return res.status(200).json({
            status: 'success',
            message: 'Feedback submitted successfully',
            data: feedback
        });

    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            error: error.message
        });
    }
}


// view feedback
async function viewFeedbacksDetails(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const feedbackId = req.params.id;

        let feedback = await Feedback.findAll({
            where: { id: feedbackId }
        });

        if (!feedback || feedback.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Feedback does not exist' });
        }

        // Extract teacher and student IDs from the feedback data
        const teacherId = feedback[0].teacher_id;
        const studentId = feedback[0].student_id;

        // Query the User table for teacher and student names
        const teacher = await Users.findOne({ where: { id: teacherId } });
        const student = await Users.findOne({ where: { id: studentId } });

        // Include teacher and student names in the feedback data
        const feedbackData = {
            id: feedback[0].id,
            teacher_id: feedback[0].teacher_id,
            teacher_name: teacher ? teacher.full_name : 'Unknown Teacher',
            student_id: feedback[0].student_id,
            student_name: student ? student.full_name : 'Unknown Student',
            lesson_id: feedback[0].lesson_id,
            pronunciation: feedback[0].pronunciation,
            speaking: feedback[0].speaking,
            comment: feedback[0].comment,
            grammar_rate: feedback[0].grammar_rate,
            pronunciation_rate: feedback[0].pronunciation_rate,
            speaking_rate: feedback[0].speaking_rate,
            grammar: feedback[0].grammar
        };

        // Response with the modified feedback data
        res.status(200).json({
            status: 'success',
            message: `Your Feedback Details`,
            data: [feedbackData]
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// view feedback by teacher id
async function viewTeacherFeedbacks(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const teacher_id = req.params.id;

        let feedback = await Feedback.findAll({
            where: { student_id: user.id, teacher_id }
        });

        if (!feedback || feedback.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Feedback does not exist' });
        }

        // Extract teacher and student IDs from the feedback data
        const teacherId = feedback[0].teacher_id;
        const studentId = feedback[0].student_id;

        // Query the User table for teacher and student names
        const teacher = await Users.findOne({ where: { id: teacherId } });
        const student = await Users.findOne({ where: { id: studentId } });

        // Include teacher and student names in the feedback data
        const feedbackData = {
            id: feedback[0].id,
            teacher_id: feedback[0].teacher_id,
            teacher_name: teacher ? teacher.full_name : 'Unknown Teacher',
            student_id: feedback[0].student_id,
            student_name: student ? student.full_name : 'Unknown Student',
            lesson_id: feedback[0].lesson_id,
            pronunciation: feedback[0].pronunciation,
            speaking: feedback[0].speaking,
            comment: feedback[0].comment,
            grammar_rate: feedback[0].grammar_rate,
            pronunciation_rate: feedback[0].pronunciation_rate,
            speaking_rate: feedback[0].speaking_rate,
            grammar: feedback[0].grammar
        };

        // Response with the modified feedback data
        res.status(200).json({
            status: 'success',
            message: `Your Feedback Details`,
            data: [feedbackData]
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// filter categories a
async function filterCategories(req, res) {
    try {
        const { specialties, levels, teachings, also_speaking, day } = req.query;

        let filterApplies = [];
        if (specialties?.length) {
            filterApplies.push({ type: 'specialties', value: specialties });
        }
        if (levels?.length) {
            filterApplies.push({ type: 'levels', value: levels });
        }
        if (teachings?.length) {
            filterApplies.push({ type: 'teachings', value: teachings });
        }
        if (also_speaking?.length) {
            filterApplies.push({ type: 'also_speaking', value: also_speaking });
        }

        const query = {};

        if (specialties) {
            query.value = { [Op.substring]: specialties };
        }

        let where = {};

        if (filterApplies?.length > 0) {
            let opArray = [];
            filterApplies.forEach((filter) => {
                opArray.push({ [Op.and]: [{ ...filter }] });
            });
            where = { [Op.or]: opArray };
        }

        let data = '';

        if (filterApplies?.length == 0) {
            data = await UserOccupation.findAll({
                attributes: ['user_id']
            });
        } else {
            data = await UserOccupation.findAll({
                attributes: ['user_id'],
                where: where,
                group: ['user_id'],
                having: Sequelize.literal(`COUNT(DISTINCT type) = ${filterApplies.length}`)
            });
        }

        // Teacher availability check
        let teacherAvailabilityFilter = {};

        if (data?.length) {
            teacherAvailabilityFilter.user_id = {
                [Op.in]: data.map((user) => user.user_id)
            };
        }

        if (day) {
            let days = day.split(',').filter((day) => !!day.trim());
            if (days?.length) {
                teacherAvailabilityFilter = {
                    ...teacherAvailabilityFilter,
                    [Op.and]: days.map((day) => ({ [day]: { [Op.like]: '%true%' } }))
                };
            }
        }

        let availabilityResults = [];
        if (!(filterApplies.length > 0 && data.length === 0)) {
            availabilityResults = await TeacherAvailability.findAll({
                where: teacherAvailabilityFilter
            });
        }

        let teacherResults = await getTeacherDetails({ teacherId: availabilityResults.map((r) => r.user_id) });

        let mergedResults = availabilityResults.map((availability) => {
            const userData = teacherResults.find((user) => user.id === availability.user_id);
            return {
                // ...availability.toJSON(),
                // user: userData || null
                userData
            };
        });

        mergedResults = mergedResults.map((result) => ({
            ...(result.userData && { ...result.userData })
        }));

        mergedResults = mergedResults.filter((result) => Object.keys(result).length > 0);

        return res.status(200).json({
            status: 'success',
            count: mergedResults.length,
            data: mergedResults
            // mergedResults
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
}

// filter applies on find classes
async function filterClass(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const { status, from_date, to_date, teacher_id } = req.query;

        const filterObject = {
            student_id: user.id
        };

        filterObject.status = {
            [Op.not]: 'canceled'
        };

        if (status) {
            filterObject.status = status;
        }

        if (from_date) {
            filterObject.meeting_start = {
                [Op.gte]: moment(from_date, 'YYYY-MM-DD').startOf('day').toDate()
                // $gte: new Date(from_date + 'T00:00:00Z'),
            };
        }

        if (to_date) {
            filterObject.meeting_start = {
                ...filterObject.meeting_start,
                [Op.lte]: moment(to_date, 'YYYY-MM-DD').endOf('day').toDate()
                // $lte: new Date(to_date + 'T23:59:59Z'),
            };
        }

        if (teacher_id) {
            filterObject.teacher_id = teacher_id;
        }

        const whereClause = {
            where: filterObject
        };

        let data = await Class.findAll(whereClause);
        if (!data || data.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Classes do not exist' });
        }

        let teacherIds = data.map((classItem) => classItem.teacher_id);

        let teachers = await Users.findAll({
            attributes: ['id', 'full_name', 'avatar'],
            where: { id: teacherIds }
        });

        if (!teachers || teachers.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No teachers found for the classes' });
        }

        let response = await Promise.all(
            data.map(async (classItem) => {
                let teacher = teachers.find((teacher) => teacher.id === classItem.teacher_id);

                // Check if teacher is found before accessing its properties
                let full_name = teacher ? teacher.full_name : 'Unknown Teacher';
                let avatar = teacher ? teacher.avatar : '';

                let feedbackAvailable = !!classItem.feedback_id;

                let homeworkAvailable = false;
                let homeworkDescription = null; // Initialize with null
                let student_answers = null; // Initialize with null
                let answer_attachment = null; // Initialize with null
                let attachment = null; // Initialize with null

                let homework = await Homework.findAll({
                    attributes: ['id', 'description'],
                    where: { teacher_id: classItem.teacher_id, student_id: user.id, lesson_id: classItem.id }
                });

                if (homework && homework.length > 0) {
                    homeworkAvailable = true;
                    homeworkDescription = homework[0].description;
                }

                let stud_ans = await Homework.findAll({
                    attributes: ['student_answers', 'answer_attachment', 'attachment'],
                    where: { lesson_id: classItem.id }
                });

                if (stud_ans && stud_ans.length > 0) {
                    student_answers = stud_ans[0].student_answers;
                    answer_attachment = stud_ans[0].answer_attachment;
                    attachment = stud_ans[0].attachment;
                }

                return {
                    id: classItem.id,
                    teacher_id: classItem.teacher_id,
                    full_name: full_name,
                    avatar: avatar,
                    timezone: user.timezone,
                    is_trial: classItem.is_trial,
                    meeting_start: classItem.meeting_start,
                    meeting_end: classItem.meeting_end,
                    status: classItem.status,
                    join_url: classItem.join_url,
                    join_url: classItem.join_url,
                    admin_url: classItem.admin_url,
                    feedback_id: classItem.feedback_id,
                    feedback: feedbackAvailable, // Set feedback to true if feedback_id is not null
                    homework: homeworkAvailable, // Set homework to true if available
                    student_answers: student_answers,
                    answer_attachment: answer_attachment,
                    attachment: attachment,
                    homework_description: homeworkDescription
                };
            })
        );
        // Sort updatedHomeworks by created_at in descending order
        response.sort((a, b) => new Date(b.date) - new Date(a.date));

        return res.status(200).json({ status: 'success', count: response.length, data: response });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
}

async function filterClassV2(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const { status, from_date, to_date, teacher_id, pages } = req.query;

        const filterObject = {
            student_id: user.id
        };

        // filterObject.status = {
        //     [Op.not]: 'canceled'
        // };

        if (status) {
            filterObject.status = status;
        }

        if (from_date) {
            filterObject.meeting_start = {
                [Op.gte]: moment(from_date, 'YYYY-MM-DD').startOf('day').toDate()
                // $gte: new Date(from_date + 'T00:00:00Z'),
            };
        }

        if (to_date) {
            filterObject.meeting_start = {
                ...filterObject.meeting_start,
                [Op.lte]: moment(to_date, 'YYYY-MM-DD').endOf('day').toDate()
                // $lte: new Date(to_date + 'T23:59:59Z'),
            };
        }

        if (teacher_id) {
            filterObject.teacher_id = teacher_id;
        }

        const whereClause = {
            where: filterObject
        };

        const page = Number(pages || 1);
        const limit = Number(req.query.limit || 10);
        const offset = (page - 1) * limit;

        let data = await Class.findAll({
            attributes: ['id', 'teacher_id', 'is_trial', 'meeting_start', 'meeting_end', 'status', 'join_url', 'admin_url', 'join_url', 'feedback_id', 'is_present', 'recording_status', 'recording_url'],
            ...whereClause,
            order: [
                ['status', 'DESC'],
                ['meeting_start', 'DESC']
            ],
            limit: limit,
            offset: offset
        });

        let totalCount = await Class.count({ ...whereClause });
        let totalPages = Math.ceil(totalCount / limit);

        if (!data || data.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Classes do not exist' });
        }

        let teacherIds = data.map((classItem) => classItem.teacher_id);

        let teachers = await Users.findAll({
            attributes: ['id', 'full_name', 'about', 'language', 'avatar', 'video_demo', 'video_demo_thumb', 'enable_zoom_link', 'add_zoom_link', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code'],
            where: { id: teacherIds }
        });

        if (!teachers || teachers.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No teachers found for the classes' });
        }

        // Fetch occupations and reviews for all teachers in parallel
        const [allOccupations, allReviews] = await Promise.all([
            UserOccupation.findAll({
                attributes: ['user_id', 'type', 'value'],
                where: {
                    user_id: teacherIds
                }
            }),
            UserReview.findAll({
                attributes: ['instructor_id', 'rates'],
                where: {
                    instructor_id: teacherIds
                }
            })
        ]);

        // Create occupations map grouped by teacher_id
        const occupationsMap = {};
        allOccupations.forEach((occ) => {
            if (!occupationsMap[occ.user_id]) {
                occupationsMap[occ.user_id] = [];
            }
            occupationsMap[occ.user_id].push(occ);
        });

        // Create reviews map grouped by instructor_id and calculate ratings
        const ratingsMap = {};
        allReviews.forEach((review) => {
            if (!ratingsMap[review.instructor_id]) {
                ratingsMap[review.instructor_id] = [];
            }
            ratingsMap[review.instructor_id].push(parseFloat(review.rates));
        });

        // Calculate average ratings for each teacher
        const teacherRatingsMap = {};
        teacherIds.forEach((teacherId) => {
            const rates = ratingsMap[teacherId] || [];
            const totalReviewer = rates.length;
            const totalRates = rates.reduce((acc, rate) => acc + rate, 0);
            const totalAvgRates = totalReviewer > 0 ? totalRates / totalReviewer : 0;
            
            teacherRatingsMap[teacherId] = {
                total_reviews: totalReviewer,
                avgRate: totalAvgRates
            };
        });

        let response = await Promise.all(
            data.map(async (classItem) => {
                let teacher = teachers.find((teacher) => teacher.id === classItem.teacher_id);

                // Get occupations and ratings for this teacher
                const teacherOccupations = occupationsMap[classItem.teacher_id] || [];
                const teacherRating = teacherRatingsMap[classItem.teacher_id] || { total_reviews: 0, avgRate: 0 };

                let feedbackAvailable = !!classItem.feedback_id;

                let homeworkAvailable = false;
                let homeworkDescription = null; // Initialize with null
                let student_answers = null; // Initialize with null
                let answer_attachment = null; // Initialize with null
                let attachment = null; // Initialize with null

                let homework = await Homework.findAll({
                    attributes: ['id', 'description'],
                    where: { teacher_id: classItem.teacher_id, student_id: user.id, lesson_id: classItem.id }
                });

                if (homework && homework.length > 0) {
                    homeworkAvailable = true;
                    homeworkDescription = homework[0].description;
                }

                let stud_ans = await Homework.findAll({
                    attributes: ['student_answers', 'answer_attachment', 'attachment'],
                    where: { lesson_id: classItem.id }
                });

                if (stud_ans && stud_ans.length > 0) {
                    student_answers = stud_ans[0].student_answers;
                    answer_attachment = stud_ans[0].answer_attachment;
                    attachment = stud_ans[0].attachment;
                }

                // Fetch class queries
                const classQueries = await StudentClassQuery.findAll({
                    where: { 
                        student_id: user.id,
                        class_id: classItem.id
                    }
                });

                // Fetch class summary
                const classSummary = await ClassSummary.findOne({
                    attributes: ['summary_text', 'vocabulary_learned', 'strengths', 'areas_for_improvement'],
                    where: {
                        class_id: classItem.id
                    }
                });

                // Fetch games available for this class
                const gamesData = await Games.findAll({
                    attributes: ['exercise_type', 'exercise_explanation'],
                    where: {
                        class_id: classItem.id,
                        student_id: user.id,
                        status: 'approved'
                    },
                    group: ['exercise_type', 'exercise_explanation']
                });

                // Format games available
                const gamesAvailable = gamesData.map(game => ({
                    exercise_type: game.exercise_type,
                    explanation: game.exercise_explanation
                }));

                const utcMeetingStartTime = classItem.meeting_start;
                const utcMeetingEndTime = classItem.meeting_end;
                const timezone = user.timezone;

                const localMeetingStartTime = getLocalDateTime(utcMeetingStartTime, timezone);
                const localMeetingEndTime = getLocalDateTime(utcMeetingEndTime, timezone);

                // Calculate if class is within 4 hours
                const currentTime = new Date();
                const meetingStartTime = new Date(utcMeetingStartTime);
                const fourHoursInMillis = 4 * 60 * 60 * 1000;
                const isWithinFourHours =
                    (meetingStartTime - currentTime) <= fourHoursInMillis &&
                    (meetingStartTime - currentTime) > 0;

                // Calculate class duration
                let classDuration = null;
                if (utcMeetingStartTime && utcMeetingEndTime) {
                    const start = new Date(utcMeetingStartTime);
                    const end = new Date(utcMeetingEndTime);
                    const diffMs = end - start;

                    const totalMinutes = Math.floor(diffMs / 60000);
                    const hours = Math.floor(totalMinutes / 60);
                    const minutes = totalMinutes % 60;

                    classDuration = `${hours}h ${minutes}m`;
                }

                return {
                    id: classItem.id,
                    teacher: teacher ? {
                        id: teacher.id,
                        full_name: teacher.full_name,
                        about: teacher.about,
                        language: teacher.language,
                        avatar: teacher.avatar,
                        video_demo: teacher.video_demo,
                        video_demo_thumb: teacher.video_demo_thumb,
                        enable_zoom_link: teacher.enable_zoom_link,
                        add_zoom_link: teacher.add_zoom_link,
                        add_zoom_link_meeting_id: teacher.dataValues.add_zoom_link_meeting_id,
                        add_zoom_link_access_code: teacher.dataValues.add_zoom_link_access_code,
                        occupations: {
                            specialties: teacherOccupations.filter((occ) => occ.type === 'specialties').map((occ) => occ.value),
                            also_speaking: teacherOccupations.filter((occ) => occ.type === 'also_speaking').map((occ) => occ.value),
                            teachings: teacherOccupations.filter((occ) => occ.type === 'teachings').map((occ) => occ.value),
                            levels: teacherOccupations.filter((occ) => occ.type === 'levels').map((occ) => occ.value)
                        },
                        rate: {
                            total_reviews: teacherRating.total_reviews,
                            avgRate: teacherRating.avgRate
                        }
                    } : null,
                    teacher_feedback: {
                        strengths: classSummary?.strengths || null,
                        areas_for_improvement: classSummary?.areas_for_improvement || null
                    },
                    timezone: user.timezone,
                    is_trial: classItem.is_trial,
                    meeting_start: localMeetingStartTime,
                    meeting_end: localMeetingEndTime,
                    status: classItem.status,
                    is_present: classItem.is_present,
                    join_url: classItem.join_url,
                    admin_url: classItem.admin_url,
                    feedback_id: classItem.feedback_id,
                    feedback: feedbackAvailable, // Set feedback to true if feedback_id is not null
                    homework: homeworkAvailable, // Set homework to true if available
                    student_answers: student_answers,
                    answer_attachment: answer_attachment,
                    attachment: attachment,
                    homework_description: homeworkDescription,
                    class_queries: classQueries.length > 0 ? classQueries : null,
                    has_queries: classQueries.length > 0,
                    is_within_four_hours: isWithinFourHours,
                    lesson_summary: classSummary?.summary_text || null,
                    word_learned: classSummary?.vocabulary_learned || [],
                    class_duration: classDuration,
                    recording_status: classItem.recording_status,
                    recording_url: classItem.recording_url,
                    games_available: gamesAvailable
                };
            })
        );
        // Sort updatedHomeworks by created_at in descending order
        response.sort((a, b) => new Date(b.date) - new Date(a.date));

        return res.status(200).json({ status: 'success', count: response.length, data: response, currentPage: page, limit: limit, totalClasses: totalCount, totalPages: totalPages });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
}

/**
 * TODO: filter homework
 */
async function filterHomework(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const { status, from_date, to_date, teacher_id } = req.query;

        const filterObject = {
            student_id: user.id
        };

        if (status) {
            if (status != 'All') filterObject.status = status;
        }

        if (from_date) {
            filterObject.created_at = {
                [Op.gte]: moment(from_date, 'YYYY-MM-DD').startOf('day').toDate()
                // $gte: new Date(from_date + 'T00:00:00Z'),
            };
        }

        if (to_date) {
            filterObject.created_at = {
                ...filterObject.created_at,
                [Op.lte]: moment(to_date, 'YYYY-MM-DD').endOf('day').toDate()
                // $lte: new Date(to_date + 'T23:59:59Z'),
            };
        }

        if (teacher_id != '') filterObject.teacher_id = teacher_id;

        const whereClause = {
            where: filterObject
        };

        let data = await Homework.findAll(whereClause);
        if (!data || data.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Homeworks do not exist' });
        }

        let teacherIds = data.map((classItem) => classItem.teacher_id);

        let teachers = await Users.findAll({
            attributes: ['id', 'full_name', 'avatar'],
            where: { id: teacherIds }
        });

        if (!teachers || teachers.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No teachers found for the classes' });
        }

        let response = data.map((classItem) => {
            let teacher = teachers.find((teacher) => teacher.id === classItem.teacher_id);

            // Check if teacher is found before accessing its properties
            let full_name = teacher ? teacher.full_name : 'Unknown Teacher';
            let avatar = teacher ? teacher.avatar : '';

            const dateTimeString = classItem.created_at;
            const dateObject = new Date(dateTimeString);

            const year = dateObject.getFullYear();
            const month = (dateObject.getMonth() + 1).toString().padStart(2, '0'); // Add 1 because months are 0-indexed
            const day = dateObject.getDate().toString().padStart(2, '0');

            const formattedDate = `${year}/${month}/${day}`; // Construct the formatted date

            const hours = dateObject.getHours().toString().padStart(2, '0'); // Get the hours in 24-hour format
            const minutes = dateObject.getMinutes().toString().padStart(2, '0'); // Get the minutes

            const timePart = `${hours}:${minutes}`; // Construct the time part

            return {
                id: classItem.id,
                teacher_id: classItem.teacher_id,
                student_answers: classItem.student_answers,
                answer_attachment: classItem.answer_attachment,
                description: classItem.description,
                attachment: classItem.attachment,
                title: classItem.title,
                full_name: full_name,
                avatar: avatar,
                date: classItem.created_at,
                status: classItem.status
            };
        });

        // Sort updatedHomeworks by created_at in descending order
        response.sort((a, b) => new Date(b.date) - new Date(a.date));

        return res.status(200).json({ status: 'success', count: response.length, data: response });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
}

async function filterHomeworkV2(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const { status, from_date, to_date, teacher_id, pages } = req.query;

        const filterObject = {
            student_id: user.id
        };

        if (status) {
            if (status != 'All') filterObject.status = status;
        }

        if (from_date) {
            filterObject.created_at = {
                [Op.gte]: moment(from_date, 'YYYY-MM-DD').startOf('day').toDate()
                // $gte: new Date(from_date + 'T00:00:00Z'),
            };
        }

        if (to_date) {
            filterObject.created_at = {
                ...filterObject.created_at,
                [Op.lte]: moment(to_date, 'YYYY-MM-DD').endOf('day').toDate()
                // $lte: new Date(to_date + 'T23:59:59Z'),
            };
        }

        if (teacher_id != '') filterObject.teacher_id = teacher_id;

        const whereClause = {
            where: filterObject
        };

        const page = Number(pages || 1);
        const limit = Number(req.query.limit || 10);
        const offset = (page - 1) * limit;

        let data = await Homework.findAll({ ...whereClause, order: [['created_at', 'DESC']], limit: limit, offset: offset });
        let totalCount = 0;
        totalCount = await Homework.count(whereClause);
        let totalPages = Math.ceil(totalCount / limit);
        let totalPendingCount = 0;
        if (status !== 'ended') {
            totalPendingCount = await Homework.count({
                where: {
                    ...filterObject,
                    status: 'pending'
                }
            });
        }
        if (!data || data.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Homeworks do not exist' });
        }

        let teacherIds = data.map((classItem) => classItem.teacher_id);

        let teachers = await Users.findAll({
            attributes: ['id', 'full_name', 'avatar'],
            where: { id: teacherIds }
        });

        if (!teachers || teachers.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No teachers found for the classes' });
        }

        let response = data.map((classItem) => {
            let teacher = teachers.find((teacher) => teacher.id === classItem.teacher_id);

            // Check if teacher is found before accessing its properties
            let full_name = teacher ? teacher.full_name : 'Unknown Teacher';
            let avatar = teacher ? teacher.avatar : '';

            const dateTimeString = classItem.created_at;
            const dateObject = new Date(dateTimeString);

            const year = dateObject.getFullYear();
            const month = (dateObject.getMonth() + 1).toString().padStart(2, '0'); // Add 1 because months are 0-indexed
            const day = dateObject.getDate().toString().padStart(2, '0');

            const formattedDate = `${year}/${month}/${day}`; // Construct the formatted date

            const hours = dateObject.getHours().toString().padStart(2, '0'); // Get the hours in 24-hour format
            const minutes = dateObject.getMinutes().toString().padStart(2, '0'); // Get the minutes

            const timePart = `${hours}:${minutes}`; // Construct the time part

            return {
                id: classItem.id,
                teacher_id: classItem.teacher_id,
                student_answers: classItem.student_answers,
                answer_attachment: classItem.answer_attachment,
                description: classItem.description,
                attachment: classItem.attachment,
                title: classItem.title,
                full_name: full_name,
                avatar: avatar,
                date: classItem.created_at,
                status: classItem.status
            };
        });

        // Sort updatedHomeworks by created_at in descending order
        // response.sort((a, b) => new Date(b.date) - new Date(a.date));

        return res.status(200).json({
            status: 'success',
            count: response.length,
            data: response,
            totalClasses: totalCount,
            totalPendingClasses: totalPendingCount,
            currentPage: page,
            limit: limit,
            totalPages: totalPages
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
}

/**
 * TODO: filter quizzes
 */

async function filterQuizzes(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const { status, from_date, to_date, teacher_id } = req.query;

        const filterObject = {
            student_id: user.id
        };

        if (status) {
            filterObject.status = status;
        }

        if (from_date) {
            filterObject.created_at = {
                [Op.gte]: moment(from_date, 'YYYY-MM-DD').startOf('day').toDate()
                // $gte: new Date(from_date + 'T00:00:00Z'),
            };
        }

        if (to_date) {
            filterObject.created_at = {
                ...filterObject.created_at,
                [Op.lte]: moment(to_date, 'YYYY-MM-DD').endOf('day').toDate()
                // $lte: new Date(to_date + 'T23:59:59Z'),
            };
        }

        if (teacher_id) {
            filterObject.teacher_id = teacher_id;
        }

        const whereClause = {
            where: filterObject
        };

        let data = await Quizzes.findAll(whereClause);

        if (!data || data.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No quizzes found' });
        }

        let teacherIds = data.map((classItem) => classItem.teacher_id);

        let teachers = await Users.findAll({
            attributes: ['id', 'full_name', 'avatar'],
            where: { id: teacherIds }
        });

        if (!teachers || teachers.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No teachers found' });
        }

        let response = data.map((classItem) => {
            let teacher = teachers.find((teacher) => teacher.id === classItem.teacher_id);

            // Check if teacher is found before accessing its properties
            let full_name = teacher ? teacher.full_name : 'Unknown Teacher';
            let avatar = teacher ? teacher.avatar : '';

            const dateTimeString = classItem.created_at;
            const dateObject = new Date(dateTimeString);

            const year = dateObject.getFullYear();
            const month = (dateObject.getMonth() + 1).toString().padStart(2, '0'); // Add 1 because months are 0-indexed
            const day = dateObject.getDate().toString().padStart(2, '0');

            const formattedDate = `${year}/${month}/${day}`; // Construct the formatted date

            const hours = dateObject.getHours().toString().padStart(2, '0'); // Get the hours in 24-hour format
            const minutes = dateObject.getMinutes().toString().padStart(2, '0'); // Get the minutes

            return {
                id: classItem.id,
                teacher_id: classItem.teacher_id,
                student_answers: classItem.student_answers,
                answer_attachment: classItem.answer_attachment,
                description: classItem.description,
                attachment: classItem.attachment,
                title: classItem.title,
                full_name: full_name,
                result: classItem.result,
                avatar: avatar,
                date: classItem.created_at,
                status: classItem.status
            };
        });

        response.sort((a, b) => new Date(b.date) - new Date(a.date));

        return res.status(200).json({ status: 'success', count: response.length, data: response });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
}

// get all Quizzes
async function viewQuizzes(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // Find all quizzes of this user
        let quizzes = await Quizzes.findAll({
            where: { student_id: user.id }
        });

        if (!quizzes || quizzes.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Currently, there are no Quizzes' });
        }

        // Fetch teacher information and update each quiz using map and async/await
        const updatedHomeworks = await Promise.all(
            quizzes.map(async (homework) => {
                const teacher = await Users.findOne({
                    // attributes: ['id', 'full_name', 'avatar', 'created_at'],
                    where: { id: homework.teacher_id }
                });

                if (teacher) {
                    homework = {
                        ...homework.toJSON(),
                        full_name: teacher.full_name,
                        avatar: teacher.avatar
                    };
                } else {
                    homework = {
                        ...homework.toJSON(),
                        full_name: 'Unknown Teacher',
                        avatar: ''
                    };
                }
                return homework;
            })
        );

        // Sort updatedHomeworks by created_at in descending order
        updatedHomeworks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // Response
        res.status(200).json({
            status: 'success',
            message: 'Quizzes',
            data: updatedHomeworks
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// submit quizzes answer
async function submitQuizzesAnswer(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const quizzesId = req.params.id;

        // find homeworks of this user
        let quizzes = await Quizzes.findOne({
            where: { id: quizzesId }
        });

        if (!quizzes || quizzes.length === 0) {
            return res.status(404).json({ status: 'error', message: 'quizzes does not exist' });
        }

        // check status is pending or not
        if (quizzes.status != 'pending' || !quizzes.student_answers == null || !quizzes.student_answers == '') {
            return res.status(401).json({ status: 'error', message: 'Already submitted your answer' });
        }

        const updateObject = {
            status: 'ended'
        };

        if (req.body.student_answers) {
            updateObject.student_answers = req.body.student_answers;
        }

        if (req.file && req.file.originalname) {
            updateObject.answer_attachment = '/quiz_answer_attachment/' + req.file.originalname;
        }

        const [rowsUpdated] = await Quizzes.update(updateObject, { where: { id: quizzesId } });

        if (rowsUpdated === 0) {
            return res.status(404).json({ status: 'error', message: 'Failed...' });
        }

        // Fetch the updated class
        const submitQuizzesAnswer = await Quizzes.findByPk(quizzesId);

        // response
        res.status(200).json({
            status: 'success',
            message: 'Quizzes submitted successfully',
            data: submitQuizzesAnswer
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// user Review by students
async function submitReview(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }
        let teacherId = req.params.id;

        //validation using joi
        const schema = Joi.object().keys({
            content_quality: Joi.string(),
            instructor_skills: Joi.string(),
            purchase_worth: Joi.string(),
            support_quality: Joi.string(),
            description: Joi.string()
        });

        // get password from body and pass for validation
        const { value, error } = schema.validate(req.body);

        if (error) {
            return res.status(403).json({ status: 'error', message: error.message });
        }

        let cq = parseFloat(value.content_quality);
        let is = parseFloat(value.instructor_skills);
        let pw = parseFloat(value.purchase_worth);
        let sq = parseFloat(value.support_quality);

        let rates = cq + is + pw + sq;
        let avgRate = rates / 4;

        const currentTimestamp = new Date().getTime();
        const currentTimestampInSeconds = Math.floor(currentTimestamp / 1000);

        await UserReview.create({
            ...value,
            creator_id: user.id,
            instructor_id: teacherId,
            status: 'pending',
            created_at: currentTimestampInSeconds,
            rates: avgRate
        });

        let lastReview = await UserReview.findOne({
            where: { creator_id: user.id },
            order: [['created_at', 'DESC']]
        });

        if (!lastReview) {
            return res.status(404).json({ status: 'error', message: 'No review found' });
        }

        // response
        res.status(200).json({
            status: 'success',
            message: 'Review Added Successfully',
            data: lastReview
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function viewReviewList(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        let teacher_id = req.params.id;

        let reviewList = await UserReview.findAll({
            where: { instructor_id: teacher_id },
            order: [['created_at', 'DESC']]
        });

        if (!reviewList || reviewList.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No review found' });
        }

        // Calculate average of attributes
        let contentQualitySum = 0;
        let instructorSkillsSum = 0;
        let purchaseWorthSum = 0;
        let supportQualitySum = 0;
        let ratesSum = 0;

        reviewList.forEach((review) => {
            contentQualitySum += review.content_quality;
            instructorSkillsSum += review.instructor_skills;
            purchaseWorthSum += review.purchase_worth;
            supportQualitySum += review.support_quality;
            // ratesSum += review.rates;
            ratesSum += Math.min(review.rates, 5);
        });

        const numReviews = reviewList.length;

        const averageAttributes = {
            content_quality: contentQualitySum / numReviews,
            instructor_skills: instructorSkillsSum / numReviews,
            purchase_worth: purchaseWorthSum / numReviews,
            support_quality: supportQualitySum / numReviews,
            rates: ratesSum / numReviews
        };

        // Fetch creator data for each review
        // const reviewsWithCreatorData = await Promise.all(
        //     reviewList.map(async review => {
        //         const creator = await Users.findOne({
        //             where: { id: review.creator_id },
        //         });

        //         // Combine the review data with creator's full name
        //         // return {
        //         //     ...review.get(), // Get the raw review data
        //         //     full_name: creator ? creator.full_name : null,
        //         //     avatar: creator ? creator.avatar : null,
        //         // };

        //         const localDateTime = getLocalDateTime(review.created_at, user.timezone);

        //         return {
        //             ...review.get(), // Get the raw review data
        //             created_at: localDateTime, // Update created_at with local date and time
        //             full_name: creator ? creator.full_name : null,
        //             avatar: creator ? creator.avatar : null,
        //         };

        //     })
        // );

        const reviewsWithCreatorData = await Promise.all(
            reviewList.map(async (review) => {
                const creator = await Users.findOne({
                    where: { id: review.creator_id }
                });

                // Combine the review data with creator's full name
                const localDateTime = getLocalDate(review.created_at, user.timezone);

                return {
                    ...review.get(), // Get the raw review data
                    created_at: localDateTime, // Update created_at with local date and time
                    full_name: creator ? creator.full_name : null,
                    avatar: creator ? creator.avatar : null
                };
            })
        );

        // response
        res.status(200).json({
            status: 'success',
            message: 'List of reviews',
            data: {
                reviewsWithCreatorData,
                averageAttributes
            }
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Define an API endpoint for downloading the homework PDF material
async function downloadMaterials(req, res) {
    try {
        let homeworkId = req.params.id;
        const homework = await Homework.findOne({
            attributes: ['attachment'],
            where: { id: homeworkId }
        });

        if (!homework) {
            return res.status(404).json({ status: 'error', message: 'Homework not found.' });
        }

        const fileUrl = `${homework.attachment}`;

        res.status(200).json({ status: 'success', message: 'download Material Link', fileUrl: fileUrl });
    } catch (err) {

        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Define an API endpoint for downloading the quizzes PDF
async function downloadQuizNotes(req, res) {
    try {
        let quizId = req.params.id;
        const quiz = await Quizzes.findOne({
            attributes: ['attachment'],
            where: { id: quizId }
        });

        if (!quiz) {
            return res.status(404).json({ status: 'error', message: 'Quizzes not found.' });
        }

        const fileUrl = `${quiz.attachment}`;

        res.status(200).json({ status: 'success', message: 'download Link', fileUrl: fileUrl });
    } catch (err) {

        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Define an API endpoint for downloading the homework PDF material of students
async function downloadStudentAttachment(req, res) {
    try {
        let homeworkId = req.params.id;
        const homework = await Homework.findOne({
            attributes: ['answer_attachment'],
            where: { id: homeworkId }
        });

        if (!homework) {
            return res.status(404).json({ status: 'error', message: 'Homework answer attachment is not found.' });
        }

        const fileUrl = `${homework.answer_attachment}`;

        res.status(200).json({ status: 'success', message: 'download Material Link', fileUrl: fileUrl });
    } catch (err) {

        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Define an API endpoint for downloading the quiz PDF material of students
async function downloadQuizAttachment(req, res) {
    try {
        let quizId = req.params.id;
        const quiz = await Quizzes.findOne({
            attributes: ['answer_attachment'],
            where: { id: quizId }
        });

        if (!quiz) {
            return res.status(404).json({ status: 'error', message: 'Quizzes not found.' });
        }

        const fileUrl = `${quiz.answer_attachment}`;

        res.status(200).json({ status: 'success', message: 'download Link', fileUrl: fileUrl });
    } catch (err) {

        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Update user language
async function updateUserLanguage(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const selectedLanguage = req.body.selectedLanguage;

        await Users.update({ language: selectedLanguage }, { where: { id: user.id } });

        user = await Users.findOne({
            where: { id: user.id }
        });

        // Return the response
        return res.status(200).json({
            status: 'success',
            message: 'Language updated',
            data: user
        });
    } catch (error) {
        // Handle errors appropriately
        // console.error(error);
        res.status(500).json({ status: 'error', message: 'An error occurred' });
    }
}

// Cancel Subscription
async function cancelSubscription(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const subscribedUser = await UserSubscriptionDetails.findOne({
            where: {
                user_id: user.id,
                status: 'active'
            }
        });

        if (!subscribedUser) {
            return res.status(402).json({ status: 'error', message: "You don't have any subscription" });
        }

        var countLesson = 0;

        if (subscribedUser) {
            countLesson = await Class.count({
                where: {
                    student_id: user.id,
                    meeting_start: {
                        [Op.gt]: subscribedUser.lesson_reset_at
                    },
                    next_month_class_term: 1
                }
            });
        }

        if (countLesson > 0) {
            return res.status(402).json({ status: 'error', message: "You can't cancel the subscription, because you already have a next month class." });
        }

        await UserSubscriptionDetails.update(
            {
                is_cancel: 1
            },
            {
                where: {
                    user_id: user.id,
                    status: 'active'
                }
            }
        );
        // Return the response
        return res.status(200).json({
            status: 'success',
            message: 'Your plan has been cancelled'
        });
    } catch (error) {
        // Handle errors appropriately
        // console.error(error);
        res.status(500).json({ status: 'error', message: 'An error occurred' });
    }
}

// Get all chat
async function getChatCount(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const unreadMessagesCount = await Messages.count({
            where: {
                to_user: req.userId,
                statu: 'unread'
            }
        });
        res.status(200).json({ status: 'success', message: 'Unread message count', unreadMessage: unreadMessagesCount });
    } catch (err) {

        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

//Add new chat to list
async function sendMessage(req, res) {

    try {
        newClass = await Messages.create({
            from_user: req.body.student_id,
            to_user: req.body.teacher_id,
            statu: "unread",
            body: req.body.message,
            attachment_name: req.body.attachment_name
        });
        res.status(200).json({
            status: 'success',
            message: 'New chat Added Successfully',
            data: newClass
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

//Read and unread chat
async function readUnreadMessage(req, res) {
    try {
        const unreadMessages = await Messages.findAll({
            where: {
                from_user: req.body.teacher_id,
                to_user: req.body.student_id,
                statu: 'unread'
            }
        });
        unreadMessages.forEach(async message => {
            await message.update({ statu: 'readed' });
        });
        res.status(200).json({
            status: 'success',
            message: 'Read unread message',
            data: unreadMessages
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Add new kid
async function addNewKid(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // Check if user is a parent
        if (!user.is_parent) {
            return res.status(403).json({ 
                status: 'error', 
                message: 'Only parents can add kids' 
            });
        }

        let hashedPassword = await securePassword(req.body.passwordKid);
        let kid_email = user.email.indexOf('@');

        let kid_data = {
            full_name: req.body.kidName,
            password: hashedPassword,
            email: user.email.slice(0, kid_email) + '+' + req.body.kidName + user.email.slice(kid_email),
            city: user.city,
            country_code: user.country_code,
            mobile: user.mobile + '+' + req.body.kidName,
            fcm_token: req.body.fcmToken,
            timezone: user.timezone,
            guardian: user.id,
            role_name: 'user',
            role_id: 1,
            status: user.status,
            access_content: user.access_content,
            affiliate: user.affiliate,
            // created_at: user.created_at,
            language: user.language,
            notification_channels: '["email","whatsapp","inapp"]',
            date_of_birth: req.body.date_of_birth || null,
            gender: req.body.gender || null
        };

        const createdKid = await Users.create(kid_data);
        
        // Convert to plain object and remove password for security
        const kidResponse = createdKid.toJSON();
        delete kidResponse.password;

        res.status(200).json({
            status: 'success',
            message: 'Kid created successfully',
            data: kidResponse
        });

    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

async function getNextClassTeacher(req, res) {
    try {
        const student_id = req.userId;

        // Common include options for teacher details
        const teacherInclude = {
            model: User,
            as: 'Teacher',
            required: true,
            attributes: [
                'id',
                'full_name',
                'avatar',
                'enable_zoom_link',
                'add_zoom_link',
                'add_zoom_link_meeting_id',
                'add_zoom_link_access_code',
                'about',
                'language',
                'video_demo',
                'video_demo_thumb',
                'video_demo_source',
                'headline',
                'timezone',

            ],
            where: {
                role_name: 'teacher',
                status: 'active',
                ban: false,
                deleted_at: null
            }
        };

        // First try to find the next scheduled class
        let classData = await Class.findOne({
            where: {
                student_id: student_id,
                status: 'pending'
            },
            include: [teacherInclude],
            order: [['meeting_start', 'ASC']]
        });

        // If no pending class is found, try to find the most recent ended/completed class
        if (!classData) {
            classData = await Class.findOne({
                where: {
                    student_id: student_id,
                    status: {
                        [Op.in]: ['ended', 'completed']
                    }
                },
                include: [teacherInclude],
                order: [['meeting_start', 'DESC']] // Order by most recent
            });
        }

        if (classData?.Teacher) {
            return res.status(200).json({
                status: 'success',
                data: {
                    teacher_id: classData.Teacher.id,
                    full_name: classData.Teacher.full_name,
                    avatar: classData.Teacher.avatar,
                    add_zoom_link: classData.Teacher.add_zoom_link,
                    add_zoom_link_meeting_id: classData.Teacher.dataValues.add_zoom_link_meeting_id,
                    add_zoom_link_access_code: classData.Teacher.dataValues.add_zoom_link_access_code,
                    enable_zoom_link: classData.Teacher.enable_zoom_link,
                    about: classData.Teacher.about,
                    language: classData.Teacher.language,
                    video_demo: classData.Teacher.video_demo,
                    video_demo_thumb: classData.Teacher.video_demo_thumb,
                    video_demo_source: classData.Teacher.video_demo_source,
                    headline: classData.Teacher.headline,
                    timezone: classData.Teacher.timezone,
                    class_details: {
                        class_id: classData.id,
                        meeting_start: classData.meeting_start,
                        meeting_end: classData.meeting_end,
                        status: classData.status,
                        is_trial: classData.is_trial,
                        class_type: classData.class_type,
                        zoom_id: classData.zoom_id,
                        join_url: classData.join_url
                    },
                    is_next_class: classData.status === 'pending'
                }
            });
        }

        // If no classes found at all
        return res.status(200).json({
            status: 'success',
            data: null,
            message: 'No classes found for this student'
        });

    } catch (error) {
        console.error('Error in getNextClassTeacher:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            error: error.message
        });
    }
}

// Store Google Calendar tokens
async function storeGoogleTokens(req, res) {
    try {
        const { access_token, refresh_token, email } = req.body;
        const userId = req.userId;

        // Validate required fields
        if (!access_token || !userId) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields'
            });
        }

        // First check if record exists
        const existingRecord = await GoogleTokens.findOne({
            where: { user_id: userId }
        });

        if (existingRecord) {
            // Update existing record
            await GoogleTokens.update({
                access_token,
                refresh_token: refresh_token || existingRecord.refresh_token, // Keep existing refresh_token if not provided
                email: email || existingRecord.email,
                updated_at: new Date()
            }, {
                where: { user_id: userId }
            });
        } else {
            // Create new record
            await GoogleTokens.create({
                user_id: userId,
                access_token,
                refresh_token,
                email,
                created_at: new Date(),
                updated_at: new Date()
            });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Google Calendar tokens stored successfully',
            isNewConnection: !existingRecord
        });

    } catch (error) {
        console.error('Store Google tokens error:', {
            error,
            userId: req.userId,
            email: req.body.email
        });

        return res.status(500).json({
            status: 'error',
            message: 'Failed to store Google Calendar tokens',
            error: error.message
        });
    }
}

// Add calendar event
async function addCalendarEvent(req, res) {
    try {
        const userId = req.userId;
        const {
            summary,
            location,
            description,
            start_time,
            end_time,
            timezone
        } = req.body;

        // Get user's tokens
        const userTokens = await GoogleTokens.findOne({
            where: { user_id: userId }
        });

        if (!userTokens) {
            return res.status(400).json({
                status: 'error',
                message: 'Google Calendar not connected'
            });
        }

        // Set up Google Calendar client
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({
            access_token: userTokens.access_token
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        // Create calendar event
        const event = {
            summary,
            location,
            description,
            start: {
                dateTime: start_time,
                timeZone: timezone
            },
            end: {
                dateTime: end_time,
                timeZone: timezone
            },
            reminders: {
                useDefault: true
            }
        };

        const response = await calendar.events.insert({
            calendarId: 'primary',
            resource: event
        });

        res.status(200).json({
            status: 'success',
            data: response.data
        });

    } catch (error) {
        console.error('Add calendar event error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to add calendar event'
        });
    }
}

// Disconnect Google Calendar
async function disconnectGoogleCalendar(req, res) {
    try {
        const userId = req.userId;

        await GoogleTokens.destroy({
            where: { user_id: userId }
        });

        res.status(200).json({
            status: 'success',
            message: 'Google Calendar disconnected successfully'
        });
    } catch (error) {
        console.error('Disconnect Google Calendar error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to disconnect Google Calendar'
        });
    }
}

// In your controllers file
async function checkGoogleConnection(req, res) {
    try {
        const userId = req.userId;

        // Find tokens for the user
        const tokens = await GoogleTokens.findOne({
            where: { user_id: userId },
            order: [['updated_at', 'DESC']]
        });
        // If no tokens exist at all, user needs to connect
        if (!tokens) {
            return res.status(200).json({
                status: "success",
                isConnected: false,
                message: "No Google Calendar connection found",
                tokens: {
                    isConnected: false,
                    access_token: null,
                    refresh_token: null
                }
            });
        }

        // If we have both access token and refresh token, connection is valid
        if (tokens.access_token && tokens.refresh_token) {
            return res.status(200).json({
                status: "success",
                isConnected: true,
                message: "Google Calendar is connected",
                tokens: {
                    isConnected: true,
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token
                }
            });
        }

        // If we're missing either token, consider it not connected
        return res.status(200).json({
            status: "success",
            isConnected: false,
            message: "Incomplete Google Calendar connection",
            tokens: {
                isConnected: false,
                access_token: tokens.access_token || null,
                refresh_token: tokens.refresh_token || null
            }
        });

    } catch (error) {
        console.error('Error checking Google Calendar connection:', error);
        return res.status(500).json({
            status: "error",
            isConnected: false,
            message: "Failed to check Google Calendar connection",
            tokens: {
                isConnected: false,
                access_token: null,
                refresh_token: null
            }
        });
    }
}

// Submit pre-class query
async function submitClassQuery(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });
        
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const classId = req.params.id;

        // Check if class exists and belongs to the student
        let classData = await Class.findOne({
            where: { 
                id: classId,
            }
        });
        

        if (!classData) {
            return res.status(404).json({ status: 'error', message: 'Class does not exist or does not belong to you' });
        }

        // Create new query record
        const queryData = {
            class_id: classId,
            student_id: user.id,
            query_text: req.body.query_text,
            query_link: req.body.query_link
        };

        // Process file attachments
        if (req.files && req.files.length > 0) {
            const attachmentPaths = req.files.map(file => file.location || 
                ('class_query_attachments/' + (file.key ? file.key.split('/').pop() : file.originalname)));
            queryData.attachment = JSON.stringify(attachmentPaths);
        }

        // Save to database
        const newQuery = await StudentClassQuery.create(queryData);

        // Response
        return res.status(200).json({
            status: 'success',
            message: 'Query submitted successfully',
            data: newQuery
        });
    } catch (err) {
        console.error('Error submitting class query:', err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// View class queries for a specific class
async function viewClassQueries(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });
        
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const classId = req.params.id;

        // Check if class exists and belongs to the student
        let classData = await Class.findOne({
            where: { 
                id: classId,
            }
        });

        if (!classData) {
            return res.status(404).json({ status: 'error', message: 'Class does not exist or does not belong to you' });
        }

        // Find queries for this class
        const queries = await StudentClassQuery.findAll({
            where: { 
                class_id: classId,
                student_id: user.id
            },
            order: [['created_at', 'DESC']]
        });

        if (!queries || queries.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No queries found for this class' });
        }

        // Response
        return res.status(200).json({
            status: 'success',
            message: 'Class queries retrieved successfully',
            data: queries
        });
    } catch (err) {
        console.error('Error retrieving class queries:', err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Download class query attachment
async function downloadClassQueryAttachment(req, res) {
    try {
        const queryId = req.params.id;
        const query = await StudentClassQuery.findOne({
            attributes: ['attachment', 'student_id'],
            where: { id: queryId }
        });

        if (!query) {
            return res.status(404).json({ status: 'error', message: 'Query not found.' });
        }

        // Security check - only allow the student who submitted the query to download it
        if (query.student_id !== req.userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access to this resource.' });
        }

        if (!query.attachment) {
            return res.status(404).json({ status: 'error', message: 'No attachment found for this query.' });
        }

        const fileUrl = `${query.attachment}`;

        res.status(200).json({ 
            status: 'success', 
            message: 'Download link', 
            fileUrl: fileUrl 
        });
    } catch (err) {
        console.error('Error downloading class query attachment:', err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Delete class query
async function deleteClassQuery(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });
        
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const queryId = req.params.id;

        // Find the query to ensure it exists and belongs to the user
        const query = await StudentClassQuery.findOne({
            where: { 
                id: queryId,
                student_id: user.id // Security check - only allow deletion of own queries
            }
        });

        if (!query) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'Query not found or you do not have permission to delete it' 
            });
        }

        // Delete the query
        const deletedCount = await StudentClassQuery.destroy({
            where: { 
                id: queryId,
                student_id: user.id
            }
        });

        if (deletedCount === 0) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Failed to delete query' 
            });
        }

        // Response
        return res.status(200).json({
            status: 'success',
            message: 'Class query deleted successfully'
        });

    } catch (err) {
        console.error('Error deleting class query:', err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

/**
 * Get list of demo audio broadcasts with direct links - flat array structure with paired image and audio
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getDemoAudioBroadcasts(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // Fetch active audio broadcasts from database
        const audioBroadcasts = await AudioBroadcast.findAll({
            where: {
                is_active: 1
            },
            order: [['upload_date', 'DESC']],
            limit: 10, // Limit to prevent too many results
            attributes: [
                'id', 'title', 'audio_file_url', 'image_url', 
                'file_size', 'duration', 'upload_date'
            ]
        });

        // Helper function to extract file format from URL
        const getFileFormat = (url) => {
            if (!url) return 'unknown';
            const extension = url.split('.').pop().toLowerCase();
            return extension || 'unknown';
        };

        // Helper function to generate estimated image size (since we don't store it)
        const getEstimatedImageSize = () => {
            const sizes = ['28KB', '33KB', '29KB', '164KB', '2.1MB'];
            return sizes[Math.floor(Math.random() * sizes.length)];
        };

        // Map AudioBroadcast data to the expected response format
        const demoFiles = audioBroadcasts.map((broadcast) => ({
            id: broadcast.id.toString(),
            image: broadcast.image_url || "https://filesamples.com/samples/image/jpg/sample_640x426.jpg", // Fallback image
            audio: broadcast.audio_file_url,
            image_size: getEstimatedImageSize(), // Estimated since not stored
            audio_size: broadcast.file_size || "Unknown",
            image_format: getFileFormat(broadcast.image_url) || "jpg",
            audio_format: getFileFormat(broadcast.audio_file_url) || "mp3",
            name: broadcast.title || `Audio Broadcast ${broadcast.id}`
        }));

        // If no broadcasts found, return fallback data to maintain consistency
        if (demoFiles.length === 0) {
            const fallbackData = [
                {
                    id: "1",
                    image: "https://filesamples.com/samples/image/jpg/sample_640x426.jpg",
                    audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
                    image_size: "29KB",
                    audio_size: "7MB",
                    image_format: "jpg",
                    audio_format: "mp3",
                    name: "SoundHelix Sample 1"
                }
            ];

            return res.status(200).json({
                status: 'success',
                message: 'Demo audio broadcasts list (fallback)',
                data: fallbackData
            });
        }

        res.status(200).json({
            status: 'success',
            message: 'Demo audio broadcasts list',
            data: demoFiles
        });
    } catch (err) {
        console.error('Error getting demo audio broadcasts:', err);
        
        // Return fallback data in case of error to maintain API consistency
        const fallbackData = [
            {
                id: "1",
                image: "https://filesamples.com/samples/image/jpg/sample_640x426.jpg",
                audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
                image_size: "29KB",
                audio_size: "7MB",
                image_format: "jpg",
                audio_format: "mp3",
                name: "SoundHelix Sample 1"
            }
        ];

        return res.status(200).json({
            status: 'success',
            message: 'Demo audio broadcasts list (fallback)',
            data: fallbackData
        });
    }
}

/**
 * Update payment data for an existing short ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updatePaymentData = async (req, res) => {
    try {
        const { short_id, payment_data, expires_at } = req.body;

        if (!short_id || !payment_data) {
            return res.status(400).json({
                status: 'error',
                message: 'Short ID and payment data are required'
            });
        }

        // Validate short_id format (8 alphanumeric characters)
        if (!/^[A-Za-z0-9]{8}$/.test(short_id)) {
            return res.status(400).json({
                status: 'error',
                message: 'Short ID must be exactly 8 alphanumeric characters'
            });
        }

        // Check if short_id exists
        const existingLink = await PaymentLinks.findOne({
            where: { short_id }
        });

        if (!existingLink) {
            return res.status(404).json({
                status: 'error',
                message: 'Payment link with this Short ID not found'
            });
        }

        // Prepare update data
        const updateData = {
            payment_data: typeof payment_data === 'string' ? payment_data : JSON.stringify(payment_data),
            updated_at: new Date()
        };

        // Update expires_at if provided
        if (expires_at) {
            updateData.expires_at = new Date(expires_at);
        }

        // Update the payment data
        const [updatedRowsCount] = await PaymentLinks.update(updateData, {
            where: { short_id }
        });

        if (updatedRowsCount === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Failed to update payment data'
            });
        }

        // Fetch the updated record
        const updatedPaymentLink = await PaymentLinks.findOne({
            where: { short_id }
        });

        console.log('💾 Payment data updated successfully for short ID:', short_id);

        return res.status(200).json({
            status: 'success',
            data: {
                short_id: updatedPaymentLink.short_id,
                payment_data: JSON.parse(updatedPaymentLink.payment_data),
                expires_at: updatedPaymentLink.expires_at,
                updated_at: updatedPaymentLink.updated_at
            },
            message: 'Payment data updated successfully'
        });

    } catch (error) {
        console.error('❌ Error updating payment data:', error);

        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};
async function getOneMonthDateRange(req, res) {
    try {
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'User not found' 
            });
        }

        const userTimezone = user.timezone || 'UTC';
        
        // Get today's date in user's timezone
        const today = moment().tz(userTimezone);
        
        // Calculate next month same day
        const nextMonth = moment(today).add(1, 'month');
        
        // Generate array of dates from today to next month same day
        const dateArray = [];
        const currentDate = moment(today);
        
        while (currentDate.isSameOrBefore(nextMonth, 'day')) {
            dateArray.push(currentDate.format('DD-MM-YYYY'));
            currentDate.add(1, 'day');
        }

        return res.status(200).json({
            status: 'success',
            message: 'One month date range retrieved successfully',
            data: dateArray
        });

    } catch (error) {
        console.error('Error getting one month date range:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while getting date range',
            error: error.message
        });
    }
}

/**
 * Get teacher availability for a specific date in UTC
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getTeacherAvailability(req, res) {
    try {
        const { target_date, language, teacher_ids } = req.query;
        const user = await Users.findOne({ where: { id: req.userId } });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const userTimezone = user.timezone || 'UTC';
        
        if (!target_date) {
            return res.status(400).json({
                status: 'error',
                message: 'Target date is required (format: YYYY-MM-DD)'
            });
        }

        // Parse target date in user’s timezone
        const targetMomentUser = moment.tz(target_date, 'YYYY-MM-DD', true, userTimezone);
        if (!targetMomentUser.isValid()) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid date format. Use YYYY-MM-DD'
            });
        }

        // Convert to UTC for DB queries
        const utcStartDate = targetMomentUser.clone().startOf('day').utc();
        const utcEndDate = targetMomentUser.clone().endOf('day').utc();

        // Build where clause for teachers
        const whereClause = { 
            role_name: 'teacher', 
            status: 'active'
        };

        if (language && language.toLowerCase() !== 'any') {
            whereClause.language = language;
        }

        if (teacher_ids) {
            let teacherIdsArray;
            if (Array.isArray(teacher_ids)) {
                teacherIdsArray = teacher_ids;
            } else if (typeof teacher_ids === 'string') {
                teacherIdsArray = teacher_ids.split(',').map(id => parseInt(id.trim(), 10));
            } else {
                teacherIdsArray = [parseInt(teacher_ids, 10)];
            }
            whereClause.id = { [Op.in]: teacherIdsArray };
        }

        // Batch all database queries using Promise.all for optimization
        const [teachers, teacherRatings, existingClasses] = await Promise.all([
            // Get teachers with availability
            User.findAll({
                where: whereClause,
                attributes: [
                    'id',
                    'full_name',
                    'timezone',
                    'bio',
                    'about',
                    'avatar',
                    'language',
                    'video_demo',
                    'video_demo_thumb',
                    'enable_zoom_link',
                    'add_zoom_link',
                    'add_zoom_link_meeting_id',
                    'add_zoom_link_access_code'
                ],
                include: [
                    {
                        model: TeacherAvailability,
                        as: 'availability',
                        required: true,
                        attributes: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
                    },
                    {
                        model: TeacherHoliday,
                        as: 'holidays',
                        where: {
                            status: 'approved',
                            [Op.and]: [
                                { form_date: { [Op.lte]: utcEndDate.format() } },
                                { to_date: { [Op.gte]: utcStartDate.format() } }
                            ]
                        },
                        required: false,
                        attributes: ['form_date', 'to_date']
                    }
                ]
            }),
            
            // Get teacher ratings
            UserReview.findAll({
                attributes: [
                    'instructor_id',
                    [Sequelize.fn('AVG', Sequelize.literal('(instructor_skills + content_quality + support_quality + purchase_worth) / 4')), 'avg_rating'],
                    [Sequelize.fn('COUNT', Sequelize.col('id')), 'review_count']
                ],
                where: { status: 'active' },
                group: ['instructor_id']
            }),
            
            // Get existing classes for the specific date
            Class.findAll({
                where: {
                    meeting_start: { [Op.between]: [utcStartDate.format(), utcEndDate.format()] },
                    status: { [Op.notIn]: ['canceled', 'rejected'] }
                },
                attributes: ['teacher_id', 'meeting_start', 'meeting_end'],
                include: [{
                    model: User,
                    as: 'Student',
                    attributes: ['full_name']
                }]
            })
        ]);

        const teacherIds = teachers.map((teacher) => teacher.id);

        const allOccupations = await UserOccupation.findAll({
            attributes: ['user_id', 'type', 'value'],
            where: {
                user_id: teacherIds
            }
        });

        const occupationsMap = {};
        allOccupations.forEach((occ) => {
            if (!occupationsMap[occ.user_id]) {
                occupationsMap[occ.user_id] = [];
            }
            occupationsMap[occ.user_id].push(occ);
        });

        // Pre-compute and cache data structures for optimization
        const ratingsMap = new Map(teacherRatings.map(rating => [
            rating.instructor_id,
            {
                rating: parseFloat(rating.getDataValue('avg_rating') || 0).toFixed(1),
                reviewCount: parseInt(rating.getDataValue('review_count') || 0)
            }
        ]));

        // Pre-parse all teacher availability data
        const teacherDataMap = new Map();
        const teacherIdsSet = new Set();
        
        teachers.forEach(teacher => {
            teacherIdsSet.add(teacher.id);
            const parsedAvailability = {};
            const availability = teacher.availability;
            
            if (availability) {
                ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(day => {
                    try {
                        parsedAvailability[day] = availability[day] ? JSON.parse(availability[day]) : null;
                    } catch (error) {
                        // console.error(`Error parsing availability for teacher ${teacher.id} on ${day}:`, error);
                        parsedAvailability[day] = null;
                    }
                });
            }

              teacherDataMap.set(teacher.id, {
                  teacher,
                  parsedAvailability,
                  holidays: teacher.holidays || [],
                  rating: ratingsMap.get(teacher.id) || { rating: '0.0', reviewCount: 0 },
                  occupations: occupationsMap[teacher.id] || []
              });
          });

        // Classes grouped by teacher
        const classesByTeacher = new Map();
        existingClasses.forEach(cls => {
            if (!classesByTeacher.has(cls.teacher_id)) {
                classesByTeacher.set(cls.teacher_id, []);
            }
            classesByTeacher.get(cls.teacher_id).push({
                start: moment.utc(cls.meeting_start),
                end: moment.utc(cls.meeting_end),
                studentName: cls.Student?.full_name || 'a student'
            });
        });

        // Convert holidays
        teacherDataMap.forEach((data) => {
            data.convertedHolidays = data.holidays.map(h => ({
                start: moment.utc(h.form_date),
                end: moment.utc(h.to_date)
            }));
        });

        // Day info
        const dateKey = targetMomentUser.format('YYYY-MM-DD');
        const dayOfWeek = targetMomentUser.format('ddd').toLowerCase();

        const timeSlotAvailability = {};
        const nowUser = moment.tz(userTimezone);

        // Generate slots in USER TIMEZONE
        for (let hour = 0; hour < 24; hour++) {
            for (let minute of [0, 30]) {
                const slotStartUser = targetMomentUser.clone().hour(hour).minute(minute);
                const slotEndUser = slotStartUser.clone().add(30, 'minutes');

                const slotStartUTC = slotStartUser.clone().utc();
                const slotEndUTC = slotEndUser.clone().utc();
                const timeKey = slotStartUser.format('HH:mm');

                if (slotStartUser.isSameOrBefore(nowUser)) {
                    continue; // skip past
                }

                const availableTeachers = [];
                let availableCount = 0;

                teacherDataMap.forEach((data, teacherId) => {
                    const { teacher, parsedAvailability, convertedHolidays, rating } = data;
                    const teacherOccupations = data.occupations || [];
                    const daySchedule = parsedAvailability[dayOfWeek];

                    let teacherStatus = {
                        id: teacher.id,
                        name: teacher.full_name,
                        timezone: teacher.timezone,
                        is_available: false,
                        message: '',
                        rating: rating.rating,
                        reviews: rating.reviewCount,
                        rate: {
                            total_reviews: rating.reviewCount,
                            avgRate: Number(rating.rating)
                        },
                        languages: [teacher.language],
                        imageUrl: teacher.avatar,
                        initials: teacher.full_name.split(' ').map(n => n[0]).join(''),
                        bio: teacher.bio || '',
                        about: teacher.about || teacher.bio || '',
                        video_demo: teacher.video_demo || null,
                        video_demo_thumb: teacher.video_demo_thumb || null,
                        enable_zoom_link: teacher.enable_zoom_link,
                        add_zoom_link: teacher.add_zoom_link,
                        add_zoom_link_meeting_id: teacher.add_zoom_link_meeting_id,
                        add_zoom_link_access_code: teacher.add_zoom_link_access_code,
                        occupations: {
                            specialties: teacherOccupations.filter((occ) => occ.type === 'specialties').map((occ) => occ.value),
                            also_speaking: teacherOccupations.filter((occ) => occ.type === 'also_speaking').map((occ) => occ.value),
                            teachings: teacherOccupations.filter((occ) => occ.type === 'teachings').map((occ) => occ.value),
                            levels: teacherOccupations.filter((occ) => occ.type === 'levels').map((occ) => occ.value)
                        }
                    };

                    if (!daySchedule || !daySchedule[timeKey]) {
                        teacherStatus.message = !daySchedule
                            ? "Teacher is not available on this day"
                            : `Teacher is unavailable at ${timeKey}`;
                        availableTeachers.push(teacherStatus);
                        return;
                    }

                    // Check holiday
                    const isOnHoliday = convertedHolidays.some(h =>
                        slotStartUTC.isBefore(h.end) && slotEndUTC.isAfter(h.start)
                    );
                    if (isOnHoliday) {
                        teacherStatus.message = "Teacher is on holiday";
                        availableTeachers.push(teacherStatus);
                        return;
                    }

                    // Check class
                    const teacherClasses = classesByTeacher.get(teacherId) || [];
                    const conflict = teacherClasses.find(cls =>
                        slotStartUTC.isBefore(cls.end) && slotEndUTC.isAfter(cls.start)
                    );
                    if (conflict) {
                        teacherStatus.message = `Teacher has a class with ${conflict.studentName}`;
                        availableTeachers.push(teacherStatus);
                        return;
                    }

                    // Teacher is available
                    teacherStatus.is_available = true;
                    teacherStatus.message = "Available";
                    availableCount += 1;
                    availableTeachers.push(teacherStatus);
                });
                
                timeSlotAvailability[timeKey] = {
                    count: availableCount,
                    teachers: availableTeachers,
                    utc: slotStartUTC.format(),
                    local: slotStartUser.format(),
                    localTime: slotStartUser.format('HH:mm'),
                    utcTime: slotStartUTC.format('HH:mm'),
                };
            }
        }

        const responseData = {
            date: dateKey,
            day: dayOfWeek,
            timezone: userTimezone,
            timeSlots: timeSlotAvailability
        };

        return res.status(200).json({
            status: 'success',
            message: `Teacher availability for ${dateKey} in ${userTimezone} timezone`,
            data: responseData
        });

    } catch (error) {
        console.error('Error in getTeacherAvailability:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
}

/**
 * Get single active announcement
 * Returns the most recent valid announcement
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getAnnouncement(req, res) {
    try {
        // Get the most recent active and non-expired announcement
        const announcement = await Announcement.findOne({
            where: {
                is_active: true,
                deleted_at: null,
                last_date: {
                    [Op.gt]: new Date() // Greater than current UTC time (non-expired)
                }
            },
            order: [['created_at', 'DESC']], // Most recent first
            attributes: ['id', 'title', 'description', 'image_url', 'last_date', 'created_at']
        });

        if (!announcement) {
            return res.status(404).json({
                status: 'error',
                message: 'No active announcement found'
            });
        }

        // Format the response data
        const formattedAnnouncement = {
            id: announcement.id,
            title: announcement.title,
            description: announcement.description,
            imageUrl: announcement.image_url,
            last_date: announcement.last_date,
            created_at: announcement.created_at
        };

        return res.status(200).json({
            status: 'success',
            message: 'Announcement retrieved successfully',
            data: formattedAnnouncement
        });

    } catch (error) {
        console.error('Error retrieving announcement:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while retrieving announcement',
            error: error.message
        });
    }
}


async function getAllUrgentTeachersAvailability(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // Get hours parameter from query, default to 4, max 8
        let hours = parseInt(req.query.hours) || 4;
        if (hours > 8) {
            hours = 8;
        }
        if (hours < 1) {
            hours = 1;
        }

        // Get all active teachers first
        let activeTeachers = await Users.findAll({
            where: {
                role_name: 'teacher',
                status: 'active'
            },
            attributes: ['id', 'full_name', 'avatar', 'timezone']
        });

        if (!activeTeachers || activeTeachers.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No active teachers found' });
        }

        const teacherIds = activeTeachers.map(teacher => teacher.id);

        // Get teacher availability data
        let teachers = await TeacherAvailability.findAll({
            where: {
                user_id: {
                    [Op.in]: teacherIds
                }
            }
        });

        const currentDate = new Date();
        const endDate = new Date(currentDate.getTime() + (hours * 60 * 60 * 1000));

        // Get all teacher holidays for the time period
        let teachers_holidays = await TeacherHoliday.findAll({
            where: {
                user_id: {
                    [Op.in]: teacherIds
                },
                form_date: {
                    [Op.lte]: endDate
                },
                to_date: {
                    [Op.gte]: currentDate
                },
                status: 'approved'
            }
        });

        // Group holidays by teacher
        const holidaysByTeacher = {};
        teachers_holidays.forEach(holiday => {
            if (!holidaysByTeacher[holiday.user_id]) {
                holidaysByTeacher[holiday.user_id] = [];
            }
            holidaysByTeacher[holiday.user_id].push({
                startDate: new Date(holiday.form_date),
                endDate: new Date(holiday.to_date)
            });
        });

        // Get all booked classes for all teachers in the time period
        let bookedClasses = await Class.findAll({
            where: {
                teacher_id: {
                    [Op.in]: teacherIds
                },
                meeting_start: {
                    [Op.gte]: currentDate,
                    [Op.lte]: endDate
                },
                status: 'pending'
            }
        });

        // Group booked classes by teacher
        const classesByTeacher = {};
        bookedClasses.forEach(classInstance => {
            const teacherId = classInstance.teacher_id;
            if (!classesByTeacher[teacherId]) {
                classesByTeacher[teacherId] = [];
            }
            classesByTeacher[teacherId].push(classInstance);
        });

        // Create a map of teacher data for easy lookup
        const teacherDataMap = {};
        activeTeachers.forEach(teacher => {
            teacherDataMap[teacher.id] = teacher;
        });

        // Create a map of teacher availability data
        const teacherAvailabilityMap = {};
        teachers.forEach(availability => {
            teacherAvailabilityMap[availability.user_id] = availability;
        });

        // Generate time slots for the next specified hours
        const timeSlots = [];
        const slotDuration = 30; // minutes
        let currentSlot = new Date(currentDate);
        // Round to next 30-minute interval
        const minutes = currentSlot.getMinutes();
        if (minutes % 30 !== 0) {
            currentSlot.setMinutes(Math.ceil(minutes / 30) * 30, 0, 0);
        }

        while (currentSlot < endDate) {
            timeSlots.push(new Date(currentSlot));
            currentSlot = new Date(currentSlot.getTime() + (slotDuration * 60 * 1000));
        }

        const teachersAvailability = [];

        for (const teacherId of teacherIds) {
            const teacherUser = teacherDataMap[teacherId];
            const teacherAvailability = teacherAvailabilityMap[teacherId];
            
            // Skip if no availability data for this teacher
            if (!teacherAvailability) {
                continue;
            }
            
            const teacherHolidays = holidaysByTeacher[teacherId] || [];
            const teacherClasses = classesByTeacher[teacherId] || [];

            // Convert teacher's stored schedule to user timezone
            const storedSchedule = {
                mon: JSON.parse(teacherAvailability['mon']),
                tue: JSON.parse(teacherAvailability['tue']),
                wed: JSON.parse(teacherAvailability['wed']),
                thu: JSON.parse(teacherAvailability['thu']),
                fri: JSON.parse(teacherAvailability['fri']),
                sat: JSON.parse(teacherAvailability['sat']),
                sun: JSON.parse(teacherAvailability['sun'])
            };

            const convertedSchedule = convertScheduleToUserTimezone(storedSchedule, user.timezone);

            const availableSlots = [];

            for (const slot of timeSlots) {
                const slotEnd = new Date(slot.getTime() + (slotDuration * 60 * 1000));
                const dayOfWeek = moment(slot).format('ddd').toLowerCase();
                const timeKey = moment(slot).format('HH:mm');

                // Check if teacher is available at this time slot
                const daySchedule = convertedSchedule[dayOfWeek];
                const isAvailableInSchedule = daySchedule && daySchedule[timeKey];

                if (!isAvailableInSchedule) {
                    continue;
                }

                // Check if teacher is on holiday
                const isOnHoliday = teacherHolidays.some(holiday => {
                    return slot < holiday.endDate && slotEnd > holiday.startDate;
                });

                if (isOnHoliday) {
                    continue;
                }

                // Check if teacher has a class booked
                const hasClassBooked = teacherClasses.some(bookedClass => {
                    const meetingStart = new Date(bookedClass.meeting_start);
                    const meetingEnd = new Date(bookedClass.meeting_end);
                    return (
                        (meetingStart >= slot && meetingStart < slotEnd) ||
                        (meetingEnd > slot && meetingEnd <= slotEnd) ||
                        (meetingStart <= slot && meetingEnd >= slotEnd)
                    );
                });

                if (hasClassBooked) {
                    continue;
                }

                // Convert times to user timezone for response
                const slotMoment = moment(slot);
                const utcDate = slotMoment.utc().format();
                const utcTime = slotMoment.utc().format('HH:mm');
                const localDate = slotMoment.tz(user.timezone).format();
                const localTime = slotMoment.tz(user.timezone).format('HH:mm');

                availableSlots.push({
                    time: timeKey,
                    utcTime: utcTime,
                    utcDate: utcDate,
                    localTime: localTime,
                    localDate: localDate,
                    isAvailable: true
                });
            }

            // Only add teachers who have available slots
            if (availableSlots.length > 0) {
                teachersAvailability.push({
                    teacher_id: teacherId,
                    teacher_name: teacherUser.full_name,
                    teacher_avatar: teacherUser.avatar,
                    teacher_timezone: teacherUser.timezone,
                    available_slots_count: availableSlots.length,
                    available_slots: availableSlots
                });
            }
        }

        // Sort teachers by number of available slots (most available first)
        teachersAvailability.sort((a, b) => b.available_slots_count - a.available_slots_count);

        // Response
        res.status(200).json({
            status: 'success',
            message: `All teachers availability for the next ${hours} hours`,
            hours_requested: hours,
            time_range: {
                start: currentDate,
                end: endDate,
                user_timezone: user.timezone
            },
            total_teachers: teachersAvailability.length,
            teachers_with_availability: teachersAvailability.filter(t => t.available_slots_count > 0).length,
            data: teachersAvailability
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

/**
 * Test broadcast notification function
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function testBroadcastNotification(req, res) {
    try {
        const { topic = 'dev_announcements', message, title, language } = req.body;

        // Validate required fields
        if (!topic || !message || !title) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: topic, message, title'
            });
        }

        // Add to the existing log system
        const fs = require('fs');
        const path = require('path');
        const logsDir = path.join(__dirname, '../logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        function logToFile(message, level, category, data = null) {
            const timestamp = new Date().toISOString();
            const logEntry = {
                timestamp,
                level,
                category,
                message,
                data
            };
            
            const logFileName = `${category}-${new Date().toISOString().split('T')[0]}.log`;
            const logFilePath = path.join(logsDir, logFileName);
            
            fs.appendFileSync(logFilePath, JSON.stringify(logEntry) + '\n');
        }

        logToFile(`Starting test broadcast to topic: ${topic}`, 'info', 'test-broadcast', {
            topic,
            title,
            message: message.substring(0, 100) + '...' // Log first 100 chars
        });

        // Import the broadcast function
        const { sendBroadcastNotification } = require('../cronjobs/reminder');

        // Test message parameters
        const messageParams = {
            test_message: message,
            test_title: title,
            sender: 'Test Admin',
            timestamp: new Date().toISOString(),
        };

        const demoImageUrl = 'https://fastly.picsum.photos/id/13/2500/1667.jpg?hmac=SoX9UoHhN8HyklRA4A3vcCWJMVtiBXUg0W4ljWTor7s';
        // Send test broadcast
        const result = await sendBroadcastNotification(
            topic,
            'test_broadcast', // Template name for test broadcasts
            messageParams,
            {
                language: language || 'EN',
                customData: {
                    test: 'true',
                    broadcast_type: 'test_notification',
                    admin_test: req.userId ? req.userId.toString() : 'unknown'
                },
                imageUrl: demoImageUrl
            }
        );

        if (result.success) {
            logToFile(`Test broadcast sent successfully to topic: ${topic}`, 'info', 'test-broadcast', {
                topic,
                messageId: result.messageId,
                testId: messageParams.test_id
            });

            return res.status(200).json({
                status: 'success',
                message: 'Test broadcast sent successfully',
                data: {
                    topic: topic,
                    messageId: result.messageId,
                    sentAt: result.sentAt,
                    test_id: messageParams.test_id,
                    content: {
                        title: title,
                        message: message
                    }
                }
            });

        } else {
            logToFile(`Test broadcast failed for topic: ${topic}`, 'error', 'test-broadcast', {
                topic,
                error: result.error,
                testId: messageParams.test_id
            });

            return res.status(500).json({
                status: 'error',
                message: 'Failed to send test broadcast',
                error: result.error,
                test_id: messageParams.test_id
            });
        }

    } catch (error) {
        logToFile('Error in test broadcast', 'error', 'test-broadcast', {
            error: error.message,
            stack: error.stack,
            requestBody: req.body
        });

        return res.status(500).json({
            status: 'error',
            message: 'Internal server error during test broadcast',
            error: error.message
        });
    }
}


/**
 * GET API - Retrieve classes that meet the extension criteria
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getClassesForExtension(req, res) {
    try {
        // Target date: 26-10-2025
        const targetDate = new Date('2025-10-26T00:00:00.000Z');

        // Query to find all classes that meet the criteria:
        // 1. Booked (meeting_start) after 26-10-2025
        // 2. Status is 'pending'
        // 3. Created before 26-10-2025
        // 4. get_classes_for_extension is 'not_updated'
        const whereClause = {
            meeting_start: {
                [Op.gte]: targetDate
            },
            status: 'pending',
            created_at: {
                [Op.lt]: targetDate
            },
            get_classes_for_extension: 'not_updated'
        };

        // Find all qualifying classes with correct association aliases
        const classes = await Class.findAll({
            where: whereClause,
            include: [
                {
                    model: Users,
                    as: 'Teacher',  // Capital T - matches association definition
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: Users,
                    as: 'Student',  // Capital S - matches association definition
                    attributes: ['id', 'full_name', 'email', 'timezone']
                }
            ],
            order: [['meeting_start', 'ASC']]
        });

        if (!classes || classes.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No qualifying classes found',
                criteria: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'not_updated'
                }
            });
        }

        // Process each class to show what would be changed
        const classesForExtension = [];

        for (const classItem of classes) {
            // Get current meeting times
            const currentMeetingStart = new Date(classItem.meeting_start);
            const currentMeetingEnd = new Date(classItem.meeting_end);
            
            // Calculate what the new times would be (shift by 1 hour)
            const newMeetingStart = new Date(currentMeetingStart.getTime() + (60 * 60 * 1000)); // Add 1 hour
            const newMeetingEnd = new Date(currentMeetingEnd.getTime() + (60 * 60 * 1000)); // Add 1 hour

            classesForExtension.push({
                id: classItem.id,
                student_id: classItem.student_id,
                teacher_id: classItem.teacher_id,
                student_name: classItem.Student?.full_name || 'N/A',
                teacher_name: classItem.Teacher?.full_name || 'N/A',
                student_email: classItem.Student?.email || 'N/A',
                teacher_email: classItem.Teacher?.email || 'N/A',
                current_meeting_start: currentMeetingStart,
                current_meeting_end: currentMeetingEnd,
                proposed_meeting_start: newMeetingStart,
                proposed_meeting_end: newMeetingEnd,
                time_shift: '60 minutes forward',
                date_maintained: true,
                status: classItem.status,
                created_at: classItem.created_at
            });
        }

        // Prepare response
        const response = {
            status: 'success',
            message: `Found ${classesForExtension.length} classes eligible for time extension`,
            summary: {
                total_qualifying_classes: classes.length,
                time_shift: '1 hour forward',
                criteria_applied: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'not_updated'
                }
            },
            classes_for_extension: classesForExtension
        };

        res.status(200).json(response);

    } catch (error) {
        console.error('Error in getClassesForExtension:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while retrieving classes for extension',
            error: error.message
        });
    }
}

/**
 * POST API - Actually extend/update the classes by shifting time slots
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function extendClassesAfterDate(req, res) {
    try {
        // Target date: 26-10-2025
        const targetDate = new Date('2025-10-26T00:00:00.000Z');
        const currentTime = new Date();

        // Get batch parameters from body (JSON) or query (fallback)
        const batchSize = Math.min(parseInt(req.body.batch_size || req.query.batch_size) || 100, 500); // Default 100, max 500
        const offset = parseInt(req.body.offset || req.query.offset) || 0;
        const processAll = (req.body.process_all || req.query.process_all) === 'true';

        // Query to find all classes that meet the criteria:
        // 1. Booked (meeting_start) after 26-10-2025
        // 2. Status is 'pending'
        // 3. Created before 26-10-2025
        // 4. get_classes_for_extension is 'not_updated'
        const whereClause = {
            meeting_start: {
                [Op.gte]: targetDate
            },
            status: 'pending',
            created_at: {
                [Op.lt]: targetDate
            },
            get_classes_for_extension: 'not_updated'
        };

        // Get total count for pagination info
        const totalCount = await Class.count({ where: whereClause });

        // Find qualifying classes with pagination
        const classes = await Class.findAll({
            where: whereClause,
            include: [
                {
                    model: Users,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: Users,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                }
            ],
            order: [['meeting_start', 'ASC']],
            limit: batchSize,
            offset: offset
        });

        if (!classes || classes.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No qualifying classes found to extend',
                criteria: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'not_updated'
                },
                pagination: {
                    total_classes: totalCount,
                    current_batch: Math.floor(offset / batchSize) + 1,
                    total_batches: Math.ceil(totalCount / batchSize),
                    batch_size: batchSize,
                    offset: offset
                }
            });
        }

        // Process each class to shift time by one hour
        const updatedClasses = [];
        const errors = [];

        for (const classItem of classes) {
            try {
                // Get current meeting times
                const currentMeetingStart = new Date(classItem.meeting_start);
                const currentMeetingEnd = new Date(classItem.meeting_end);
                
                // Shift both start and end times by 1 hour (60 minutes)
                const newMeetingStart = new Date(currentMeetingStart.getTime() + (60 * 60 * 1000));
                const newMeetingEnd = new Date(currentMeetingEnd.getTime() + (60 * 60 * 1000));

                // Update the class with shifted time slots
                await Class.update(
                    {
                        meeting_start: newMeetingStart,
                        meeting_end: newMeetingEnd,
                        updated_at: currentTime,
                        get_classes_for_extension: 'updated'
                    },
                    {
                        where: { id: classItem.id }
                    }
                );

                updatedClasses.push({
                    id: classItem.id,
                    student_id: classItem.student_id,
                    teacher_id: classItem.teacher_id,
                    student_name: classItem.Student?.full_name || 'N/A',
                    teacher_name: classItem.Teacher?.full_name || 'N/A',
                    original_meeting_start: currentMeetingStart,
                    original_meeting_end: currentMeetingEnd,
                    new_meeting_start: newMeetingStart,
                    new_meeting_end: newMeetingEnd,
                    time_shifted_by: '60 minutes',
                    date_maintained: true,
                    updated_at: currentTime
                });

            } catch (error) {
                errors.push({
                    class_id: classItem.id,
                    error: error.message
                });
            }
        }

        // Calculate pagination info
        const currentBatch = Math.floor(offset / batchSize) + 1;
        const totalBatches = Math.ceil(totalCount / batchSize);
        const hasNextBatch = (offset + batchSize) < totalCount;
        const nextOffset = hasNextBatch ? offset + batchSize : null;

        // Prepare response
        const response = {
            status: 'success',
            message: `Successfully extended time slots for ${updatedClasses.length} classes in batch ${currentBatch}/${totalBatches}`,
            summary: {
                total_qualifying_classes: totalCount,
                current_batch_classes: classes.length,
                successfully_updated: updatedClasses.length,
                errors_encountered: errors.length,
                time_shift: '1 hour forward',
                teacher_availability_checked: false,
                criteria_applied: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'not_updated'
                }
            },
            pagination: {
                current_batch: currentBatch,
                total_batches: totalBatches,
                batch_size: batchSize,
                offset: offset,
                has_next_batch: hasNextBatch,
                next_offset: nextOffset,
                remaining_classes: Math.max(0, totalCount - (offset + classes.length))
            },
            updated_classes: updatedClasses
        };

        // Include errors if any
        if (errors.length > 0) {
            response.errors = errors;
        }

        res.status(200).json(response);

    } catch (error) {
        console.error('Error in extendClassesAfterDate:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while extending class time slots',
            error: error.message
        });
    }
}

/**
 * GET API - Check teacher availability for extended classes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getTeacherAvailabilityForExtension(req, res) {
    try {
        // Target date: 26-10-2025
        const targetDate = new Date('2025-10-26T00:00:00.000Z');

        // First, find all classes that meet the extension criteria (same as class extension)
        const whereClause = {
            meeting_start: {
                [Op.gte]: targetDate
            },
            status: 'pending',
            created_at: {
                [Op.lt]: targetDate
            },
            get_classes_for_extension: 'not_updated'
        };

        // Find all qualifying classes
        const classes = await Class.findAll({
            where: whereClause,
            include: [
                {
                    model: Users,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: Users,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                }
            ],
            order: [['meeting_start', 'ASC']]
        });

        if (!classes || classes.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No qualifying classes found for availability check',
                criteria: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'not_updated'
                }
            });
        }

        // Get unique teacher IDs from the classes
        const teacherIds = [...new Set(classes.map(cls => cls.teacher_id))];
        console.log(teacherIds);

        // Find teacher availability records for these teachers
        const availabilityRecords = await TeacherAvailability.findAll({
            where: {
                user_id: {
                    [Op.in]: teacherIds
                }
            },
            include: [
                {
                    model: Users,
                    as: 'teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                }
            ]
        });
        console.log(availabilityRecords);

        // Process each class to check availability needs
        const availabilityNeeds = [];

        for (const classItem of classes) {
            const teacher = classItem.Teacher;
            if (!teacher) continue;

            // Find the teacher's availability record
            const teacherAvailability = availabilityRecords.find(record => record.user_id === teacher.id);
            if (!teacherAvailability) continue;

            // Calculate new meeting times (shifted by 1 hour)
            const currentMeetingStart = new Date(classItem.meeting_start);
            const currentMeetingEnd = new Date(classItem.meeting_end);
            const newMeetingStart = new Date(currentMeetingStart.getTime() + (60 * 60 * 1000));
            const newMeetingEnd = new Date(currentMeetingEnd.getTime() + (60 * 60 * 1000));

            // Get day of week for the new meeting time
            const newMeetingDate = new Date(newMeetingStart);
            const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
            const dayOfWeek = dayNames[newMeetingDate.getDay()];

            // Get time in HH:mm format
            const timeString = newMeetingStart.toISOString().split('T')[1];
            const timeSlot = timeString.substring(0, 5);

            // Check current availability for this time slot
            const currentDayData = JSON.parse(teacherAvailability[dayOfWeek] || '{}');
            const isCurrentlyAvailable = currentDayData[timeSlot] === true;

            if (!isCurrentlyAvailable) {
                availabilityNeeds.push({
                    class_id: classItem.id,
                    teacher_id: teacher.id,
                    teacher_name: teacher.full_name,
                    teacher_email: teacher.email,
                    student_name: classItem.Student?.full_name || 'N/A',
                    original_meeting_start: currentMeetingStart,
                    original_meeting_end: currentMeetingEnd,
                    new_meeting_start: newMeetingStart,
                    new_meeting_end: newMeetingEnd,
                    day_of_week: dayOfWeek,
                    time_slot: timeSlot,
                    current_availability: isCurrentlyAvailable,
                    needs_availability_update: true
                });
            }
        }

        // Prepare response
        const response = {
            status: 'success',
            message: `Found ${availabilityNeeds.length} classes that need teacher availability updates`,
            summary: {
                total_qualifying_classes: classes.length,
                classes_needing_availability_update: availabilityNeeds.length,
                unique_teachers_affected: teacherIds.length,
                criteria_applied: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'not_updated'
                }
            },
            availability_needs: availabilityNeeds
        };

        res.status(200).json(response);

    } catch (error) {
        console.error('Error in getTeacherAvailabilityForExtension:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while checking teacher availability for extension',
            error: error.message
        });
    }
}

/**
 * POST API - Update teacher availability for extended classes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function extendTeacherAvailability(req, res) {
    try {
        // Target date: 26-10-2025
        const targetDate = new Date('2025-10-26T00:00:00.000Z');

        // Get batch parameters from body (JSON) or query (fallback)
        const batchSize = Math.min(parseInt(req.body.batch_size || req.query.batch_size) || 50, 500); // Default 50, max 200 for availability
        const offset = parseInt(req.body.offset || req.query.offset) || 0;

        // Find all classes that need availability updates (only not_updated classes)
        const whereClause = {
            meeting_start: {
                [Op.gte]: targetDate
            },
            status: 'pending',
            created_at: {
                [Op.lt]: targetDate
            },
            get_classes_for_extension: 'not_updated'
        };

        // Get total count for pagination info
        const totalCount = await Class.count({ where: whereClause });

        // Find qualifying classes with pagination
        const classes = await Class.findAll({
            where: whereClause,
            include: [
                {
                    model: Users,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: Users,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                }
            ],
            order: [['meeting_start', 'ASC']],
            limit: batchSize,
            offset: offset
        });

        if (!classes || classes.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No qualifying classes found for availability update',
                criteria: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'not_updated'
                },
                pagination: {
                    total_classes: totalCount,
                    current_batch: Math.floor(offset / batchSize) + 1,
                    total_batches: Math.ceil(totalCount / batchSize),
                    batch_size: batchSize,
                    offset: offset
                }
            });
        }

        // Get unique teacher IDs from the classes in this batch
        const teacherIds = [...new Set(classes.map(cls => cls.teacher_id))];

        // Find teacher availability records for these teachers
        const availabilityRecords = await TeacherAvailability.findAll({
            where: {
                user_id: {
                    [Op.in]: teacherIds
                }
            },
            include: [
                {
                    model: Users,
                    as: 'teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                }
            ]
        });

        // Process each class to update availability
        const updatedAvailability = [];
        const errors = [];

        for (const classItem of classes) {
            try {
                const teacher = classItem.Teacher;
                if (!teacher) continue;

                // Find the teacher's availability record
                const teacherAvailability = availabilityRecords.find(record => record.user_id === teacher.id);
                if (!teacherAvailability) continue;

                const currentMeetingStart = new Date(classItem.meeting_start);
                const currentMeetingEnd = new Date(classItem.meeting_end);
                
                // Calculate duration in minutes
                const durationMinutes = (currentMeetingEnd - currentMeetingStart) / (1000 * 60);
                
                // For not_updated classes: add 1 hour to current time
                const newMeetingStart = new Date(currentMeetingStart.getTime() + (60 * 60 * 1000));
                const newMeetingEnd = new Date(currentMeetingEnd.getTime() + (60 * 60 * 1000));

                // Get day of week for the new meeting time
                const newMeetingDate = new Date(newMeetingStart);
                const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
                const dayOfWeek = dayNames[newMeetingDate.getDay()];

                // Get time in HH:mm format
                const timeString = newMeetingStart.toISOString().split('T')[1];
                const timeSlot = timeString.substring(0, 5);

                // Determine time slots based on duration
                let timeSlotsToUpdate = [];
                
                if (durationMinutes <= 30) {
                    // Duration <= 30 minutes: use only one slot
                    timeSlotsToUpdate.push({
                        dayOfWeek,
                        timeSlot,
                        newMeetingStart,
                        newMeetingEnd
                    });
                } else {
                    // Duration > 30 minutes: use two consecutive slots
                    const nextTimeSlot = new Date(newMeetingStart.getTime() + (30 * 60 * 1000));
                    const nextTimeString = nextTimeSlot.toISOString().split('T')[1];
                    const nextTimeSlotStr = nextTimeString.substring(0, 5);
                    
                    timeSlotsToUpdate.push({
                        dayOfWeek,
                        timeSlot,
                        newMeetingStart,
                        newMeetingEnd: new Date(newMeetingStart.getTime() + (30 * 60 * 1000))
                    });
                    timeSlotsToUpdate.push({
                        dayOfWeek,
                        timeSlot: nextTimeSlotStr,
                        newMeetingStart: new Date(newMeetingStart.getTime() + (30 * 60 * 1000)),
                        newMeetingEnd
                    });
                }

                // Update availability for each time slot
                const currentDayData = JSON.parse(teacherAvailability[timeSlotsToUpdate[0].dayOfWeek] || '{}');
                let slotsUpdated = 0;

                for (const slot of timeSlotsToUpdate) {
                    if (currentDayData[slot.timeSlot] !== true) {
                        currentDayData[slot.timeSlot] = true;
                        slotsUpdated++;
                    }
                }
                
                if (slotsUpdated > 0) {
                    // Update the availability record
                    await TeacherAvailability.update(
                        {
                            [timeSlotsToUpdate[0].dayOfWeek]: JSON.stringify(currentDayData)
                        },
                        {
                            where: { id: teacherAvailability.id }
                        }
                    );

                    updatedAvailability.push({
                        class_id: classItem.id,
                        teacher_id: teacher.id,
                        teacher_name: teacher.full_name,
                        teacher_email: teacher.email,
                        student_name: classItem.Student?.full_name || 'N/A',
                        class_status: 'updated', // Updated status
                        duration_minutes: durationMinutes,
                        day_of_week: timeSlotsToUpdate[0].dayOfWeek,
                        time_slots_updated: timeSlotsToUpdate.map(slot => slot.timeSlot),
                        slots_count: timeSlotsToUpdate.length,
                        new_meeting_start: timeSlotsToUpdate[0].newMeetingStart,
                        new_meeting_end: timeSlotsToUpdate[timeSlotsToUpdate.length - 1].newMeetingEnd,
                        availability_updated: true
                    });
                }

            } catch (error) {
                errors.push({
                    class_id: classItem.id,
                    teacher_id: classItem.teacher_id,
                    error: error.message
                });
            }
        }

        // Calculate pagination info
        const currentBatch = Math.floor(offset / batchSize) + 1;
        const totalBatches = Math.ceil(totalCount / batchSize);
        const hasNextBatch = (offset + batchSize) < totalCount;
        const nextOffset = hasNextBatch ? offset + batchSize : null;

        // Prepare response
        const response = {
            status: 'success',
            message: `Successfully updated teacher availability for ${updatedAvailability.length} classes in batch ${currentBatch}/${totalBatches}`,
            summary: {
                total_qualifying_classes: totalCount,
                current_batch_classes: classes.length,
                availability_updated: updatedAvailability.length,
                errors_encountered: errors.length,
                unique_teachers_affected: teacherIds.length,
                criteria_applied: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'not_updated'
                }
            },
            pagination: {
                current_batch: currentBatch,
                total_batches: totalBatches,
                batch_size: batchSize,
                offset: offset,
                has_next_batch: hasNextBatch,
                next_offset: nextOffset,
                remaining_classes: Math.max(0, totalCount - (offset + classes.length))
            },
            updated_availability: updatedAvailability
        };

        // Include errors if any
        if (errors.length > 0) {
            response.errors = errors;
        }

        res.status(200).json(response);

    } catch (error) {
        console.error('Error in extendTeacherAvailability:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while updating teacher availability for extended classes',
            error: error.message
        });
    }
}

/**
 * GET API - Retrieve classes that can be reverted (preview)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getClassesForRevert(req, res) {
    try {
        // Target date: 26-10-2025
        const targetDate = new Date('2025-10-26T00:00:00.000Z');

        // Query to find all classes that meet the revert criteria:
        // 1. Booked (meeting_start) after 26-10-2025
        // 2. Status is 'pending'
        // 3. Created before 26-10-2025
        // 4. get_classes_for_extension is 'updated' (indicating they were extended)
        const whereClause = {
            meeting_start: {
                [Op.gte]: targetDate
            },
            status: 'pending',
            created_at: {
                [Op.lt]: targetDate
            },
            get_classes_for_extension: 'updated'
        };

        // Find all qualifying classes with correct association aliases
        const classes = await Class.findAll({
            where: whereClause,
            include: [
                {
                    model: Users,
                    as: 'Teacher',  // Capital T - matches association definition
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: Users,
                    as: 'Student', // Capital S - matches association definition
                    attributes: ['id', 'full_name', 'email', 'timezone']
                }
            ],
            order: [['meeting_start', 'ASC']]
        });

        if (!classes || classes.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No classes found that can be reverted',
                criteria: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'updated'
                }
            });
        }

        // Process each class to show what would be reverted
        const classesForRevert = [];

        for (const classItem of classes) {
            // Get current meeting times (these are the extended times)
            const currentMeetingStart = new Date(classItem.meeting_start);
            const currentMeetingEnd = new Date(classItem.meeting_end);
            
            // Calculate what the original times would be (shift back by 1 hour)
            const originalMeetingStart = new Date(currentMeetingStart.getTime() - (60 * 60 * 1000)); // Subtract 1 hour
            const originalMeetingEnd = new Date(currentMeetingEnd.getTime() - (60 * 60 * 1000)); // Subtract 1 hour

            classesForRevert.push({
                id: classItem.id,
                student_id: classItem.student_id,
                teacher_id: classItem.teacher_id,
                student_name: classItem.Student?.full_name || 'N/A',
                teacher_name: classItem.Teacher?.full_name || 'N/A',
                student_email: classItem.Student?.email || 'N/A',
                teacher_email: classItem.Teacher?.email || 'N/A',
                student_timezone: classItem.Student?.timezone || 'N/A',
                teacher_timezone: classItem.Teacher?.timezone || 'N/A',
                current_meeting_start: currentMeetingStart,
                current_meeting_end: currentMeetingEnd,
                original_meeting_start: originalMeetingStart,
                original_meeting_end: originalMeetingEnd,
                time_shift: '60 minutes backward',
                date_maintained: true,
                status: classItem.status,
                created_at: classItem.created_at,
                updated_at: classItem.updated_at
            });
        }

        // Prepare response
        const response = {
            status: 'success',
            message: `Found ${classesForRevert.length} classes eligible for revert`,
            summary: {
                total_qualifying_classes: classes.length,
                time_shift: '1 hour backward',
                criteria_applied: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'updated'
                }
            },
            classes_for_revert: classesForRevert
        };

        res.status(200).json(response);

    } catch (error) {
        console.error('Error in getClassesForRevert:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while retrieving classes for revert',
            error: error.message
        });
    }
}

/**
 * POST API - Actually revert classes by shifting time slots back
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function revertClassesAfterDate(req, res) {
    try {
        // Target date: 26-10-2025
        const targetDate = new Date('2025-10-26T00:00:00.000Z');
        const currentTime = new Date();

        // Get batch parameters from body (JSON) or query (fallback)
        const batchSize = Math.min(parseInt(req.body.batch_size || req.query.batch_size) || 100, 500); // Default 100, max 500
        const offset = parseInt(req.body.offset || req.query.offset) || 0;
        const classIds = req.body.class_ids || req.query.class_ids || null;

        // Query to find all classes that meet the revert criteria:
        // 1. Booked (meeting_start) after 26-10-2025
        // 2. Status is 'pending'
        // 3. Created before 26-10-2025
        // 4. get_classes_for_extension is 'updated' (indicating they were extended)
        // 5. If class_ids provided, filter by specific class IDs
        const whereClause = {
            meeting_start: {
                [Op.gte]: targetDate
            },
            status: 'pending',
            created_at: {
                [Op.lt]: targetDate
            },
            get_classes_for_extension: 'updated'
        };

        // Add specific class IDs filter if provided
        if (classIds) {
            let idsArray;
            if (Array.isArray(classIds)) {
                idsArray = classIds;
            } else if (typeof classIds === 'string') {
                idsArray = classIds.split(',').map(id => id.trim());
            } else {
                // Single ID
                idsArray = [classIds];
            }
            whereClause.id = { [Op.in]: idsArray.map(id => parseInt(id)) };
        }

        // Get total count for pagination info
        const totalCount = await Class.count({ where: whereClause });

        // Find qualifying classes with pagination
        const classes = await Class.findAll({
            where: whereClause,
            include: [
                {
                    model: Users,
                    as: 'Teacher',  // Capital T - matches association definition
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: Users,
                    as: 'Student',  // Capital S - matches association definition
                    attributes: ['id', 'full_name', 'email', 'timezone']
                }
            ],
            order: [['meeting_start', 'ASC']],
            limit: batchSize,
            offset: offset
        });

        if (!classes || classes.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No classes found to revert',
                criteria: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'updated'
                },
                pagination: {
                    total_classes: totalCount,
                    current_batch: Math.floor(offset / batchSize) + 1,
                    total_batches: Math.ceil(totalCount / batchSize),
                    batch_size: batchSize,
                    offset: offset
                }
            });
        }

        // Process each class to shift time back by one hour
        const revertedClasses = [];
        const errors = [];

        for (const classItem of classes) {
            try {
                // Get current meeting times (these are the extended times)
                const currentMeetingStart = new Date(classItem.meeting_start);
                const currentMeetingEnd = new Date(classItem.meeting_end);
                
                // Shift both start and end times back by 1 hour (60 minutes)
                // This reverts the extension
                const originalMeetingStart = new Date(currentMeetingStart.getTime() - (60 * 60 * 1000)); // Subtract 1 hour
                const originalMeetingEnd = new Date(currentMeetingEnd.getTime() - (60 * 60 * 1000)); // Subtract 1 hour

                // Update the class with reverted time slots
                await Class.update(
                    {
                        meeting_start: originalMeetingStart,
                        meeting_end: originalMeetingEnd,
                        updated_at: currentTime,
                        get_classes_for_extension: 'not_updated'
                    },
                    {
                        where: { id: classItem.id }
                    }
                );

                revertedClasses.push({
                    id: classItem.id,
                    student_id: classItem.student_id,
                    teacher_id: classItem.teacher_id,
                    student_name: classItem.Student?.full_name || 'N/A',  // Capital S
                    teacher_name: classItem.Teacher?.full_name || 'N/A',  // Capital T
                    extended_meeting_start: currentMeetingStart,
                    extended_meeting_end: currentMeetingEnd,
                    reverted_meeting_start: originalMeetingStart,
                    reverted_meeting_end: originalMeetingEnd,
                    time_shifted_by: '60 minutes backward',
                    date_maintained: true,
                    updated_at: currentTime
                });

            } catch (error) {
                errors.push({
                    class_id: classItem.id,
                    error: error.message
                });
            }
        }

        // Calculate pagination info
        const currentBatch = Math.floor(offset / batchSize) + 1;
        const totalBatches = Math.ceil(totalCount / batchSize);
        const hasNextBatch = (offset + batchSize) < totalCount;
        const nextOffset = hasNextBatch ? offset + batchSize : null;

        // Prepare response
        const response = {
            status: 'success',
            message: `Successfully reverted time slots for ${revertedClasses.length} classes in batch ${currentBatch}/${totalBatches}`,
            summary: {
                total_qualifying_classes: totalCount,
                current_batch_classes: classes.length,
                successfully_reverted: revertedClasses.length,
                errors_encountered: errors.length,
                time_shift: '1 hour backward',
                criteria_applied: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'updated'
                }
            },
            pagination: {
                current_batch: currentBatch,
                total_batches: totalBatches,
                batch_size: batchSize,
                offset: offset,
                has_next_batch: hasNextBatch,
                next_offset: nextOffset,
                remaining_classes: Math.max(0, totalCount - (offset + classes.length))
            },
            reverted_classes: revertedClasses
        };

        // Include errors if any
        if (errors.length > 0) {
            response.errors = errors;
        }

        res.status(200).json(response);
    } catch (error) {
        console.error('Error in revertClassesAfterDate:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while reverting class time slots',
            error: error.message
        });
    }
}

// List duplicate classes (exact same time) for the same teacher, only pending classes
async function getDuplicateClasses(req, res) {
    try {
        const whereBase = {
            status: 'pending'
        };

        // 1) Exact duplicates: same teacher, same start and end
        const duplicateGroups = await Class.findAll({
            attributes: [
                'teacher_id',
                'meeting_start',
                'meeting_end',
                [Sequelize.fn('COUNT', Sequelize.col('*')), 'count']
            ],
            where: whereBase,
            group: ['teacher_id', 'meeting_start', 'meeting_end'],
            having: Sequelize.literal('COUNT(*) > 1'),
            raw: true
        });

        const duplicates = [];
        for (const grp of duplicateGroups) {
            const classes = await Class.findAll({
                where: {
                    teacher_id: grp.teacher_id,
                    meeting_start: grp.meeting_start,
                    meeting_end: grp.meeting_end,
                    status: { [Op.ne]: 'canceled' }
                },
                include: [
                    {
                        model: User,
                        as: 'Student',
                        attributes: ['id', 'full_name', 'email', 'mobile']
                    },
                    {
                        model: User,
                        as: 'Teacher',
                        attributes: ['id', 'full_name', 'email', 'mobile']
                    }
                ]
            });
            if (classes.length > 1) {
                duplicates.push({
                    teacher_id: grp.teacher_id,
                    meeting_start: grp.meeting_start,
                    meeting_end: grp.meeting_end,
                    classes
                });
            }
        }

        return res.status(200).json({
            status: 'success',
            duplicates
        });
    } catch (error) {
        return res.status(500).json({ status: 'error', message: error.message });
    }
}

/**
 * Get all regular classes and report dates within a 2-month window where
 * the teacher availability grid is closed at the scheduled time.
 * Includes student and teacher details with inferred unavailable occurrences.
 * Optional query params: start=YYYY-MM-DD, end=YYYY-MM-DD
 */
async function getRegularClassesWithClosedAvailability(req, res) {
    try {
        const tz = 'Asia/Jerusalem';
        const startParam = req.query.start;
        const endParam = req.query.end;

        const startDate = startParam
            ? moment.tz(startParam, 'YYYY-MM-DD', tz).startOf('day')
            : moment.tz(tz).startOf('day');
        const endDate = endParam
            ? moment.tz(endParam, 'YYYY-MM-DD', tz).endOf('day')
            : startDate.clone().add(2, 'months').endOf('day');

        const dayIndexMap = {
            'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
            'thursday': 4, 'friday': 5, 'saturday': 6
        };

        // Load all regular classes with teacher and student basic details
        const regularClasses = await RegularClass.findAll({
            order: [['created_at', 'ASC']]
        });

        const results = [];

        for (const rc of regularClasses) {
            // Fetch teacher, student, subscription, and availability once per rc
            const [teacher, student, subscription, availability] = await Promise.all([
                Users.findByPk(rc.teacher_id, { attributes: ['id', 'full_name', 'email', 'timezone'] }),
                Users.findByPk(rc.student_id, { attributes: ['id', 'full_name', 'email', 'timezone'] }),
                UserSubscriptionDetails.findOne({ where: { user_id: rc.student_id, status: 'active' } }),
                TeacherAvailability.findOne({ where: { user_id: rc.teacher_id } })
            ]);

            if (!teacher || !student) {
                continue;
            }

            const lessonMinutes = (subscription && subscription.lesson_min) ? subscription.lesson_min : 30;
            const studentTz = student.timezone || rc.timezone || 'UTC';

            const targetDow = dayIndexMap[(rc.day || '').toLowerCase()];
            if (typeof targetDow !== 'number') {
                continue;
            }

            const inferred = [];

            let iter = startDate.clone().tz(tz);
            const endIter = endDate.clone().tz(tz);

            while (iter.isSameOrBefore(endIter)) {
                if (iter.day() === targetDow) {
                    const dateStr = iter.format('YYYY-MM-DD');
                    const startLocal = moment.tz(`${dateStr} ${rc.start_time}`, studentTz);
                    const startUTC = startLocal.clone().tz('UTC');

                    // Check teacher availability grid for the start slot(s)
                    let isOpen = true;
                    if (availability) {
                        const dayKey = startUTC.format('ddd').toLowerCase();
                        const startSlot = startUTC.format('HH:mm');
                        try {
                            const grid = JSON.parse(availability[dayKey] || '{}');
                            if (lessonMinutes > 30) {
                                const nextSlot = startUTC.clone().add(30, 'minutes').format('HH:mm');
                                isOpen = grid[startSlot] === true && grid[nextSlot] === true;
                            } else {
                                isOpen = grid[startSlot] === true;
                            }
                        } catch (e) {
                            // If parsing fails, treat as unavailable to surface issues
                            isOpen = false;
                        }
                    } else {
                        isOpen = false;
                    }

                    if (!isOpen) {
                        inferred.push({
                            date: dateStr,
                            expected_start_local: startLocal.format('YYYY-MM-DD HH:mm:ss'),
                            expected_start_utc: startUTC.format('YYYY-MM-DD HH:mm:ss'),
                            reason: 'teacher_availability_closed'
                        });
                    }
                }
                iter.add(1, 'day');
            }

            if (inferred.length > 0) {
                results.push({
                    regular_class: {
                        id: rc.id,
                        day: rc.day,
                        start_time: rc.start_time,
                        end_time: rc.end_time,
                        timezone: rc.timezone
                    },
                    student: {
                        id: student.id,
                        name: student.full_name,
                        email: student.email,
                        timezone: student.timezone || 'UTC'
                    },
                    teacher: {
                        id: teacher.id,
                        name: teacher.full_name,
                        email: teacher.email,
                        timezone: teacher.timezone || 'UTC'
                    },
                    lesson_minutes: lessonMinutes,
                    window: {
                        start: startDate.format('YYYY-MM-DD'),
                        end: endDate.format('YYYY-MM-DD')
                    },
                    occurrences_with_closed_availability: inferred
                });
            }
        }

        // Build teacher-centric summary of slots to turn on
        const teacherMap = new Map();
        for (const entry of results) {
            const teacher = entry.teacher;
            const lessonMinutes = entry.lesson_minutes;
            const teacherKey = teacher.id;
            if (!teacherMap.has(teacherKey)) {
                teacherMap.set(teacherKey, {
                    teacher: teacher,
                    days: {}
                });
            }
            const agg = teacherMap.get(teacherKey);
            for (const occ of entry.occurrences_with_closed_availability) {
                const utcStart = moment.tz(occ.expected_start_utc, 'UTC');
                const utcDay = utcStart.format('ddd').toLowerCase();
                const utcSlot = utcStart.format('HH:mm');
                const localStart = utcStart.clone().tz(teacher.timezone || 'UTC');
                const localSlot = localStart.format('HH:mm');

                if (!agg.days[utcDay]) {
                    agg.days[utcDay] = [];
                }

                // Ensure unique entries by utcSlot and lessonMinutes
                const already = agg.days[utcDay].some((s) => s.utc_slot === utcSlot && s.lesson_minutes === lessonMinutes);
                if (!already) {
                    const slots = [utcSlot];
                    const localSlots = [localSlot];
                    if (lessonMinutes > 30) {
                        const nextUtc = utcStart.clone().add(30, 'minutes').format('HH:mm');
                        const nextLocal = localStart.clone().add(30, 'minutes').format('HH:mm');
                        slots.push(nextUtc);
                        localSlots.push(nextLocal);
                    }
                    agg.days[utcDay].push({
                        utc_slot: utcSlot,
                        utc_slots_required: slots,
                        local_slot: localSlot,
                        local_slots_required: localSlots,
                        lesson_minutes: lessonMinutes
                    });
                }
            }
        }

        const teachers = Array.from(teacherMap.values());

        return res.status(200).json({
            status: 'success',
            message: 'Regular classes with closed teacher availability within window',
            count: results.length,
            data: results,
            teachers
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: 'Failed to get regular classes with closed availability',
            error: error.message
        });
    }
}

async function getMissingClasses(req, res) {
    try {
        console.log('🔍 Fetching trial_class_registrations with missing class records...');

        // Get all trials that have class_id but no matching class entry
        const missingTrials = await sequelize.query(
            `
            SELECT 
                tcr.id AS trial_registration_id,
                tcr.class_id,
                tcr.student_name,
                tcr.teacher_id,
                tcr.meeting_start,
                tcr.meeting_end,
                tcr.status AS trial_status,
                tcr.description,
                tcr.booked_by
            FROM 
                trial_class_registrations AS tcr
            LEFT JOIN 
                classes AS c 
                ON tcr.class_id = c.id
            WHERE 
                tcr.class_id IS NOT NULL
                AND c.id IS NULL
            ORDER BY 
                tcr.id DESC
            `,
            { type: sequelize.QueryTypes.SELECT }
        );

        if (!missingTrials.length) {
            return res.status(200).json({
                status: 'success',
                message: 'No missing classes found. All records are consistent.',
                count: 0,
                data: []
            });
        }

        return res.status(200).json({
            status: 'success',
            message: `Found ${missingTrials.length} missing class records.`,
            count: missingTrials.length,
            data: missingTrials
        });

    } catch (error) {
        console.error('❌ Error fetching missing classes:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Error fetching missing classes',
            error: error.message
        });
    }
}

async function recreateMissingClasses(req, res) {
    let transaction;

    try {
        // 1. Start transaction
        transaction = await sequelize.transaction();

        console.log('🔍 Fetching trial_class_registrations with missing class records...');

        // 2. Get all trials that have class_id but no matching class entry
        const missingTrials = await sequelize.query(
            `
            SELECT 
                tcr.id AS trial_registration_id,
                tcr.class_id,
                tcr.student_name,
                tcr.teacher_id,
                tcr.meeting_start,
                tcr.meeting_end,
                tcr.status AS trial_status,
                tcr.description,
                tcr.booked_by
            FROM 
                trial_class_registrations AS tcr
            LEFT JOIN 
                classes AS c 
                ON tcr.class_id = c.id
            WHERE 
                tcr.class_id IS NOT NULL
                AND c.id IS NULL
            ORDER BY 
                tcr.id DESC
            `,
            { type: sequelize.QueryTypes.SELECT, transaction }
        );

        if (!missingTrials.length) {
            console.log('✅ No missing classes found. All records are consistent.');
            await transaction.commit();
            return res.status(200).json({
                status: 'success',
                message: 'No missing classes found. All records are consistent.',
                classes_recreated: 0
            });
        }

        console.log(`⚠️ Found ${missingTrials.length} missing class records. Recreating...`);

        // 3. Loop through and recreate missing classes
        for (const trial of missingTrials) {
            const teacher = await User.findOne({
                where: { id: trial.teacher_id, role_name: 'teacher', status: 'active' },
                attributes: [
                    'id', 'full_name', 'enable_zoom_link', 'add_zoom_link',
                    'add_zoom_link_meeting_id', 'add_zoom_link_access_code'
                ],
                transaction
            });

            // If teacher is not found or inactive, skip safely
            if (!teacher) {
                console.warn(`⛔ Teacher not found or inactive for trial ID ${trial.trial_registration_id}`);
                continue;
            }

            // Get the user who booked the trial to determine their role_name
            let bookedByRole = null;
            let bookedByAdminId = null;
            
            if (trial.booked_by) {
                const bookedByUser = await User.findOne({
                    where: { id: trial.booked_by },
                    attributes: ['id', 'role_name'],
                    transaction
                });

                if (bookedByUser) {
                    bookedByAdminId = bookedByUser.id;
                    // Map role_name to booked_by ENUM value
                    // Valid ENUM values: 'user', 'admin', 'support_agent', 'teacher', 'sales_role', 'sales_appointment_setter'
                    const roleMapping = {
                        'admin': 'admin',
                        'support_agent': 'support_agent',
                        'teacher': 'teacher',
                        'sales_role': 'sales_role',
                        'sales_appointment_setter': 'sales_appointment_setter',
                        'user': 'user'
                    };
                    
                    bookedByRole = roleMapping[bookedByUser.role_name] || 'user';
                }
            }

            // Determine class status based on trial status
            // If trial is completed, set class status to 'ended', otherwise 'pending'
            const classStatus = trial.trial_status === 'completed' ? 'ended' : 'pending';

            // Create new class entry
            const newClass = await Class.create({
                teacher_id: trial.teacher_id,
                student_name: trial.student_name,
                meeting_start: trial.meeting_start,
                meeting_end: trial.meeting_end,
                status: classStatus,
                is_trial: true,
                student_goal: trial.description || '',
                class_type: 'website',
                join_url: teacher.add_zoom_link || '',
                admin_url: teacher?.enable_zoom_link ? teacher?.add_zoom_link : null,
                zoom_id: teacher.add_zoom_link_meeting_id || null,
                demo_class_id: trial.trial_registration_id,
                booked_by: bookedByRole,
                booked_by_admin_id: bookedByAdminId,
                created_at: moment().format('YYYY-MM-DD HH:mm:ss'),
                updated_at: moment().format('YYYY-MM-DD HH:mm:ss')
            }, { transaction });

            // Update trial_class_registrations with the new class_id
            await TrialClassRegistration.update(
                { class_id: newClass.id },
                { where: { id: trial.trial_registration_id }, transaction }
            );

            console.log(`✅ Created class ${newClass.id} for trial ID ${trial.trial_registration_id}`);
        }

        // 4. Commit all changes
        await transaction.commit();
        console.log('🎉 All missing classes recreated successfully!');

        return res.status(200).json({
            status: 'success',
            message: 'All missing classes recreated successfully!',
            classes_recreated: missingTrials.length
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('❌ Error recreating missing classes:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Error recreating missing classes',
            error: error.message
        });
    }
}

/**
 * module exports*/
module.exports = {
    viewProfile,
    teachers,
    myTeachers,
    viewTeacherDetails,

    // Classes
    addClass,
    editClass,
    cancelClass,
    viewClasses,
    viewClassesHome,
    viewClassDetails,

    // teacher availability
    teacherAvailability,

    // Homeworks
    homeWorks,
    deleteHomework,
    teacherHomeWorks,
    submitHomework,

    // Feedbacks
    feedbacks,
    viewFeedbacksDetails,
    viewTeacherFeedbacks,

    getFeedBackToTeacher,
    submitFeedBackToTeacher,

    getNextClassTeacher,

    // Filter
    filterCategories,
    filterClass,
    filterHomework,
    filterQuizzes,

    // Quizzes
    viewQuizzes,
    submitQuizzesAnswer,

    // teacher's review by students
    submitReview,
    viewReviewList,

    // homework material
    downloadMaterials,

    // Download quizzes notes
    downloadQuizNotes,

    // Download students attachments in homework
    downloadStudentAttachment,

    // Download students attachments in quiz
    downloadQuizAttachment,
    rC,

    // Language
    updateUserLanguage,

    // vesion 2
    viewProfileV2,
    addClassV2,
    editClassV2,
    cancelClassV2,
    homeWorksV2,
    filterClassV2,
    filterHomeworkV2,
    teacherAvailabilityV2,

    // Subscription
    cancelSubscription,
    addNewChat,

    getAllUrgentTeachersAvailability,
    //chat
    getChatCount,
    sendMessage,
    readUnreadMessage,

    teacherAvailabilityV3,
    teacherAvailabilityV4,
    // new kid
    addNewKid,

    addClassV3,
    cancelClassV3,
    cancelClassWithReason,

    storeGoogleTokens,
    addCalendarEvent,
    disconnectGoogleCalendar,
    checkGoogleConnection,

    submitClassQuery,
    viewClassQueries,
    downloadClassQueryAttachment,
    deleteClassQuery,

    // Demo files
    getDemoAudioBroadcasts,

    updatePaymentData,
    getOneMonthDateRange,
    getTeacherAvailability,
    getAnnouncement,
    testBroadcastNotification,
    getClassesForExtension,
    extendClassesAfterDate,
    getTeacherAvailabilityForExtension,
    extendTeacherAvailability,
    getClassesForRevert,
    revertClassesAfterDate,
    getRegularClassesWithClosedAvailability,
    getDuplicateClasses,
    getMissingClasses,
    recreateMissingClasses
};
