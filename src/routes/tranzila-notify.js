// routes/tranzila-notify.js
const express = require("express");
const router = express.Router();
const bodyParser = require("body-parser");
const User = require("../models/users");
const UserSubscriptionDetails = require("../models/UserSubscriptionDetails");
const SubscriptionPlan = require("../models/subscription_plan");
const SubscriptionDuration = require("../models/subscription_duration");
const LessonLength = require("../models/lesson_length");
const LessonsPerMonth = require("../models/lessons_per_month");
const PaymentTransaction = require("../models/PaymentTransaction");
const TranzilaNotification = require("../models/TranzilaNotification"); // New model
const moment = require("moment");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { sequelize } = require("../connection/connection");
const { Op } = require("sequelize");

// Use middleware to parse application/x-www-form-urlencoded
router.use(bodyParser.urlencoded({ extended: true }));

// Setup logging
const logsDir = path.join(__dirname, '../logs');
// Create logs directory if it doesn't exist
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Logger function
function logToFile(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logDate = timestamp.split('T')[0]; // YYYY-MM-DD
    const logFile = path.join(logsDir, `tranzila-notifications-${logDate}.log`);
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
    
    fs.appendFileSync(logFile, logEntry);
    
    // Also log to console for immediate feedback
    if (type === 'error') {
        console.error(message);
    } else {
        console.log(message);
    }
}

/**
 * Handle Tranzila payment notifications and update subscriptions
 * @route POST /api/tranzila-notify
 */
router.post("/", async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const data = req.body;
    
    // Log notification data
    logToFile(`📩 Tranzila Notification Received: ${JSON.stringify(data)}`);
    
    // Store raw notification in database
    await TranzilaNotification.create({
      data: data,
      processed_at: null,
      status: 'received',
      created_at: new Date()
    }, { transaction });
    
    // Check if payment was successful
    const isSuccessful = data.Response === "000";
    
    // Extract payment information
    const paymentData = {
      student_email: data.email || null,
      student_name: data.studentName || null,
      transaction_id: data.index || null,
      amount: parseFloat(data.sum) || 0,
      currency: data.currency || "ILS",
      contact: data.contact,
      status: isSuccessful ? 'success' : 'failed',
      is_recurring: data.recur === "1",
      plan_id: data.plan_id || null,
      student_id: data.student_id || null,
      lessons_per_month: parseInt(data.lessons_per_month, 10) || null,
      duration_type: parseInt(data.duration_type, 10) || null,
      lesson_minutes: parseInt(data.lesson_minutes, 10) || null,
      payment_method: 'tranzila',
      card_last_digits: data.cardnum ? data.cardnum.slice(-4) : null,
      error_code: !isSuccessful ? data.Response : null,
      error_message: !isSuccessful ? `Payment failed with code: ${data.Response}` : null,
      response_data: data,
      created_at: new Date(),
      updated_at: new Date(),
      token: data.token || crypto.randomBytes(16).toString('hex') // Generate token if not provided
    };
    
    if (!isSuccessful) {
      // Save failed payment transaction
      await PaymentTransaction.create(paymentData, { transaction });
      
      logToFile(`❌ Failed payment notification: ${data.Response}`, 'error');
      
      // Update notification status
      await TranzilaNotification.update(
        { 
          status: 'failed',
          processed_at: new Date(),
          processing_notes: `Payment failed with response code: ${data.Response}`
        },
        { 
          where: { data: data },
          transaction 
        }
      );
      
      await transaction.commit();
      
      return res.status(200).json({ 
        message: "Failed payment notification received", 
        success: false 
      });
    }
    
    // Find or create user
    let user;
    if (paymentData.student_id) {
      // Find existing user
      user = await User.findByPk(paymentData.student_id, { transaction });
      
      if (!user) {
        logToFile(`❌ User not found with ID: ${paymentData.student_id}`, 'error');
        
        // Update notification status
        await TranzilaNotification.update(
          { 
            status: 'error',
            processed_at: new Date(),
            processing_notes: `User not found with ID: ${paymentData.student_id}`
          },
          { 
            where: { data: data },
            transaction 
          }
        );
        
        await transaction.rollback();
        return res.status(200).json({ 
          message: "User not found", 
          success: false 
        });
      }
    } else if (paymentData.student_email) {
      // Find or create user by email
      [user] = await User.findOrCreate({
        where: { email: paymentData.student_email },
        defaults: {
          full_name: paymentData.student_name,
          email: paymentData.student_email,
          role_name: 'user',
          status: 'active',
          created_at: new Date()
        },
        transaction
      });
      
      logToFile(`${user.id ? 'Found' : 'Created'} user with email: ${paymentData.student_email}`);
    } else {
      logToFile("❌ No student ID or email provided", 'error');
      
      // Update notification status
      await TranzilaNotification.update(
        { 
          status: 'error',
          processed_at: new Date(),
          processing_notes: 'No student identification provided'
        },
        { 
          where: { data: data },
          transaction 
        }
      );
      
      await transaction.rollback();
      return res.status(200).json({ 
        message: "No student identification provided", 
        success: false 
      });
    }
    
    // Update payment data with user ID if found/created
    paymentData.student_id = user.id;
    
    // Get plan details if provided
    let plan = null;
    if (paymentData.plan_id) {
      plan = await SubscriptionPlan.findByPk(paymentData.plan_id, {
        include: [
          { model: SubscriptionDuration, as: 'Duration' },
          { model: LessonLength, as: 'LessonLength' },
          { model: LessonsPerMonth, as: 'LessonsPerMonth' }
        ],
        transaction
      });
      
      if (!plan) {
        logToFile(`⚠️ Plan not found with ID: ${paymentData.plan_id}`, 'warn');
        // Continue without plan - we'll use the provided parameters
      } else {
        logToFile(`Found plan: ${plan.name} with ID: ${plan.id}`);
      }
    }
    
    // Get duration if provided
    let duration = null;
    if (paymentData.duration_type) {
      duration = await SubscriptionDuration.findByPk(paymentData.duration_type, { transaction });
      if (!duration) {
        logToFile(`⚠️ Duration not found with ID: ${paymentData.duration_type}`, 'warn');
      } else {
        logToFile(`Found duration: ${duration.name} (${duration.months} months)`);
      }
    }
    
    // Determine subscription parameters
    const lessonMinutes = plan?.LessonLength?.minutes || paymentData.lesson_minutes;
    const lessonsPerMonth = plan?.LessonsPerMonth?.lessons || paymentData.lessons_per_month;
    const durationMonths = plan?.Duration?.months || duration?.months;
    
    if (!lessonMinutes || !lessonsPerMonth || !durationMonths) {
      logToFile("❌ Missing required subscription parameters", 'error');
      
      // Update notification status
      await TranzilaNotification.update(
        { 
          status: 'error',
          processed_at: new Date(),
          processing_notes: 'Incomplete subscription data'
        },
        { 
          where: { data: data },
          transaction 
        }
      );
      
      await transaction.rollback();
      return res.status(200).json({ 
        message: "Incomplete subscription data", 
        success: false 
      });
    }
    
    // Save payment transaction
    const paymentTransaction = await PaymentTransaction.create(paymentData, { transaction });
    logToFile(`Created payment transaction with ID: ${paymentTransaction.id}`);
    
    // Calculate renewal date
    const renewDate = moment().add(durationMonths, 'months').toDate();
    
    // Calculate cost per lesson
    const costPerLesson = paymentData.amount / (lessonsPerMonth * durationMonths);
    
    // Update or create subscription
    // const [subscription, created] = await UserSubscriptionDetails.findOrCreate({
    //   where: { user_id: user.id },
    //   defaults: {
    //     user_id: user.id,
    //     type: paymentData.is_recurring ? 'recurring' : 'one-time',
    //     each_lesson: `${lessonMinutes} min`,
    //     renew_date: renewDate,
    //     how_often: `${lessonsPerMonth} lessons per month`,
    //     weekly_lesson: lessonsPerMonth,
    //     status: 'active',
    //     lesson_min: lessonMinutes,
    //     left_lessons: lessonsPerMonth,
    //     created_at: new Date(),
    //     updated_at: new Date(),
    //     balance: paymentData.amount,
    //     lesson_reset_at: new Date(),
    //     cost_per_lesson: costPerLesson,
    //     is_cancel: 0,
    //     plan_id: paymentData.plan_id
    //   },
    //   transaction
    // });
    
    // // If subscription already exists, update it
    // if (!created) {
    //   const updateData = {
    //     type: paymentData.is_recurring ? 'recurring' : subscription.type,
    //     each_lesson: `${lessonMinutes} min`,
    //     renew_date: renewDate,
    //     how_often: `${lessonsPerMonth} lessons per month`,
    //     weekly_lesson: lessonsPerMonth,
    //     status: 'active',
    //     lesson_min: lessonMinutes,
    //     left_lessons: subscription.left_lessons + lessonsPerMonth,
    //     updated_at: new Date(),
    //     balance: sequelize.literal(`balance + ${paymentData.amount}`),
    //     cost_per_lesson: costPerLesson,
    //     is_cancel: 0,
    //     plan_id: paymentData.plan_id || subscription.plan_id
    //   };
      
    //   await subscription.update(updateData, { transaction });
    //   logToFile(`Updated existing subscription for user: ${user.id}, added ${lessonsPerMonth} lessons`);
    // } else {
    //   logToFile(`Created new subscription for user: ${user.id} with ${lessonsPerMonth} lessons`);
    // }
    
    // Update notification status
    await TranzilaNotification.update(
      { 
        status: 'processed',
        processed_at: new Date(),
        processing_notes: `Successfully processed payment for user ${user.id}, transaction ${paymentData.transaction_id}`
      },
      { 
        where: { data: data },
        transaction 
      }
    );
    
    await transaction.commit();
    
    logToFile(`✅ Payment processed successfully for user: ${user.id}, amount: ${paymentData.amount} ${paymentData.currency}`);
    
    // Return success response
    return res.status(200).json({ 
      message: "Payment processed successfully", 
      success: true 
    });
    
  } catch (error) {
    if (transaction) await transaction.rollback();
    
    logToFile(`❌ Failed to handle Tranzila notification: ${error.message}`, 'error');
    logToFile(error.stack, 'error'); // Log the full stack trace for debugging
    
    // Try to save the error to database without transaction
    try {
      await TranzilaNotification.create({
        data: req.body,
        status: 'error',
        processed_at: new Date(),
        processing_notes: `Error: ${error.message}`,
        created_at: new Date()
      });
    } catch (dbError) {
      logToFile(`Failed to log error to database: ${dbError.message}`, 'error');
    }
    
    return res.status(500).json({ 
      error: "Internal server error",
      message: error.message,
      success: false
    });
  }
});

module.exports = router;