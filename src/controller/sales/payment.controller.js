// controller/sales/payment.controller.js
const TrialClassRegistration = require('../../models/trialClassRegistration');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const SubscriptionPlan = require('../../models/subscription_plan');
const SubscriptionDuration = require('../../models/subscription_duration');
const LessonLength = require('../../models/lesson_length');
const LessonsPerMonth = require('../../models/lessons_per_month');
const PaymentLinks = require('../../models/payment_links');
const TrialPaymentLink = require('../../models/TrialPaymentLink');
const TrialClassStatusHistory = require('../../models/TrialClassStatusHistory');
const TrialStudentTransfer = require('../../models/TrialStudentTransfer');
const DirectPaymentCustomer = require('../../models/DirectPaymentCustomer');
const User = require('../../models/users');
const { sequelize } = require('../../connection/connection');
const { paymentLogger } = require('../../utils/paymentLogger');
const { Op, Sequelize } = require('sequelize');
const crypto = require('crypto');
const moment = require('moment');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const config = require('../../config/config');

// Import notification functions
const { sendNotificationEmail, whatsappReminderTrailClass } = require('../../cronjobs/reminder');
const PaymentTransaction = require('../../models/PaymentTransaction');

// PayPlus API Configuration
const PAYPLUS_CONFIG = {
    apiKey: process.env.PAYPLUS_API_KEY || '',
    secretKey: process.env.PAYPLUS_SECRET_KEY || '',
    baseUrl: process.env.PAYPLUS_BASE_URL || 'https://restapidev.payplus.co.il/api/v1.0',
    paymentPageUid: process.env.PAYPLUS_PAYMENT_PAGE_UID || ''
};

const generatePaymentLinkToken = () => {
    return crypto.randomBytes(32).toString('hex');
};


async function saveManualPayment(req, res) {
  try {
      const salesRep = req.user;

      const {
          student_id,
          customer_type,
          student_name,
          student_email,
          mobile,
          country_code,
          first_name,
          last_name,
          language,
          total_price,
        //   duration_months,
          lesson_min,
          weekly_lesson,
          lessons_per_month,
          plan_id,
          reason,
          currency,
          payment_source
      } = req.body;

      console.log('req query',req.body);

      let duration_months=1;

      // ---------- 0. Validation ----------
      if (!total_price || !duration_months) {
          return res.status(400).json({
              status: 'error',
              message: 'total_price and duration_months are required'
          });
      }

      // ---------- 1. Determine real plan type ----------
      const planType = `Monthly_${lesson_min || 25}`;

      // ---------- 2. Renew Date ----------
      const renewDate = new Date();
      renewDate.setMonth(renewDate.getMonth() + parseInt(duration_months));

      // ---------- 3. STEP 1: Handle USER creation/update ----------
      let finalUserId = student_id;

      // ---------- If existing customer, deactivate previous active subscription ----------
      if (customer_type === 'existing') {
          await UserSubscriptionDetails.update(
              {
                  status: 'inactive',
                  is_cancel: 1,
                  inactive_after_renew: 1,
                  cancellation_date: new Date(),
                  cancelled_by_user_id: salesRep.id
              },
              {
                  where: {
                      user_id: finalUserId,
                      status: 'active'
                  }
              }
          );
      }

      // ---------------------- A. DIRECT CUSTOMER ----------------------
      if (customer_type === 'direct') {
          const newUser = await User.create({
              full_name: student_name,
              email: student_email,
              mobile: mobile,
              country_code: country_code,
              language: language || 'EN',
              status: 'active'
          });
          finalUserId = newUser.id;
      }

      // ---------------------- B. TRIAL CUSTOMER ----------------------
      else if (customer_type === 'trial') {
          // Check if user with this email already exists in `users`
          let existingUser = await User.findOne({ where: { email: student_email } });

          if (existingUser) {
              // If already exists, no need to create user
              finalUserId = existingUser.id;
          } else {
              // Create new user from trial data
              const newUser = await User.create({
                  full_name: student_name,
                  email: student_email,
                  mobile: mobile,
                  country_code: country_code,
                  language: language || 'EN',
                  status: 'active'
              });

              finalUserId = newUser.id;
          }

          // Mark trial registration as converted
          await TrialClassRegistration.update({ status: 'converted',trial_class_status:'new_enroll' }, { where: { email: student_email } });
      }

      // ---------------------- C. EXISTING CUSTOMER ----------------------
      // No changes needed
      // finalUserId remains student_id

      // ---------- 4. STEP 2: CREATE SUBSCRIPTION ----------
      const subscription = await UserSubscriptionDetails.create({
          user_id: finalUserId,
          type: planType,
          status: 'active',
          balance: total_price,
          cost_per_lesson: total_price / (duration_months * 4),
          payment_status: 'offline',
          offline_payment_reason: reason,
          offline_payment_admin_id: salesRep.id,
          offline_payment_date: new Date(),
          each_lesson: lesson_min,
          how_often: `${weekly_lesson} lessons per month`,
          weekly_lesson,
          lesson_min,
          plan_id,
          left_lessons: lessons_per_month,
          renew_date: renewDate,
          lesson_reset_at: renewDate,
          notes: reason,
          created_at: new Date(),
          updated_at: new Date()
      });

      // ---------- 5. STEP 3: CREATE PAYMENT TRANSACTION ----------
      const payment = await PaymentTransaction.create({
          token: `manual_${Date.now()}`,
          transaction_id: `manual_${Date.now()}`,
          student_id: finalUserId,
          student_name: student_name,
          student_email: student_email,
          plan_id: plan_id || null,
          lessons_per_month: lessons_per_month || null,
          lesson_minutes: lesson_min || null,
          custom_months: duration_months,
          amount: total_price,
          currency: currency || 'ILS',
          generated_by: salesRep.id,
          status: 'success',
          payment_method: payment_source || 'manual',
          created_at: new Date()
      });

      // ---------- 6. LINK SUBSCRIPTION WITH PAYMENT ----------
      await subscription.update({ payment_id: payment.id });

      return res.status(201).json({
          status: 'success',
          message: 'Manual payment recorded successfully',
          user_id: finalUserId,
          subscription,
          payment
      });
  } catch (err) {
    console.error("❌ Error saving manual payment:", err);
    return res.status(500).json({
      status: "error",
      message: "Failed to save manual payment",
      debug: err.message,
    });
  }
}


const createOrUpdateTrialPaymentLink = async (params, transaction) => {
    try {
        const {
            student_id,
            sales_user_id,
            subscription_plan_id,
            amount,
            currency,
            payment_url,
            page_request_uid,
            is_update = false,
            payment_status = 'pending'
        } = params;

        const linkToken = page_request_uid || generatePaymentLinkToken();
        const expiryDate = moment().add(7, 'days').toDate();

        // Get TrialStudentTransfer from student_id if available
        let transfer_id = null;
        if (student_id) {
            try {
                const transfer = await TrialStudentTransfer.findOne({
                    where: { trial_class_id: student_id },
                    attributes: ['id'],
                    transaction
                });
                if (transfer) {
                    transfer_id = transfer.id;
                }
            } catch (transferError) {
                console.warn('⚠️ Could not find TrialStudentTransfer:', transferError.message);
            }
        }

        const paymentLinkData = {
            transfer_id: transfer_id,
            trial_class_id: student_id,
            sales_user_id: sales_user_id || 1,
            subscription_plan_id: subscription_plan_id || null,
            amount: parseFloat(amount),
            currency: currency || 'ILS',
            link_token: linkToken,
            payment_url: payment_url,
            payment_status: payment_status,
            expiry_date: expiryDate
        };

        let trialPaymentLink;

        if (is_update && linkToken) {
            trialPaymentLink = await TrialPaymentLink.findOne({
                where: { link_token: linkToken },
                transaction
            });

            if (trialPaymentLink) {
                await trialPaymentLink.update(paymentLinkData, { transaction });
                console.log(`📝 Updated TrialPaymentLink ${trialPaymentLink.id} for student ${student_id}`);
            } else {
                trialPaymentLink = await TrialPaymentLink.create(paymentLinkData, { transaction });
                console.log(`📝 Created new TrialPaymentLink ${trialPaymentLink.id} for student ${student_id}`);
            }
        } else {
            trialPaymentLink = await TrialPaymentLink.create(paymentLinkData, { transaction });
            console.log(`📝 Created new TrialPaymentLink ${trialPaymentLink.id} for student ${student_id}`);
        }

        return trialPaymentLink;
    } catch (error) {
        console.error('❌ Error creating/updating TrialPaymentLink:', error);
        throw error;
    }
};

const logTrialClassStatusChange = async (trialClassId, previousStatus, newStatus, changedById, changedByType = 'system', notes = null, transaction) => {
    try {
        if (!trialClassId || !newStatus) {
            return;
        }

        const statusHistoryData = {
            trial_class_id: trialClassId,
            previous_status: previousStatus,
            new_status: newStatus,
            changed_by_id: changedById || 1,
            changed_by_type: changedByType,
            notes: notes
        };

        const statusHistory = await TrialClassStatusHistory.create(statusHistoryData, { transaction });
        console.log(`📝 Logged status change for trial class ${trialClassId}: ${previousStatus} → ${newStatus}`);
        return statusHistory;
    } catch (error) {
        console.error('❌ Error logging trial class status change:', error);
    }
};

/**
 * Get subscription plans and details for generating payment links
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getPaymentGeneratorData = async (req, res) => {
    try {
        // Get all active subscription durations
        const durations = await SubscriptionDuration.findAll({
            where: { status: 'active' },
            attributes: ['id', 'name', 'months']
        });

        // Get all active lesson lengths
        const lessonLengths = await LessonLength.findAll({
            where: { status: 'active' },
            attributes: ['id', 'duration_id', 'minutes']
        });

        // Get all active lessons per month options
        const lessonsPerMonth = await LessonsPerMonth.findAll({
            where: { status: 'active' },
            attributes: ['id', 'lesson_length_id', 'lessons']
        });

        // Get all active subscription plans with their relationships
        const plans = await SubscriptionPlan.findAll({
            where: { status: 'active' },
            attributes: ['id', 'name', 'duration_id', 'lesson_length_id', 'lessons_per_month_id', 'price'],
            include: [
                {
                    model: SubscriptionDuration,
                    as: 'Duration',
                    attributes: ['id', 'name', 'months']
                },
                {
                    model: LessonLength,
                    as: 'LessonLength',
                    attributes: ['id', 'minutes']
                },
                {
                    model: LessonsPerMonth,
                    as: 'LessonsPerMonth',
                    attributes: ['id', 'lessons']
                }
            ]
        });

        // Get trial class registrations (students)
        let students = [];
        students = await TrialClassRegistration.findAll({
            attributes: [
                'id',
                'student_name',
                'parent_name',
                'email',
                'mobile',
                'country_code',
                'age',
                'status',
                'trial_class_status',
                'language'
            ],
            order: [['created_at', 'DESC']],
            limit: 100 // Limit to prevent too much data
        });

        // NEW: Get existing users with their subscription details
        let existingUsers = [];
        try {
            existingUsers = await User.findAll({
                where: {
                    status: 'active',
                    role_name: 'user'
                },
                attributes: [
                    'id',
                    'full_name',
                    'email',
                    'mobile',
                    'country_code',
                    'subscription_type',
                    'subscription_id',
                    'trial_expired',
                    'language',
                    'created_at',
                    'role_name',
                    'role_id'
                ],
                order: [['created_at', 'DESC']],
                limit: 25 // Limit to prevent too much data
            });

            // Get current subscription details for each user
            const existingUsersWithSubscriptions = await Promise.all(
                existingUsers.map(async (user) => {
                    let currentSubscription = null;

                    try {
                        const subscription = await UserSubscriptionDetails.findOne({
                            where: {
                                user_id: user.id,
                                status: 'active',
                                is_cancel: { [Op.or]: [0, false, null] }
                            },
                            attributes: [
                                'id', 'type', 'status', 'left_lessons',
                                'renew_date', 'lesson_min', 'weekly_lesson',
                                'plan_id', 'created_at'
                            ],
                            order: [['created_at', 'DESC']]
                        });

                        if (subscription) {
                            currentSubscription = {
                                id: subscription.id,
                                type: subscription.type,
                                status: subscription.status,
                                leftLessons: subscription.left_lessons,
                                renewDate: subscription.renew_date,
                                lessonMinutes: subscription.lesson_min,
                                weeklyLessons: subscription.weekly_lesson,
                                planId: subscription.plan_id,
                                createdAt: subscription.created_at
                            };
                        }
                    } catch (subscriptionError) {
                        console.warn(`Could not fetch subscription for user ${user.id}:`, subscriptionError.message);
                    }

                    return {
                        id: user.id,
                        name: user.full_name,
                        email: user.email,
                        mobile: user.mobile,
                        countryCode: user.country_code,
                        subscriptionType: user.subscription_type,
                        subscriptionId: user.subscription_id,
                        currentSubscription: currentSubscription,
                        trialExpired: user.trial_expired,
                        language: user.language,
                        memberSince: user.created_at
                    };
                })
            );

            existingUsers = existingUsersWithSubscriptions;
            console.log(`Found ${existingUsers.length} existing users for payment generator`);

        } catch (existingUsersError) {
            console.error('Error fetching existing users:', existingUsersError);
            existingUsers = [];
        }

        // Format data for frontend
        const formattedPlans = plans.map(plan => ({
            id: plan.id,
            name: plan.name,
            duration: {
                id: plan.Duration.id,
                name: plan.Duration.name,
                months: plan.Duration.months
            },
            lessonLength: {
                id: plan.LessonLength.id,
                minutes: plan.LessonLength.minutes
            },
            lessonsPerMonth: {
                id: plan.LessonsPerMonth.id,
                lessons: plan.LessonsPerMonth.lessons
            },
            price: plan.price
        }));

        // Group lesson lengths by duration
        const lessonLengthsByDuration = {};
        lessonLengths.forEach(length => {
            if (!lessonLengthsByDuration[length.duration_id]) {
                lessonLengthsByDuration[length.duration_id] = [];
            }
            lessonLengthsByDuration[length.duration_id].push({
                id: length.id,
                minutes: length.minutes
            });
        });

        // Group lessons per month by lesson length
        const lessonsPerMonthByLength = {};
        lessonsPerMonth.forEach(option => {
            if (!lessonsPerMonthByLength[option.lesson_length_id]) {
                lessonsPerMonthByLength[option.lesson_length_id] = [];
            }
            lessonsPerMonthByLength[option.lesson_length_id].push({
                id: option.id,
                lessons: option.lessons
            });
        });

        const responseData = {
            durations: durations.map(d => ({
                id: d.id,
                name: d.name,
                months: d.months
            })),
            lessonLengths: lessonLengthsByDuration,
            lessonsPerMonth: lessonsPerMonthByLength,
            plans: formattedPlans,
            students: students.map(s => ({
                id: s.id,
                name: s.student_name,
                parentName: s.parent_name,
                email: s.email,
                mobile: s.mobile,
                countryCode: s.country_code,
                age: s.age,
                status: s.status,
                trialClassStatus: s.trial_class_status,
                language: s.language
            })),
            existingUsers: existingUsers
        };

        console.log(`Payment generator data: ${students.length} trial students, ${existingUsers.length} existing users, ${formattedPlans.length} plans`);

        return res.status(200).json({
            status: 'success',
            data: responseData,
            message: 'Payment generator data retrieved successfully'
        });
    } catch (error) {
        console.error('Error getting payment generator data:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Helper function to get PayPlus recurring type
 */
const getPayPlusRecurringType = (durationType) => {
    switch (durationType.toLowerCase()) {
        case 'daily':
            return 0;
        case 'weekly':
            return 1;
        case 'monthly':
        case 'quarterly':
        case 'yearly':
            return 2; // Monthly (quarterly will use recurring_range = 3)
        default:
            return 2; // Default to monthly
    }
};

/**
 * Helper function to get PayPlus recurring range
 */
const getPayPlusRecurringRange = (durationType, customMonths) => {
    // Use customMonths if provided and valid
    const months = parseInt(customMonths, 10);
    if (!isNaN(months) && months > 0) {
        return months;
    }

    switch (durationType.toLowerCase()) {
        case 'daily':
        case 'weekly':
        case 'monthly':
            return 1;
        case 'quarterly':
            return 3; // Every 3 months
        case 'yearly':
            return 12;
        default:
            return 1;
    }
};

/**
 * Generate a payment link using PayPlus - ENHANCED VERSION
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const generatePaymentLink = async (req, res) => {
    let transaction;
    const startTime = Date.now();

    try {
        transaction = await sequelize.transaction();

        const {
            student_id,           // For trial class students
            existing_user_id,     // NEW: For existing users
            student_email,
            student_name,
            plan_id,
            lessons_per_month,
            duration_type,
            lesson_minutes,
            amount,
            currency,
            is_recurring,
            custom_amount,
            custom_months,
            mobile,
            country_code,
            recur_start_date,
            // Direct payment fields
            first_name,
            last_name,
            language,
            notes,
            is_parent            // NEW: For parent user scenario (child account)
        } = req.body;

        console.log('duration_type :',duration_type);

        // Log the generation attempt
        paymentLogger.logPaymentLinkGeneration({
            success: false, // Will update if successful
            student_id: student_id || existing_user_id,
            student_email,
            student_name,
            plan_details: {
                plan_id,
                lessons_per_month,
                duration_type,
                lesson_minutes,
                custom_months,
                is_recurring
            },
            amount: custom_amount || amount,
            currency: currency || 'ILS',
            is_recurring,
            request_details: {
                user_agent: req.headers['user-agent'],
                ip_address: req.ip,
                request_size: JSON.stringify(req.body).length,
                has_mobile: !!mobile,
                has_country_code: !!country_code,
                payment_type: existing_user_id ? 'existing_user' : (student_id ? 'trial_class' : 'direct_payment'),
                has_direct_payment_fields: !!(first_name && last_name)
            },
            generated_by: req.user?.id || 'unknown'
        });

        // Validate required fields - UPDATED FOR DIRECT PAYMENT
        const isDirectPayment = !student_id && !existing_user_id;

        if (isDirectPayment) {
            // Direct payment validation
            if (!first_name || !last_name || !student_name) {
                const errorDetails = {
                    missing_fields: {
                        first_name: !first_name,
                        last_name: !last_name,
                        student_name: !student_name
                    },
                    provided_fields: Object.keys(req.body)
                };

                paymentLogger.logPaymentLinkGeneration({
                    success: false,
                    student_id: 'direct_payment',
                    student_email,
                    student_name,
                    amount: custom_amount || amount,
                    currency: currency || 'ILS',
                    error_details: {
                        error_type: 'validation_error',
                        error_message: 'Missing required fields for direct payment',
                        validation_details: errorDetails
                    },
                    generated_by: req.user?.id || 'unknown'
                });

                if (transaction) await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'First name, last name, and student name are required for direct payment'
                });
            }

            // Either email or mobile is required for direct payment
            if (!student_email && !mobile) {
                paymentLogger.logPaymentLinkGeneration({
                    success: false,
                    student_id: 'direct_payment',
                    student_email,
                    student_name,
                    amount: custom_amount || amount,
                    currency: currency || 'ILS',
                    error_details: {
                        error_type: 'validation_error',
                        error_message: 'Either email or mobile is required for direct payment',
                        provided_data: { has_email: !!student_email, has_mobile: !!mobile }
                    },
                    generated_by: req.user?.id || 'unknown'
                });

                if (transaction) await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Either email or mobile phone number is required for direct payment'
                });
            }

            // Validate other required fields for direct payment
            if (!lessons_per_month || !duration_type || !lesson_minutes) {
                if (transaction) await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Missing required plan fields'
                });
            }
        } else {
            // Original validation for trial students and existing users
            if ((!student_id && !existing_user_id && !student_email) || !lessons_per_month || !duration_type || !lesson_minutes) {
                const errorDetails = {
                    missing_fields: {
                        student_identifier: !student_id && !existing_user_id && !student_email,
                        lessons_per_month: !lessons_per_month,
                        duration_type: !duration_type,
                        lesson_minutes: !lesson_minutes
                    },
                    provided_fields: Object.keys(req.body)
                };

                paymentLogger.logPaymentLinkGeneration({
                    success: false,
                    student_id: student_id || existing_user_id,
                    student_email,
                    student_name,
                    amount: custom_amount || amount,
                    currency: currency || 'ILS',
                    error_details: {
                        error_type: 'validation_error',
                        error_message: 'Missing required fields',
                        validation_details: errorDetails
                    },
                    generated_by: req.user?.id || 'unknown'
                });

                if (transaction) await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Missing required fields'
                });
            }
        }

        // Determine user context and payment type
        let userContext = null;
        let paymentType = 'direct_payment';
        let previousTrialStatus = null;

        if (existing_user_id) {
            // NEW: Handle existing user payments
            paymentType = 'existing_user';

            const existingUser = await User.findByPk(existing_user_id, { transaction });
            if (!existingUser) {
                paymentLogger.logPaymentLinkGeneration({
                    success: false,
                    student_id: existing_user_id,
                    student_email,
                    student_name,
                    amount: custom_amount || amount,
                    currency: currency || 'ILS',
                    error_details: {
                        error_type: 'user_not_found',
                        error_message: 'Existing user not found',
                        existing_user_id: existing_user_id
                    },
                    generated_by: req.user?.id || 'unknown'
                });

                if (transaction) await transaction.rollback();
                return res.status(404).json({
                    status: 'error',
                    message: 'Existing user not found'
                });
            }

            userContext = {
                id: existingUser.id,
                email: existingUser.email,
                student_name: existingUser.full_name,
                mobile: existingUser.mobile,
                country_code: existingUser.country_code
            };

            console.log('Existing User Details:', userContext);
            
            if (existingUser.email && existingUser.email.includes('+')) {
                const emailParts = existingUser.email.split('@');
                if (emailParts.length === 2) {
                    const [localPart, domain] = emailParts;
                    const [baseEmail, studentNamePart] = localPart.split('+');
                    
                    if (studentNamePart && studentNamePart.includes(' ')) {
                        // Convert spaces to hyphens for payment link
                        const studentNameWithHyphens = studentNamePart.replace(/\s+/g, '-').toLowerCase();
                        const convertedEmail = `${baseEmail}+${studentNameWithHyphens}@${domain}`;
                        
                        // Update userContext email for payment link (but keep original in database)
                        userContext.email = convertedEmail;
                        
                        // Also convert phone number if it has the formatted format with spaces
                        if (existingUser.mobile && existingUser.mobile.includes('+')) {
                            const phoneParts = existingUser.mobile.split('+');
                            if (phoneParts.length === 2) {
                                const [basePhone, phoneStudentName] = phoneParts;
                                if (phoneStudentName && phoneStudentName.includes(' ')) {
                                    const phoneStudentNameWithHyphens = phoneStudentName.replace(/\s+/g, '-').toLowerCase();
                                    const convertedPhone = `${basePhone}+${phoneStudentNameWithHyphens}`;
                                    userContext.mobile = convertedPhone;
                                }
                            }
                        }
                    }
                }
            }

        } else if (student_id) {
            // Handle trial class students (existing logic)
            paymentType = 'trial_class';

            const student = await TrialClassRegistration.findByPk(student_id, { transaction });
            if (!student) {
                paymentLogger.logPaymentLinkGeneration({
                    success: false,
                    student_id,
                    student_email,
                    student_name,
                    amount: custom_amount || amount,
                    currency: currency || 'ILS',
                    error_details: {
                        error_type: 'student_not_found',
                        error_message: 'Student not found in trial class registrations',
                        student_lookup: { student_id }
                    },
                    generated_by: req.user?.id || 'unknown'
                });

                if (transaction) await transaction.rollback();
                return res.status(404).json({
                    status: 'error',
                    message: 'Student not found in trial class registrations'
                });
            }
            previousTrialStatus = student.trial_class_status;
            userContext = {
                id: student_id,
                email: student.email,
                student_name: student.student_name,
                mobile: student.mobile,
                country_code: student.country_code
            };

        } else if (student_name && (student_email || mobile)) {
            // Handle direct payment - UPDATED to allow missing email if mobile is present
            paymentType = 'direct_payment';

            userContext = {
                email: student_email || '', // Allow empty email
                student_name: student_name,
                mobile: mobile,
                country_code: country_code,
                first_name: first_name,
                last_name: last_name,
                language: language || 'HE',
                notes: notes
            };
        } else {
            paymentLogger.logPaymentLinkGeneration({
                success: false,
                student_id: student_id || existing_user_id,
                student_email,
                student_name,
                amount: custom_amount || amount,
                currency: currency || 'ILS',
                error_details: {
                    error_type: 'insufficient_user_data',
                    error_message: 'Student ID, existing user ID, or student name with email/mobile are required',
                    provided_data: {
                        has_student_id: !!student_id,
                        has_existing_user_id: !!existing_user_id,
                        has_email: !!student_email,
                        has_name: !!student_name,
                        has_mobile: !!mobile
                    }
                },
                generated_by: req.user?.id || 'unknown'
            });

            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Student ID, existing user ID, or student name with email/mobile are required'
            });
        }

        console.log(`Payment Type: ${paymentType}`, userContext);

        // Check if email already exists in users table (only for trial_class and direct_payment)
        // Skip this check if is_parent is true (parent wants to create child account)
        if ((paymentType === 'trial_class' || paymentType === 'direct_payment') && userContext?.email && userContext.email.trim() !== '' && !is_parent) {
            const existingUserWithEmail = await User.findOne({
                where: {
                    email: Sequelize.where(
                        Sequelize.fn('LOWER', Sequelize.col('email')),
                        userContext.email.toLowerCase()
                    ),
                    status: 'active'
                },
                transaction
            });

            if (existingUserWithEmail) {
                paymentLogger.logPaymentLinkGeneration({
                    success: false,
                    student_id: student_id || existing_user_id,
                    student_email: userContext.email,
                    student_name: userContext.student_name,
                    amount: custom_amount || amount,
                    currency: currency || 'ILS',
                    error_details: {
                        error_type: 'email_already_exists',
                        error_message: 'Email already exists in system',
                        existing_user_id: existingUserWithEmail.id,
                        payment_type: paymentType
                    },
                    generated_by: req.user?.id || 'unknown'
                });

                if (transaction) await transaction.rollback();
                return res.status(409).json({
                    status: 'error',
                    message: 'This email is already used',
                    error_code: 'EMAIL_ALREADY_EXISTS'
                });
            }
        }

        // Determine the final amount
        const finalAmount = parseFloat(custom_amount || amount);
        if (!finalAmount || isNaN(finalAmount) || finalAmount <= 0) {
            paymentLogger.logPaymentLinkGeneration({
                success: false,
                student_id: student_id || existing_user_id,
                student_email: userContext?.email,
                student_name: userContext?.student_name,
                amount: custom_amount || amount,
                currency: currency || 'ILS',
                error_details: {
                    error_type: 'invalid_amount',
                    error_message: 'Invalid amount',
                    amount_analysis: {
                        raw_amount: amount,
                        custom_amount: custom_amount,
                        parsed_amount: finalAmount,
                        is_number: !isNaN(finalAmount),
                        is_positive: finalAmount > 0
                    }
                },
                generated_by: req.user?.id || 'unknown'
            });

            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid amount'
            });
        }

        // Create plan description
        const months = custom_months || 1;
        const planDescription = plan_id ?
            `Plan ${plan_id}` :
            `${duration_type} Plan - ${lesson_minutes}min lessons - ${lessons_per_month} lessons/month`;

        // Handle is_parent logic: Format email and phone with hyphens for payment link
        let finalEmail = userContext?.email || '';
        let finalPhone = userContext?.mobile || mobile || '';
        let originalPhone = finalPhone; // Store original phone for database storage
        let parentUser = null;
        let guardianId = null;

        if (is_parent && userContext?.email && userContext.email.trim() !== '') {
            // Get student name from context
            const studentName = userContext.student_name || student_name || 'Student';
            
            // Clean student name - trim and remove special chars but keep spaces
            const cleanStudentName = studentName.trim().replace(/[^a-zA-Z0-9\s]/g, '');
            
            const emailStudentName = cleanStudentName.replace(/\s+/g, '-');
            const emailParts = userContext.email.split('@');
            if (emailParts.length === 2 && emailStudentName) {
                finalEmail = `${emailParts[0]}+${emailStudentName}@${emailParts[1]}`;
                console.log(`📧 Parent email formatted for payment link: ${userContext.email} → ${finalEmail}`);
            }
            
            // Format phone for PayPlus only (not for database storage)
            if (finalPhone && emailStudentName) {
                const formattedPhoneForPayPlus = `${finalPhone}+${emailStudentName}`;
                // Truncate if exceeds 20 characters to ensure PayPlus compatibility
                // Keep original phone for database, use formatted only for PayPlus
                if (formattedPhoneForPayPlus.length <= 20) {
                    finalPhone = formattedPhoneForPayPlus;
                    console.log(`📱 Parent phone formatted for PayPlus: ${originalPhone} → ${finalPhone}`);
                } else {
                    // Truncate student name part to fit within 20 chars
                    const maxStudentNameLength = 20 - finalPhone.length - 1; // -1 for the '+' separator
                    const truncatedStudentName = emailStudentName.substring(0, Math.max(0, maxStudentNameLength));
                    finalPhone = `${finalPhone}+${truncatedStudentName}`;
                    console.log(`📱 Parent phone formatted for PayPlus (truncated): ${originalPhone} → ${finalPhone}`);
                }
            }

            // Find or create/update parent user with original email
            const existingUserWithEmail = await User.findOne({
                where: {
                    email: Sequelize.where(
                        Sequelize.fn('LOWER', Sequelize.col('email')),
                        userContext.email.toLowerCase()
                    ),
                    status: 'active'
                },
                transaction
            });

            if (existingUserWithEmail) {
                // Update existing user to set is_parent = 1
                await existingUserWithEmail.update({
                    is_parent: 1
                }, { transaction });
                parentUser = existingUserWithEmail;
            }

            // Get guardian_id (parent user ID) for additionalData
            guardianId = (parentUser && parentUser.id) ? parentUser.id : null;
            
            if (paymentType === 'trial_class' && student_id && !isNaN(student_id) && student_id > 0) {
                try {
                    const trialClassRegistration = await TrialClassRegistration.findByPk(student_id, {
                        transaction,
                        attributes: ['id', 'email', 'student_name']
                    });

                    if (trialClassRegistration) {
                        const previousEmail = trialClassRegistration.email;
                        
                        // Update trial class email with formatted email (with hyphens)
                        await trialClassRegistration.update({
                            email: finalEmail, // Use finalEmail (with +studentname if is_parent)
                        }, { transaction });

                        console.log(`📧 Updated trial class ${student_id} email in generatePaymentLink: ${previousEmail} → ${finalEmail}`);
                        console.log(`✅ Trial class email updated for parent scenario - will create new child user on payment success`);
                    }
                } catch (trialUpdateError) {
                    console.error('Warning: Error updating trial class email in generatePaymentLink:', trialUpdateError);
                    // Don't fail the entire request, but log the error
                }
            }
        }

        // Prepare additional data with SHORT KEYS to avoid truncation
        const additionalData = {
            pid: plan_id || 1,                             // plan_id
            sid: paymentType === 'trial_class' ? student_id : existing_user_id, // student_id
            tid: paymentType === 'trial_class' ? student_id : existing_user_id, // trail_user_id
            lpm: parseInt(lessons_per_month),              // lessons_per_month
            dt: duration_type,                             // duration_type
            lm: parseInt(lesson_minutes),                  // lesson_minutes
            m: parseInt(months),                           // months
            ir: is_recurring === true || is_recurring === 'true', // is_recurring
            spid: req.user?.id || null,                   // salesperson_id
            pt: paymentType,                              // payment_type
            fn: userContext.first_name || '',             // customer_first_name
            ln: userContext.last_name || '',              // customer_last_name
            lang: userContext.language || 'HE',           // customer_language
            notes: userContext.notes || '',                // customer_notes
            gid: guardianId                                // guardian_id (parent user ID) if is_parent
        };

        // Encode additional data
        const jsonData = JSON.stringify(additionalData);
        const base64 = Buffer.from(jsonData).toString('base64');
        const encodedData = encodeURIComponent(base64);

        console.log('Short Keys - encodedData length:', encodedData.length);
        console.log('Short Keys - additionalData:', additionalData);

        // Determine the recurring type based on duration type
        let recurringType = getPayPlusRecurringType(duration_type);
        let recurringRange = getPayPlusRecurringRange(duration_type, custom_months);

        // Prepare PayPlus customer object - UPDATED to handle missing email and is_parent formatting
        const customerData = {
            customer_name: userContext.student_name,
            phone: finalPhone || userContext.mobile || mobile || ''
        };

        // Use finalEmail (with +studentname if is_parent) or original email
        if (finalEmail && finalEmail.trim() !== '') {
            customerData.email = finalEmail;
        } else if (userContext.email && userContext.email.trim() !== '') {
            customerData.email = userContext.email;
        }

        // Prepare PayPlus request
        const payPlusRequest = {
            payment_page_uid: PAYPLUS_CONFIG.paymentPageUid,
            amount: finalAmount,
            currency_code: currency || 'ILS',
            sendEmailApproval: true,
            sendEmailFailure: true,
            send_failure_callback: true,
            successful_invoice: true,
            initial_invoice: true,
            send_customer_success_email: true,
            create_token: true,
            save_card_token: true,
            token_for_terminal_uid: PAYPLUS_CONFIG.terminalUid,
            refURL_success: `${process.env.FRONTEND_URL}/payment/payplus/success`,
            refURL_failure: `${process.env.FRONTEND_URL}/payment/payplus/failed`,
            refURL_callback: `${process.env.API_BASE_URL}/api/sales/payment-callback/payplus-webhook`,
            expiry_datetime: 999,
            customer: customerData, // Use the prepared customer data
            items: [{
                name: planDescription,
                quantity: 1,
                price: finalAmount,
                vat_type: 0 // No VAT
            }],
            more_info: plan_id || 'custom',
            more_info_1: (student_id || existing_user_id)?.toString() || '',
            more_info_2: lesson_minutes?.toString() || '',
            more_info_3: lessons_per_month?.toString() || '',
            more_info_4: months?.toString() || '',
            more_info_5: encodedData
        };

        let jumpPaymentValue = 30;

        if (custom_months && parseInt(custom_months) > 0) {
            jumpPaymentValue = parseInt(custom_months) * 30;
        } else {
            if (duration_type === 'monthly') {
                jumpPaymentValue = 30;
            } else if (duration_type === 'quarterly') {
                jumpPaymentValue = 90;
            } else if (duration_type === 'yearly') {
                jumpPaymentValue = 365;
            }
        }

        // Add recurring settings if payment is recurring
        if (is_recurring === true || is_recurring === 'true') {
            payPlusRequest.charge_method = 3; // Recurring
            payPlusRequest.payments = 1; // Immediate first payment
            payPlusRequest.recurring_settings = {
                instant_first_payment: true,
                recurring_type: recurringType,
                recurring_range: recurringRange,
                number_of_charges: 0,
                start_date_on_payment_date: true,
                jump_payments: jumpPaymentValue,
                successful_invoice: true,
                customer_failure_email: true,
                send_customer_success_email: true
            };
        } else {
            payPlusRequest.charge_method = 1; // One-time
            payPlusRequest.payments = 1;
        }

        console.log('payPlusRequest :', payPlusRequest);
        console.log('Final encodedData length:', encodedData.length);

        // Make API call to PayPlus
        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/PaymentPages/generateLink`,
            payPlusRequest,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_CONFIG.apiKey,
                    'secret-key': PAYPLUS_CONFIG.secretKey,
                },
                timeout: parseInt(process.env.PAYPLUS_TIMEOUT) || 30000
            }
        );

        if (response.data.results.status === 'success') {
            const paymentUrl = response.data.data.payment_page_link;
            const pageRequestUid = response.data.data.page_request_uid;

            let trialPaymentLink = null;
            let directPaymentCustomer = null;

            // Store Direct Payment customer data in dedicated table
            if (paymentType === 'direct_payment') {
                // Use originalPhone for database storage (max 20 chars), finalPhone is only for PayPlus
                const phoneForDatabase = originalPhone || userContext.mobile || mobile || '';
                // Ensure phone doesn't exceed 20 characters for database
                const truncatedPhoneForDatabase = phoneForDatabase.length > 20 
                    ? phoneForDatabase.substring(0, 20) 
                    : phoneForDatabase;
                
                const directPaymentData = {
                    page_request_uid: pageRequestUid,
                    first_name: userContext.first_name || '',
                    last_name: userContext.last_name || '',
                    email: (finalEmail && finalEmail.trim() !== '') ? finalEmail : ((userContext.email && userContext.email.trim() !== '') ? userContext.email : null),
                    phone: truncatedPhoneForDatabase,
                    country_code: userContext.country_code || country_code || '+972',
                    language: userContext.language || 'HE',
                    notes: userContext.notes || '',
                    payment_amount: finalAmount,
                    currency: currency || 'ILS',
                    lesson_minutes: parseInt(lesson_minutes),
                    lessons_per_month: parseInt(lessons_per_month),
                    duration_months: parseInt(months),
                    is_recurring: is_recurring === true || is_recurring === 'true',
                    plan_id: plan_id || null,
                    duration_type: duration_type,
                    salesperson_id: req.user?.id || null,
                    payment_status: 'pending',
                    payment_url: paymentUrl
                };

                directPaymentCustomer = await DirectPaymentCustomer.create(directPaymentData, { transaction });
                
                console.log(`Created DirectPaymentCustomer ${directPaymentCustomer.id} for page request ${pageRequestUid}`);

                paymentLogger.logPaymentLinkGeneration({
                    success: true,
                    student_id: 'direct_payment',
                    student_email: userContext.email,
                    student_name: `${userContext.first_name} ${userContext.last_name}`.trim(),
                    payment_url: paymentUrl,
                    page_request_uid: pageRequestUid,
                    direct_payment_customer_id: directPaymentCustomer.id,
                    request_details: {
                        direct_payment_data_stored: true,
                        customer_data_id: directPaymentCustomer.id,
                        payment_type: 'direct_payment'
                    },
                    generated_by: req.user?.id || 'unknown'
                });
            }

            // Create TrialPaymentLink record ONLY for trial class students
            if (paymentType === 'trial_class' && student_id) {
                trialPaymentLink = await createOrUpdateTrialPaymentLink({
                    student_id: student_id,
                    sales_user_id: req.user?.id,
                    subscription_plan_id: plan_id,
                    amount: finalAmount,
                    currency: currency || 'ILS',
                    payment_url: paymentUrl,
                    page_request_uid: pageRequestUid,
                    is_update: false,
                    payment_status: 'pending'
                }, transaction);

                // Update trial class status to 'payment_sent' and log status change
                const student = await TrialClassRegistration.findByPk(student_id, { transaction });
                const newStatus = 'payment_sent';

                await student.update({
                    trial_class_status: newStatus,
                    status_change_notes: `Payment link generated and sent. Link ID: ${trialPaymentLink?.id || 'N/A'}. Amount: ${finalAmount} ${currency || 'ILS'}. Generated by: ${req.user?.full_name || 'System'}. Timestamp: ${new Date().toISOString()}`
                }, { transaction });

                await logTrialClassStatusChange(
                    student_id,
                    previousTrialStatus,
                    newStatus,
                    req.user?.id || 1,
                    req.user?.role_name === 'sales_role' ? 'sales_role' : 'admin',
                    `Payment link generated. Amount: ${finalAmount} ${currency || 'ILS'}. Link ID: ${trialPaymentLink?.id || 'N/A'}`,
                    transaction
                );

                console.log(`Updated trial class ${student_id} status: ${previousTrialStatus} -> ${newStatus}`);

                paymentLogger.logTrialClassStatusChange({
                    trial_class_id: student_id,
                    student_id: student_id,
                    previous_status: previousTrialStatus,
                    new_status: newStatus,
                    changed_by: req.user?.full_name || 'System',
                    payment_context: {
                        payment_link_id: trialPaymentLink?.id,
                        amount: finalAmount,
                        currency: currency || 'ILS',
                        page_request_uid: pageRequestUid
                    },
                    trial_payment_link_id: trialPaymentLink?.id
                });
            }

            await transaction.commit();

            const processingTime = Date.now() - startTime;

            // Log successful payment link generation
            paymentLogger.logPaymentLinkGeneration({
                success: true,
                student_id: student_id || existing_user_id,
                student_email: userContext.email,
                student_name: userContext.student_name,
                plan_details: {
                    plan_id,
                    lessons_per_month,
                    duration_type,
                    lesson_minutes,
                    custom_months,
                    is_recurring: is_recurring === true || is_recurring === 'true'
                },
                amount: finalAmount,
                currency: currency || 'ILS',
                is_recurring: is_recurring === true || is_recurring === 'true',
                payment_url: paymentUrl,
                page_request_uid: pageRequestUid,
                trial_payment_link_id: trialPaymentLink?.id,
                direct_payment_customer_id: directPaymentCustomer?.id,
                request_details: {
                    processing_time_ms: processingTime,
                    payplus_response_status: response.status,
                    payplus_payload_size: JSON.stringify(payPlusRequest).length,
                    encoded_data_length: encodedData.length,
                    short_keys_used: true,
                    user_agent: req.headers['user-agent'],
                    ip_address: req.ip,
                    payment_type: paymentType,
                    direct_payment_stored: !!directPaymentCustomer
                },
                generated_by: req.user?.id || 'unknown'
            });

            return res.status(200).json({
                status: 'success',
                data: {
                    payment_link: paymentUrl,
                    page_request_uid: pageRequestUid,
                    qr_code_image: response.data.data.qr_code_image,
                    trial_payment_link_id: trialPaymentLink?.id || null,
                    direct_payment_customer_id: directPaymentCustomer?.id || null,
                    link_token: trialPaymentLink?.link_token || pageRequestUid,
                    payment_type: paymentType,
                    // Return formatted email and phone if is_parent is true (for short link storage)
                    formatted_email: finalEmail || userContext.email, // Use finalEmail (with +studentname if is_parent)
                    formatted_phone: finalPhone || userContext.mobile || mobile || '', // Use finalPhone (with +studentname if is_parent)
                    is_parent: is_parent || false,
                    details: {
                        student_id: student_id || null,
                        existing_user_id: existing_user_id || null,
                        student_email: finalEmail || userContext.email, // Use finalEmail (with +studentname if is_parent)
                        student_name: userContext.student_name,
                        plan_id: plan_id || null,
                        lessons_per_month,
                        duration_type,
                        lesson_minutes,
                        amount: finalAmount,
                        currency: currency || 'ILS',
                        is_recurring: is_recurring === true || is_recurring === 'true',
                        created_by: req.user?.id || null,
                        created_at: new Date(),
                        status: 'active',
                        trial_class_status_updated: paymentType === 'trial_class',
                        direct_payment_data_stored: paymentType === 'direct_payment'
                    }
                },
                message: 'PayPlus payment link generated successfully'
            });
        } else {
            if (transaction) await transaction.rollback();
            
            const processingTime = Date.now() - startTime;
            
            paymentLogger.logPaymentLinkGeneration({
                success: false,
                student_id: student_id || existing_user_id,
                student_email: userContext?.email,
                student_name: userContext?.student_name,
                amount: finalAmount,
                currency: currency || 'ILS',
                error_details: {
                    error_type: 'payplus_api_error',
                    error_message: response.data.results.description || 'PayPlus API error',
                    payplus_response: {
                        status: response.data.results.status,
                        description: response.data.results.description,
                        response_size: JSON.stringify(response.data).length
                    },
                    processing_time_ms: processingTime
                },
                generated_by: req.user?.id || 'unknown'
            });
            
            throw new Error(response.data.results.description || 'PayPlus API error');
        }
    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        const processingTime = Date.now() - startTime;

        paymentLogger.logPaymentLinkGeneration({
            success: false,
            student_id: req.body.student_id || req.body.existing_user_id,
            student_email: req.body.student_email,
            student_name: req.body.student_name,
            amount: req.body.custom_amount || req.body.amount,
            currency: req.body.currency || 'ILS',
            error_details: {
                error_type: error.response ? 'api_error' : 'system_error',
                error_message: error.message,
                error_stack: error.stack,
                axios_error: error.response ? {
                    status: error.response.status,
                    status_text: error.response.statusText,
                    data: error.response.data,
                    headers: error.response.headers
                } : null,
                processing_time_ms: processingTime,
                transaction_rolled_back: true
            },
            generated_by: req.user?.id || 'unknown'
        });

        console.error('Error generating PayPlus payment link:', error.response?.data || error.message);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to generate PayPlus payment link',
            details: error.response?.data?.results?.description || error.message
        });
    }
};

/**
 * Search students for the payment link generator
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const searchStudents = async (req, res) => {
    try {
        const { query } = req.query;

        if (!query || query.length < 2) {
            return res.status(400).json({
                status: 'error',
                message: 'Query must be at least 2 characters long'
            });
        }

        const students = await TrialClassRegistration.findAll({
            where: {
                [Op.or]: [
                    { student_name: { [Op.like]: `%${query}%` } },
                    { email: { [Op.like]: `%${query}%` } },
                    { parent_name: { [Op.like]: `%${query}%` } },
                    { mobile: { [Op.like]: `%${query}%` } }
                ]
            },
            attributes: [
                'id',
                'student_name',
                'parent_name',
                'email',
                'mobile',
                'country_code',
                'age',
                'status',
                'trial_class_status',
                'language'
            ],
            limit: 20,
            order: [['created_at', 'DESC']]
        });

        return res.status(200).json({
            status: 'success',
            data: students.map(s => ({
                id: s.id,
                name: s.student_name,
                parentName: s.parent_name,
                email: s.email,
                mobile: s.mobile,
                countryCode: s.country_code,
                age: s.age,
                status: s.status,
                trialClassStatus: s.trial_class_status,
                language: s.language
            })),
            message: 'Students retrieved successfully'
        });
    } catch (error) {
        console.error('Error searching students:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Send payment link via email - ENHANCED VERSION
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const sendPaymentLinkEmail = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();

        const {
            payment_link,
            student_email,
            student_name,
            plan_details = {},
            link_token,
            student_id
        } = req.body;

        // Input validation
        if (!payment_link || !student_email || !student_name) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Payment link, student email, and student name are required'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(student_email)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid email format'
            });
        }

        // Prepare email template parameters
        const emailParams = {
            'student.name': student_name,
            'package.name': plan_details.planType || 'Learning Package',
            'amount': plan_details.amount || '0',
            'currency': plan_details.currency || 'ILS',
            'payment.link': payment_link,
            'expiry.days': '7', // Default expiry
            'sales.name': req.user?.full_name || 'Sales Team'
        };

        // Send direct email notification
        const recipientDetails = {
            email: student_email,
            full_name: student_name,
            language: plan_details.language || 'EN'
        };

        const emailSent = await sendNotificationEmail(
            'payment_link_created',
            emailParams,
            recipientDetails,
            true // Always treat as trial user
        );

        if (emailSent) {
            // Update TrialPaymentLink record if link_token provided
            if (link_token) {
                const trialPaymentLink = await TrialPaymentLink.findOne({
                    where: { link_token: link_token },
                    transaction
                });

                if (trialPaymentLink) {
                    await trialPaymentLink.update({
                        sent_via_email: true,
                        email_sent_at: new Date()
                    }, { transaction });

                    console.log(`📧 Updated TrialPaymentLink ${trialPaymentLink.id} - email sent`);
                }
            }

            await transaction.commit();

            return res.status(200).json({
                status: 'success',
                message: `Payment link email sent successfully to ${student_email}`,
                data: {
                    recipient_email: student_email,
                    template_used: 'payment_link_created',
                    trial_payment_link_updated: !!link_token
                }
            });
        } else {
            if (transaction) await transaction.rollback();
            return res.status(500).json({
                status: 'error',
                message: 'Failed to send payment link WhatsApp message'
            });
        }

    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        console.error('Error in sendPaymentLinkWhatsApp:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Send payment link via WhatsApp
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const sendPaymentLinkWhatsApp = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();

        const {
            payment_link,
            student_mobile,
            student_name,
            country_code,
            plan_details = {},
            link_token,
            student_id
        } = req.body;

        // Input validation
        if (!payment_link || !student_mobile || !student_name) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Payment link, student mobile, and student name are required'
            });
        }

        // Validate mobile number format (basic validation)
        const cleanMobile = student_mobile.replace(/[^\d]/g, '');
        if (cleanMobile.length < 7) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid mobile number format'
            });
        }

        // Determine if this is a recurring payment
        const isRecurring = plan_details.paymentType === 'recurring' || 
                           plan_details.is_recurring === true || 
                           plan_details.is_recurring === 'true' || 
                           plan_details.isRecurring === true ||
                           plan_details.isRecurring === 'true';

        // Choose the appropriate WhatsApp template based on payment type
        const templateName = isRecurring ? 'recurring_payment' : 'onetime_payment';

        // Prepare WhatsApp template parameters
        const whatsappParams = {
            'student.name': student_name,
            'package.name': plan_details.planType || 'Learning Package',
            'payment.link': payment_link
        };

        // Prepare student details for WhatsApp notification
        const studentDetails = {
            country_code: country_code || '+972', // Default to Israel if not provided
            mobile: cleanMobile,
            full_name: student_name,
            language:  'HE'
        };

        const whatsappSent = await whatsappReminderTrailClass(
            templateName, // Use dynamic template name
            whatsappParams,
            studentDetails
        );

        if (whatsappSent) {
            // Update TrialPaymentLink record if link_token provided
            if (link_token) {
                const trialPaymentLink = await TrialPaymentLink.findOne({
                    where: { link_token: link_token },
                    transaction
                });

                if (trialPaymentLink) {
                    await trialPaymentLink.update({
                        sent_via_whatsapp: true,
                        whatsapp_sent_at: new Date()
                    }, { transaction });

                    console.log(`📱 Updated TrialPaymentLink ${trialPaymentLink.id} - WhatsApp sent`);
                }
            }

            await transaction.commit();

            return res.status(200).json({
                status: 'success',
                message: `Payment link WhatsApp sent successfully to ${student_mobile}`,
                data: {
                    recipient_mobile: student_mobile,
                    template_used: templateName,
                    is_recurring: isRecurring,
                    trial_payment_link_updated: !!link_token
                }
            });
        } else {
            if (transaction) await transaction.rollback();
            return res.status(500).json({
                status: 'error',
                message: 'Failed to send payment link WhatsApp message'
            });
        }

    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        console.error('Error in sendPaymentLinkWhatsApp:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Store payment data and return short ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const storePaymentData = async (req, res) => {
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

        // Set default expiration to 7 days from now if not provided
        const expirationDate = expires_at
            ? new Date(expires_at)
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        // Check if short_id already exists
        const existingLink = await PaymentLinks.findOne({
            where: { short_id }
        });

        if (existingLink) {
            return res.status(409).json({
                status: 'error',
                message: 'Short ID already exists. Please try again.'
            });
        }

        // Create new payment link record
        const paymentLink = await PaymentLinks.create({
            short_id,
            payment_data: typeof payment_data === 'string' ? payment_data : JSON.stringify(payment_data),
            expires_at: expirationDate,
            created_at: new Date(),
            status: 'active'
        });

        console.log('💾 Payment data stored successfully with short ID:', short_id);

        return res.status(201).json({
            status: 'success',
            data: {
                short_id: paymentLink.short_id,
                expires_at: paymentLink.expires_at,
                created_at: paymentLink.created_at
            },
            message: 'Payment data stored successfully'
        });

    } catch (error) {
        console.error('❌ Error storing payment data:', error);

        // Handle unique constraint violations
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({
                status: 'error',
                message: 'Short ID already exists. Please try again.'
            });
        }

        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get payment data by short ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getPaymentData = async (req, res) => {
    try {
        const { shortId } = req.params;

        if (!shortId) {
            return res.status(400).json({
                status: 'error',
                message: 'Short ID is required'
            });
        }

        // Validate short_id format
        if (!/^[A-Za-z0-9]{8}$/.test(shortId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid short ID format'
            });
        }

        // Find payment link that is active and not expired
        const paymentLink = await PaymentLinks.findOne({
            where: {
                short_id: shortId,
                expires_at: {
                    [Op.gt]: new Date() // Not expired
                },
                status: 'active'
            }
        });

        if (!paymentLink) {
            return res.status(404).json({
                status: 'error',
                message: 'Payment link not found or expired'
            });
        }

        // Update access tracking
        await PaymentLinks.update(
            {
                accessed_at: new Date(),
                access_count: sequelize.literal('access_count + 1')
            },
            {
                where: { short_id: shortId }
            }
        );

        // Parse payment data
        let paymentData;
        try {
            paymentData = typeof paymentLink.payment_data === 'string'
                ? JSON.parse(paymentLink.payment_data)
                : paymentLink.payment_data;
        } catch (parseError) {
            console.error('Error parsing payment data:', parseError);
            return res.status(500).json({
                status: 'error',
                message: 'Invalid payment data format'
            });
        }

        console.log('📖 Payment data retrieved successfully for short ID:', shortId);

        return res.status(200).json({
            status: 'success',
            data: paymentData,
            meta: {
                short_id: paymentLink.short_id,
                expires_at: paymentLink.expires_at,
                created_at: paymentLink.created_at,
                access_count: paymentLink.access_count + 1 // Include the current access
            },
            message: 'Payment data retrieved successfully'
        });

    } catch (error) {
        console.error('❌ Error retrieving payment data:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};
/**
 * Update email and regenerate payment link for existing payment data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updatePaymentEmail = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();

        const { shortId } = req.params;
        let { email, is_parent } = req.body;

        // Validate inputs
        if (!shortId || !email) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Short ID and email are required'
            });
        }

        // Trim and normalize email
        email = email.trim().toLowerCase();
        is_parent = is_parent === true || is_parent === 'true' || is_parent === 1;

        // Validate short_id format
        if (!/^[A-Za-z0-9]{8}$/.test(shortId)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid short ID format'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid email format'
            });
        }

        // Check if email already exists in users table
        const existingUserWithEmail = await User.findOne({
            where: {
                email: Sequelize.where(
                    Sequelize.fn('LOWER', Sequelize.col('email')),
                    email
                ),
                status: 'active'
            },
            transaction
        });

        if (existingUserWithEmail && !is_parent) {
            if (transaction) await transaction.rollback();
            return res.status(409).json({
                status: 'error',
                message: 'This email is already used.',
                error_code: 'EMAIL_ALREADY_EXISTS'
            });
        }

        // Find existing payment link
        const paymentLink = await PaymentLinks.findOne({
            where: {
                short_id: shortId,
                expires_at: {
                    [Op.gt]: new Date() // Not expired
                },
                status: 'active'
            },
            transaction
        });

        if (!paymentLink) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Payment link not found or expired'
            });
        }

        // Parse existing payment data
        let existingPaymentData;
        try {
            let parsedData = paymentLink.payment_data;
            
            // Handle double-encoded JSON
            if (typeof parsedData === 'string') {
                parsedData = JSON.parse(parsedData);
                
                // If still a string, parse again (double-encoded)
                if (typeof parsedData === 'string') {
                    parsedData = JSON.parse(parsedData);
                }
            }
            
            existingPaymentData = parsedData;
        } catch (parseError) {
            if (transaction) await transaction.rollback();
            console.error('Error parsing existing payment data:', parseError);
            return res.status(500).json({
                status: 'error',
                message: 'Invalid existing payment data format'
            });
        }

        // Handle is_parent logic: Update user and format email/phone
        let finalEmail = email;
        let finalPhone = existingPaymentData?.mobile || '';
        let originalPhone = existingPaymentData?.mobile || ''; // Store original phone for database storage
        let parentUser = null;
        
        if (is_parent) {
            // Get student name from payment data
            const studentName = existingPaymentData?.student_name 
                || (existingPaymentData?.customer_first_name && existingPaymentData?.customer_last_name 
                    ? `${existingPaymentData.customer_first_name} ${existingPaymentData.customer_last_name}`
                    : null)
                || 'Student';

            const cleanStudentName = studentName.trim().replace(/[^a-zA-Z0-9\s]/g, '');
            
            const emailStudentName = cleanStudentName.replace(/\s+/g, '-');
            const emailParts = email.split('@');
            if (emailParts.length === 2 && emailStudentName) {
                finalEmail = `${emailParts[0]}+${emailStudentName}@${emailParts[1]}`;
            }
            // Format phone number for PayPlus only (not for database storage)
            if (originalPhone && emailStudentName) {
                const formattedPhoneForPayPlus = `${originalPhone}+${emailStudentName}`;
                // Truncate if exceeds 20 characters to ensure PayPlus compatibility
                if (formattedPhoneForPayPlus.length <= 20) {
                    finalPhone = formattedPhoneForPayPlus;
                } else {
                    // Truncate student name part to fit within 20 chars
                    const maxStudentNameLength = 20 - originalPhone.length - 1; // -1 for the '+' separator
                    const truncatedStudentName = emailStudentName.substring(0, Math.max(0, maxStudentNameLength));
                    finalPhone = `${originalPhone}+${truncatedStudentName}`;
                }
            }

            // Find or create/update parent user with original email
            if (existingUserWithEmail) {
                // Update existing user to set is_parent = 1
                await existingUserWithEmail.update({
                    is_parent: 1
                }, { transaction });
                parentUser = existingUserWithEmail;
            }
        }

        console.log('🔄 Updating payment data for shortId:', shortId, 'with new email:', finalEmail);

        let trialClassUpdated = false;
        const studentId = existingPaymentData.student_id;
        
        if (studentId && !isNaN(studentId) && studentId > 0) {
            try {
                const trialClassRegistration = await TrialClassRegistration.findByPk(studentId, {
                    transaction,
                    attributes: ['id', 'email', 'student_name', 'status_change_notes']
                });

                if (trialClassRegistration) {
                    const previousEmail = trialClassRegistration.email;
                    
                    await trialClassRegistration.update({
                        email: finalEmail, // Use finalEmail (with +studentname if is_parent)
                    }, { transaction });

                    trialClassUpdated = true;
                    console.log(`📧 Updated trial class ${studentId} email: ${previousEmail} → ${finalEmail}`);
                }
            } catch (trialUpdateError) {
                console.error('Warning: Error updating trial class email:', trialUpdateError);
            }
        }

        // Update DirectPaymentCustomer record using phone number matching
        let directPaymentUpdated = false;
        const customerMobile = existingPaymentData.mobile;
        const customerCountryCode = existingPaymentData.country_code;

        // Only try to update DirectPaymentCustomer if we have phone number and it's likely a direct payment
        if (customerMobile && (!studentId || isNaN(studentId) || studentId <= 0)) {
            try {
                console.log('Searching for DirectPaymentCustomer with mobile:', customerMobile, 'country_code:', customerCountryCode);
                
                // Build where condition for phone matching
                let whereCondition = { phone: customerMobile };
                
                // Add country code to search if available
                if (customerCountryCode) {
                    whereCondition.country_code = customerCountryCode;
                }

                const directPaymentCustomer = await DirectPaymentCustomer.findOne({
                    where: whereCondition,
                    order: [['id', 'DESC']], // Get the most recent one if multiple exist
                    transaction
                });

                if (directPaymentCustomer) {
                    const previousEmail = directPaymentCustomer.email;
                    const previousPhone = directPaymentCustomer.phone;
                    
                    const updateData = {
                        email: finalEmail, // Use finalEmail (with +studentname if is_parent)
                        updated_at: new Date()
                    };
                    
                    // Don't update phone in database - keep original phone, formatted phone is only for PayPlus
                    // The phone field in database should remain as originalPhone (max 20 chars)
                    const phoneForDatabase = originalPhone || previousPhone;
                    const truncatedPhoneForDatabase = phoneForDatabase.length > 20 
                        ? phoneForDatabase.substring(0, 20) 
                        : phoneForDatabase;
                    
                    // Only update phone if it's different and within limit
                    if (truncatedPhoneForDatabase !== previousPhone) {
                        updateData.phone = truncatedPhoneForDatabase;
                    }
                    
                    await directPaymentCustomer.update(updateData, { transaction });

                    directPaymentUpdated = true;
                    console.log(`Updated DirectPaymentCustomer ${directPaymentCustomer.id} email: ${previousEmail} -> ${finalEmail}`);
                    if (is_parent && finalPhone && finalPhone !== previousPhone) {
                        console.log(`📱 PayPlus phone formatted: ${originalPhone} -> ${finalPhone} (database keeps: ${truncatedPhoneForDatabase})`);
                    }
                } else {
                    console.log('No DirectPaymentCustomer found with phone:', customerMobile);
                }
            } catch (directPaymentUpdateError) {
                console.error('Warning: Error updating DirectPaymentCustomer email:', directPaymentUpdateError);
                // Don't fail the entire operation, just log the error
            }
        }

        // Prepare PayPlus request with updated email
        const finalAmount = parseFloat(existingPaymentData.sum);
        const currency = existingPaymentData.currency || 'ILS';
        const studentName = existingPaymentData.student_name;
        const planDescription = existingPaymentData.pdesc;
        const isRecurring = existingPaymentData.is_recurring === 'true' || existingPaymentData.is_recurring === true;

        // FIXED: Extract all fields properly from stored data
        const planId = existingPaymentData.plan_id || 'custom';
        const lessonsPerMonth = parseInt(existingPaymentData.lessons_per_month) || 4;
        const lessonMinutes = parseInt(existingPaymentData.lesson_minutes) || 25;
        const durationType = existingPaymentData.duration_type || 'monthly';
        
        // FIXED: Handle months field properly - use custom_months for custom plans, calculate for others
        let months;
        if (planId === 'custom' && existingPaymentData.custom_months) {
            months = parseInt(existingPaymentData.custom_months);
        } else if (durationType === 'monthly') {
            months = 1;
        } else if (durationType === 'quarterly') {
            months = 3;
        } else if (durationType === 'yearly') {
            months = 12;
        } else {
            months = 1; // Default fallback
        }

        // FIXED: Get salesperson_id from stored data or fallback
        const salespersonId = existingPaymentData.salesperson_id || null;

        // Get guardian_id (parent user ID) if is_parent is true
        const guardianId = (is_parent && parentUser && parentUser.id) ? parentUser.id : null;

        // Create enhanced additional data object with all required fields
        const additionalData = {
            pid: planId,                                   // plan_id
            sid: studentId || null,                        // student_id
            tid: studentId || null,                        // trail_user_id  
            lpm: lessonsPerMonth,                          // lessons_per_month
            dt: durationType,                              // duration_type
            lm: lessonMinutes,                             // lesson_minutes
            m: months,                                     // months
            ir: isRecurring,                               // is_recurring
            spid: salespersonId,                           // salesperson_id
            pt: directPaymentUpdated ? 'direct_payment' : 'trial_class', // payment_type
            fn: existingPaymentData.customer_first_name || '', // customer_first_name
            ln: existingPaymentData.customer_last_name || '',  // customer_last_name
            lang: existingPaymentData.customer_language || 'HE', // customer_language
            notes: existingPaymentData.customer_notes || '',     // customer_notes
            gid: guardianId                                // guardian_id (parent user ID)
        };

        // Encode additional data
        const jsonData = JSON.stringify(additionalData);
        const base64 = Buffer.from(jsonData).toString('base64');
        const encodedData = encodeURIComponent(base64);

        // Determine recurring settings
        const recurringType = getPayPlusRecurringType(durationType);
        const recurringRange = getPayPlusRecurringRange(durationType, existingPaymentData.custom_months);;

        // Prepare PayPlus request
        const payPlusRequest = {
            payment_page_uid: PAYPLUS_CONFIG.paymentPageUid,
            amount: finalAmount,
            currency_code: currency,
            sendEmailApproval: true,
            sendEmailFailure: true,
            send_failure_callback: true,
            successful_invoice: true,
            initial_invoice: true,
            send_customer_success_email: true,
            create_token: true,
            save_card_token: true,
            token_for_terminal_uid: PAYPLUS_CONFIG.terminalUid,
            refURL_success: `${process.env.FRONTEND_URL}/payment/payplus/success`,
            refURL_failure: `${process.env.FRONTEND_URL}/payment/payplus/failed`,
            refURL_callback: `${process.env.API_BASE_URL}/api/sales/payment-callback/payplus-webhook`,
            expiry_datetime: 999,
            customer: {
                customer_name: studentName,
                email: finalEmail, // Use finalEmail (with +studentname if is_parent)
                phone: finalPhone // Use finalPhone (with +studentname if is_parent)
            },
            items: [{
                name: planDescription,
                quantity: 1,
                price: finalAmount,
                vat_type: 0 // No VAT
            }],
            // Proper field mappings using short keys
            more_info: planId,
            more_info_1: (studentId || '')?.toString(),
            more_info_2: lessonMinutes?.toString() || '',
            more_info_3: lessonsPerMonth?.toString() || '',
            more_info_4: months?.toString() || '',
            more_info_5: encodedData
        };

        let jumpPaymentValue = 30;

        if (existingPaymentData.custom_months && parseInt(existingPaymentData.custom_months) > 0) {
            // Custom plan → calculate jump days dynamically
            jumpPaymentValue = parseInt(existingPaymentData.custom_months) * 30;
        } else {
            // Fallback to predefined duration types
            if (durationType === 'monthly') {
                jumpPaymentValue = 30;
            } else if (durationType === 'quarterly') {
                jumpPaymentValue = 90;
            } else if (durationType === 'yearly') {
                jumpPaymentValue = 365;
            }
        }

        // Add recurring settings if payment is recurring
        if (isRecurring) {
            payPlusRequest.charge_method = 3; // Recurring
            payPlusRequest.payments = 1; // Immediate first payment
            payPlusRequest.recurring_settings = {
                instant_first_payment: true,
                recurring_type: recurringType,
                recurring_range: recurringRange,
                number_of_charges: 0,
                start_date_on_payment_date: true,
                // start_date: existingPaymentData.recur_start_date ? 
                //     Math.min(parseInt(moment(existingPaymentData.recur_start_date).format('DD')), 28) : undefined,
                jump_payments: jumpPaymentValue,
                successful_invoice: true,
                customer_failure_email: true,
                send_customer_success_email: true
            };
        } else {
            payPlusRequest.charge_method = 1; // One-time
            payPlusRequest.payments = 1;
        }

        console.log('🟨 PayPlus Update Payload:', JSON.stringify(payPlusRequest, null, 2));

        // Make API call to PayPlus
        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/PaymentPages/generateLink`,
            payPlusRequest,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_CONFIG.apiKey,
                    'secret-key': PAYPLUS_CONFIG.secretKey,
                },
                timeout: parseInt(process.env.PAYPLUS_TIMEOUT) || 30000
            }
        );

        paymentLogger.logPaymentLinkGeneration({
            success: true,
            student_id: studentId,
            student_email: finalEmail, // Use finalEmail (with +studentname if is_parent)
            student_name: studentName,
            amount: finalAmount,
            currency: currency,
            is_recurring: isRecurring,
            request_details: {
                operation: 'update_email',
                short_id: shortId,
                trial_class_updated: trialClassUpdated,
                direct_payment_updated: directPaymentUpdated,
                phone_number: customerMobile,
                country_code: customerCountryCode,
                payPlusRequestAfterStudentEmailIdAdd: payPlusRequest
            },
            generated_by: req.user?.id || 'email_update'
        });

        if (response.data.results.status === 'success') {
            const newPaymentUrl = response.data.data.payment_page_link;
            const newPageRequestUid = response.data.data.page_request_uid;

            // Update payment data with new email and payment link
            const updatedPaymentData = {
                ...existingPaymentData,
                student_email: finalEmail, // Use finalEmail (with +studentname if is_parent)
                mobile: finalPhone, // Use finalPhone (with +studentname if is_parent)
                payment_link: newPaymentUrl,
                page_request_uid: newPageRequestUid,
                updated_at: new Date().toISOString(),
                email_updated: true,
                email_updated_at: new Date().toISOString(),
                is_parent: is_parent || false
            };

            // Update the payment link record
            await PaymentLinks.update(
                {
                    payment_data: JSON.stringify(updatedPaymentData),
                    updated_at: new Date()
                },
                {
                    where: { short_id: shortId },
                    transaction
                }
            );

            await transaction.commit();

            console.log('✅ Email update successful - returning formatted email:', finalEmail);
            console.log('✅ Email update successful - returning formatted phone:', finalPhone);
            console.log('✅ Updated payment data student_email:', updatedPaymentData.student_email);
            console.log('✅ Updated payment data mobile:', updatedPaymentData.mobile);

            return res.status(200).json({
                status: 'success',
                data: updatedPaymentData,
                meta: {
                    short_id: shortId,
                    email_updated: true,
                    new_payment_link: newPaymentUrl,
                    new_page_request_uid: newPageRequestUid,
                    trial_class_updated: trialClassUpdated,
                    direct_payment_updated: directPaymentUpdated,
                    student_id: studentId,
                    phone_number: customerMobile,
                    country_code: customerCountryCode,
                    additional_data_used: additionalData,
                    payplus_fields: {
                        more_info: payPlusRequest.more_info,
                        more_info_1: payPlusRequest.more_info_1,
                        more_info_2: payPlusRequest.more_info_2,
                        more_info_3: payPlusRequest.more_info_3,
                        more_info_4: payPlusRequest.more_info_4
                    }
                },
                message: 'Email updated and new payment link generated successfully'
            });

        } else {
            if (transaction) await transaction.rollback();
            throw new Error(response.data.results.description || 'PayPlus API error during email update');
        }

    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        console.error('❌ Error updating payment email:', error.response?.data || error.message);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update email and regenerate payment link',
            details: error.response?.data?.results?.description || error.message
        });
    }
};

/**
 * Search existing users for the payment link generator
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const searchExistingUsers = async (req, res) => {
    try {
        const { query } = req.query;

        if (!query || query.length < 2) {
            return res.status(400).json({
                status: 'error',
                message: 'Query must be at least 2 characters long'
            });
        }

        const users = await User.findAll({
            where: {
                status: 'active',
                role_name: 'user',
                full_name: { [Op.like]: `%${query}%` }
            },
            attributes: [
                'id',
                'full_name',
                'email',
                'mobile',
                'country_code',
                'created_at'
            ],
            limit: 20,
            order: [['created_at', 'DESC']]
        });

        const formattedUsers = users.map(user => ({
            id: user.id,
            name: user.full_name,
            email: user.email,
            mobile: user.mobile,
            countryCode: user.country_code,
            memberSince: user.created_at
        }));

        return res.status(200).json({
            status: 'success',
            data: formattedUsers,
            message: 'Existing users retrieved successfully'
        });
    } catch (error) {
        console.error('Error searching existing users:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

module.exports = {
    getPaymentGeneratorData,
    generatePaymentLink,
    searchStudents,
    sendPaymentLinkEmail,
    sendPaymentLinkWhatsApp,
    storePaymentData,
    getPaymentData,
    updatePaymentEmail,
    searchExistingUsers,
    saveManualPayment
};