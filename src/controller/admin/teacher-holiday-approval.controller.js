// controllers/teacherHolidayController.js
const TeacherHoliday = require('../../models/teacherHoliday');
const { Op } = require('sequelize');
const User = require('../../models/users');
const Class = require('../../models/classes');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const sequelize = require('../../connection/connection').sequelize;
const moment = require('moment-timezone');

async function getLatestStudentSubscription(userId, transaction) {
  return await UserSubscriptionDetails.findOne({
    where: {
      user_id: userId,
      status:'active'
    },
    order: [['created_at', 'DESC']],
    transaction
  });
}

async function cancelTrialClass(cls, adminId, reason) {
  if (!cls.demo_class_id) {
    console.log('Missing demo_class_id for class:', cls.id);
    return;
  }

  const trial = await TrialClassRegistration.findByPk(cls.demo_class_id);

  if (!trial) {
    console.log('Trial not found:', cls.demo_class_id);
    return;
  }

  if (!['pending', 'confirmed'].includes(trial.status)) {
    console.log('Trial already finalized:', trial.status);
    return;
  }

  await trial.update({
    status: 'cancelled',
    trial_class_status: 'not_relevant',
    cancellation_reason: reason,
    cancelled_by: adminId,
    cancelled_at: new Date()
  });

  console.log('Trial cancelled:', trial.id);
}

const getAllTeacherHolidays = async (req, res) => {
    try {
        const { teacher_id, status, from_date, to_date, timezone } = req.query;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        console.log('req query', req.query);

        const where = {};

        // Filter by teacher
        if (teacher_id) {
            where.user_id = teacher_id;
        }

        // Filter by status (pending/approved/rejected)
        if (status && ['pending', 'approved', 'rejected'].includes(status)) {
            where.status = status;
        } else {
            // Default to pending when status not provided or invalid
            where.status = 'pending';
        }

        // Date range filter (UTC-safe)
        if (from_date && timezone) {
            const adminFrom = moment.tz(from_date, timezone).startOf('day');
            const fromUTC = adminFrom.utc().toDate();

            // CASE 1: Only FROM date selected
            if (!to_date) {
                where.to_date = { [Op.gte]: fromUTC };
            }

            // CASE 2: FROM + TO date selected → overlap logic
            if (to_date) {
                const adminTo = moment.tz(to_date, timezone).endOf('day');
                const toUTC = adminTo.utc().toDate();

                where[Op.and] = [{ form_date: { [Op.lte]: toUTC } }, { to_date: { [Op.gte]: fromUTC } }];
            }
        }

        if (req.query.search) {
            const search = req.query.search.trim();

            // where[Op.or] = [{ title: { [Op.like]: `%${search}%` } }, { reason: { [Op.like]: `%${search}%` } }];

            where[Op.or] = [
                { title: { [Op.like]: `%${search}%` } },
                { reason: { [Op.like]: `%${search}%` } },

                // searching inside user table:
                { '$User.full_name$': { [Op.like]: `%${search}%` } },
                { '$User.email$': { [Op.like]: `%${search}%` } },
                { '$User.mobile$': { [Op.like]: `%${search}%` } }
            ];
        }

        const { rows, count } = await TeacherHoliday.findAndCountAll({
            where,
            limit,
            offset,
            order: [
                [
                    sequelize.literal(
                        "CASE WHEN `teacher_holiday`.`status` = 'pending' THEN 1 WHEN `teacher_holiday`.`status` = 'approved' THEN 2 WHEN `teacher_holiday`.`status` = 'rejected' THEN 3 END"
                    ),
                    'ASC'
                ],
                ['id', 'DESC']
            ],
            include: [
                {
                    model: User,
                    attributes: ['id', 'full_name', 'email', 'mobile'], // only required fields
                    required: false
                }
            ]
        });

        // 🔥 SIMPLE CONFLICT CHECK USING CLASS MODEL ONLY
        const finalData = await Promise.all(
            rows.map(async (holiday) => {
                const hStart = new Date(holiday.form_date);
                const hEnd = new Date(holiday.to_date);

                const conflictingClasses = await Class.findAll({
                    where: {
                        teacher_id: holiday.user_id,
                        is_regular_hide: 0,
                        // Overlap condition
                        meeting_start: { [Op.lt]: hEnd },
                        meeting_end: { [Op.gt]: hStart },

                        // Only active classes
                        status: 'pending'
                    },
                    attributes: ['id', 'meeting_start', 'meeting_end', 'is_trial', 'cancelled_at'],
                    include: [
                        {
                            model: User,
                            as: 'Student',
                            attributes: ['id', 'full_name'],
                            required: false
                        },
                        {
                            model: User,
                            as: 'Teacher',
                            attributes: ['id', 'full_name'],
                            required: false
                        },
                        {
                            model: TrialClassRegistration,
                            as: 'linkedTrialRegistration',
                            attributes: ['student_name'],
                            required: false
                        }
                    ]
                });

                return {
                    ...holiday.toJSON(),
                    is_conflict: conflictingClasses.length > 0,
                    conflicting_classes: conflictingClasses.map((cls) => ({
                        class_id: cls.id,
                        meeting_start: cls.meeting_start,
                        meeting_end: cls.meeting_end,

                        // Trial rule
                        is_trial: Boolean(cls.is_trial) && cls.cancelled_at === null,

                        // student_name: cls.Student?.full_name || null,
                        student_name: cls.is_trial ? cls.linkedTrialRegistration?.student_name || null : cls.Student?.full_name || null,
                        teacher_name: cls.Teacher?.full_name || null
                    }))
                };
            })
        );

        return res.status(200).json({
            success: true,
            total: count,
            totalPages: Math.ceil(count / limit),
            currentPage: page,
            data: finalData
        });
    } catch (error) {
        console.error('Error fetching teacher holidays:', error);
        return res.status(500).json({
            success: false,
            message: 'Something went wrong',
            error: error.message
        });
    }
};

const updateTeacherHolidayStatus = async (req, res) => {
  const transaction = await sequelize.transaction();
  const trialClassesToCancel = [];

  try {
    const { id } = req.params;
    const { action, response, cancelConflictingClasses } = req.body;
    const adminId = req.userId || null;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action'
      });
    }

    const holiday = await TeacherHoliday.findOne({
      where: { id },
      transaction
    });

    if (!holiday) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Holiday not found'
      });
    }

    if (holiday.status !== 'pending') {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Holiday already ${holiday.status}`
      });
    }

    /* -------------------------------
       1️⃣ Update holiday status
    -------------------------------- */
    await holiday.update(
      {
        status: action === 'approve' ? 'approved' : 'rejected',
        response: response || null,
        approver_id: adminId
      },
      { transaction }
    );

    /* -------------------------------
       2️⃣ Handle conflicting classes
    -------------------------------- */
    if (action === 'approve' && cancelConflictingClasses === true) {
      const hStart = holiday.form_date;
      const hEnd = holiday.to_date;

      const conflictingClasses = await Class.findAll({
        where: {
          teacher_id: holiday.user_id,
          meeting_start: { [Op.lt]: hEnd },
          meeting_end: { [Op.gt]: hStart },
          status: 'pending'
        },
        attributes: [
          'id',
          'student_id',
          'is_trial',
          'demo_class_id',
          'meeting_start',
          'meeting_end'
        ],
        transaction
      });

      for (const cls of conflictingClasses) {
        /* ---- Cancel class ---- */
        await cls.update(
          {
            status: 'canceled',
            cancelled_at: new Date(),
            cancelled_by: adminId,
            cancellation_reason: 'Teacher holiday approved'
          },
          { transaction }
        );

        /* ---- Trial class: defer cancellation ---- */
        if (cls.is_trial === true || cls.is_trial === 1) {
          trialClassesToCancel.push(cls);
          continue;
        }

        /* ---- Regular class: restore lesson ---- */
        if (!cls.student_id) continue;

        const student = await User.findByPk(cls.student_id, {
          attributes: ['id'],
          transaction
        });

        if (!student) continue;

        const subscription = await getLatestStudentSubscription(
          student.id,
          transaction
        );

        if (subscription) {
          await subscription.increment(
            { left_lessons: 1 },
            { transaction }
          );
        }
      }
    }

    /* -------------------------------
       3️⃣ Commit ONCE (IMPORTANT)
    -------------------------------- */
    await transaction.commit();

    /* -------------------------------
       4️⃣ Cancel trial classes (OUTSIDE TX)
    -------------------------------- */
    for (const cls of trialClassesToCancel) {
      await cancelTrialClass(
        cls,
        adminId,
        'Teacher holiday approved'
      );
    }

    return res.status(200).json({
      success: true,
      message: `Holiday ${action}d successfully`,
      cancelConflictingClasses: !!cancelConflictingClasses
    });

  } catch (error) {
    if (!transaction.finished) {
      await transaction.rollback();
    }

    console.error('Holiday approval error:', error);

    return res.status(500).json({
      success: false,
      message: 'Something went wrong',
      error: error.message
    });
  }
};

const deleteTeacherHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.userId || null;

    const holiday = await TeacherHoliday.findOne({
      where: { id }
    });

    if (!holiday) {
      return res.status(404).json({
        success: false,
        message: 'Holiday not found'
      });
    }

    // Allow deletion for any status (pending, approved, or rejected)
    await holiday.destroy();

    return res.status(200).json({
      success: true,
      message: 'Holiday deleted successfully'
    });

  } catch (error) {
    console.error('Holiday deletion error:', error);

    return res.status(500).json({
      success: false,
      message: 'Something went wrong',
      error: error.message
    });
  }
};

module.exports = { getAllTeacherHolidays, updateTeacherHolidayStatus, deleteTeacherHoliday };
