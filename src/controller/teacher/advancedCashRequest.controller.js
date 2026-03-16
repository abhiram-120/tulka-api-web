// controller/teacher/advanced-cash.controller.js
const TeacherAdvancedCashRequest = require('../../models/advancedCashRequest');
const { Op, fn, col, literal } = require('sequelize');
const TeacherPayslip = require('../../models/TeacherPaySlip');
const UserReview = require('../../models/userReviews');
const User = require('../../models/users');

const createAdvancedCashRequest = async (req, res) => {
  try {
    const teacher_id = req.user.id;
    const { amount, req_note } = req.body;

    // -------------------------
    // Validations
    // -------------------------
    if (!teacher_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Teacher not authenticated'
      });
    }

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Valid amount is required'
      });
    }

    if (!amount || Number(amount) > 5000) {
      return res.status(400).json({
        status: 'error',
        message: 'Amount Cannot be greater than 5000'
      });
    }

    // -------------------------
    // 1️⃣ 3+ months teaching check
    // -------------------------
    const teacher = await User.findByPk(teacher_id, {
      attributes: ['created_at']
    });

    if (!teacher) {
      return res.status(404).json({
        status: 'error',
        message: 'Teacher not found'
      });
    }

    const createdAtMs = teacher.created_at * 1000;
    const threeMonthsAgo = Date.now() - 1000 * 60 * 60 * 24 * 90;

    if (createdAtMs > threeMonthsAgo) {
      return res.status(403).json({
        status: 'error',
        message: 'You must complete at least 3 months of teaching to request advanced cash'
      });
    }

    // -------------------------
    // 2️⃣ No penalties check
    // -------------------------
    const penaltyExists = await TeacherPayslip.findOne({
      where: {
        teacher_id,
        penalty_amount: {
          [Op.gt]: 0
        }
      },
      attributes: ['id']
    });

    if (penaltyExists) {
      return res.status(403).json({
        status: 'error',
        message: 'Advanced cash request is not allowed due to existing penalties'
      });
    }

    // -------------------------
    // 3️⃣ Rating ≥ 4.5 check
    // -------------------------
    const ratingData = await UserReview.findOne({
      where: {
        instructor_id: teacher_id,
        status: 'active'
      },
      attributes: [
        [fn('AVG', literal('CAST(rates AS DECIMAL(3,2))')), 'avg_rating'],
        [fn('COUNT', col('id')), 'total_reviews']
      ],
      raw: true
    });

    const avgRating = Number(ratingData?.avg_rating || 0);

    if (avgRating < 4.5) {
      return res.status(403).json({
        status: 'error',
        message: 'Minimum 4.5 rating is required to request advanced cash'
      });
    }

    // -------------------------
    // Create request
    // -------------------------
    const request = await TeacherAdvancedCashRequest.create({
      teacher_id,
      amount,
      req_note: req_note || null,
      status: 'pending' // explicit (even though default exists)
    });

    return res.status(201).json({
      status: 'success',
      message: 'Advanced cash request submitted successfully',
      data: request
    });
  } catch (error) {
    console.error('ADVANCED CASH REQUEST ERROR:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to submit advanced cash request'
    });
  }
};

const getTeacherAdvancedCashRequests = async (req, res) => {
  try {
    const teacher_id = req.user.id;

    if (!teacher_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Teacher not authenticated'
      });
    }

    const requests = await TeacherAdvancedCashRequest.findAll({
      where: {
        teacher_id
      },
      attributes: [
        'id',
        ['created_at', 'requested_at'],
        'req_note',
        'status',
        'res_note'
      ],
      order: [['created_at', 'DESC']]
    });

    return res.status(200).json({
      status: 'success',
      data: requests
    });
  } catch (error) {
    console.error('GET ADVANCED CASH REQUESTS ERROR:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch advanced cash requests'
    });
  }
};

module.exports = {
  createAdvancedCashRequest,
  getTeacherAdvancedCashRequests
};
