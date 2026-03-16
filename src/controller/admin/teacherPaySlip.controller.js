const ActivityLog = require('../../models/activityLogs');
const TeacherEarningHistory = require('../../models/teacherEarningHistory');
const TeacherPayslip = require('../../models/TeacherPaySlip');
const TeacherSalaryAdjustment = require('../../models/TeacherSalaryAdjustments');
const TeacherSalaryProfile = require('../../models/teacherSalaryProfile');
const User = require('../../models/users');
const { Op, fn, col, where } = require('sequelize');
const moment = require('moment-timezone');
const CompensationGroup = require('../../models/compensationgroup');
const Class = require('../../models/classes');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const { sequelize } = require('../../connection/connection');

const parseJson = (value, fallback = []) => {
    if (!value) return fallback;

    if (Array.isArray(value)) return value;

    if (typeof value === "string") {
      try {
        let parsed = JSON.parse(value);
        while (typeof parsed === "string") {
          parsed = JSON.parse(parsed);
        }
        return Array.isArray(parsed) ? parsed : fallback;
      } catch {
        return fallback;
      }
    }

    return fallback;
  };

  const normalizeToArray = (value, fallback = []) => {
  if (value == null) return fallback;

  let result = value;
  let safetyCounter = 0;

  while (typeof result === "string" && safetyCounter < 5) {
    try {
      result = JSON.parse(result);
      safetyCounter++;
    } catch {
      return fallback;
    }
  }

  if (Array.isArray(result)) return result;

  if (typeof result === "object" && result !== null) {
    return [result]; // wrap single object into array
  }

  return fallback;
};


function formatPayrollPeriodFromStart(periodStart) {
    if (!periodStart) return null;

    const d = new Date(periodStart);
    if (Number.isNaN(d.getTime())) return null;

    return d.toLocaleString('en-US', {
        month: 'long',
        year: 'numeric'
    });
}

const toPositiveInt = (value) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const createTeacherPayslip = async (req, res) => {
    try {
        const {
            teacher_id,
            salary_profile_id,
            period_start,
            period_end,
            classes = [],
            bonuses = [],
            penalties = [],
            base_salary = 0,
            bonus_amount = 0,
            penalty_amount = 0,
            total_amount = 0
        } = req.body;

        if (!teacher_id || !salary_profile_id || !period_start || !period_end) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields'
            });
        }

        const teacherId = toPositiveInt(teacher_id);
        const salaryProfileId = toPositiveInt(salary_profile_id);
        const startDate = new Date(period_start);
        const endDate = new Date(period_end);
        if (!teacherId || !salaryProfileId) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid teacher_id or salary_profile_id'
            });
        }
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid period_start or period_end'
            });
        }
        if (endDate < startDate) {
            return res.status(400).json({
                status: 'error',
                message: 'period_end cannot be before period_start'
            });
        }

        /* -------------------- UNIQUENESS CHECK -------------------- */
        const existingPayslip = await TeacherPayslip.findOne({
            where: {
                teacher_id: teacherId,
                period_start,
                period_end,
                status: ['draft', 'final'] // ❌ cancelled excluded
            }
        });

        if (existingPayslip) {
            return res.status(409).json({
                status: 'error',
                message: 'Payslip already exists for this teacher and period'
            });
        }

        /* -------------------- CREATE DRAFT PAYSLIP -------------------- */
        const payslip = await TeacherPayslip.create({
            teacher_id: teacherId,
            salary_profile_id: salaryProfileId,
            period_start,
            period_end,

            status: 'draft',

            base_salary,
            bonus_amount,
            penalty_amount,
            total_amount,

            classes,
            bonuses,
            penalties,

            created_by: req.userId
        });

        /* -------------------- ACTIVITY LOG -------------------- */
        await ActivityLog.create({
            entity_type: 'payslip',
            entity_id: payslip.id,
            action_type: 'payslip_created',
            performed_by: req.userId ?? null,

            before_value: null,

            after_value: {
                period_start,
                period_end,
                total_amount,
                status: 'draft'
            },

            action: {
                teacher_id, // ✅ explicitly stored
                salary_profile_id: salaryProfileId,
                message: 'Payslip draft created'
            }
        });

        return res.status(201).json({
            status: 'success',
            data: payslip
        });
    } catch (error) {
        console.error('Create Payslip Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to create payslip'
        });
    }
};

const updateTeacherPayslip = async (req, res) => {
    try {
        const { id } = req.params;
        const payload = { ...req.body };

        const payslip = await TeacherPayslip.findByPk(id);

        if (!payslip) {
            return res.status(404).json({
                status: 'error',
                message: 'Payslip not found'
            });
        }

        /* -------------------- DRAFT-ONLY RULE -------------------- */
        if (payslip.status !== 'draft') {
            return res.status(403).json({
                status: 'error',
                message: 'Only draft payslips can be edited'
            });
        }

        /* -------------------- BEFORE SNAPSHOT -------------------- */
        const beforeSnapshot = {
            classes: payslip.classes,
            bonuses: payslip.bonuses,
            penalties: payslip.penalties,
            base_salary: payslip.base_salary,
            bonus_amount: payslip.bonus_amount,
            penalty_amount: payslip.penalty_amount,
            total_amount: payslip.total_amount
        };

        /* -------------------- UPDATE (SAFE FIELDS ONLY) -------------------- */
        const allowedFields = ['classes', 'bonuses', 'penalties', 'base_salary', 'bonus_amount', 'penalty_amount', 'total_amount'];

        const updateData = {};
        allowedFields.forEach((field) => {
            if (payload[field] !== undefined) {
                updateData[field] = payload[field];
            }
        });

        /* -------------------- RE-CALCULATE TOTAL -------------------- */
        const baseSalary = Number(updateData.base_salary ?? payslip.base_salary ?? 0);

        const bonusAmount = Number(updateData.bonus_amount ?? payslip.bonus_amount ?? 0);

        const penaltyAmount = Number(updateData.penalty_amount ?? payslip.penalty_amount ?? 0);

        const classes = updateData.classes ?? payslip.classes ?? [];

        const classesTotal = Array.isArray(classes) ? classes.reduce((sum, cls) => sum + Number(cls.amount || 0), 0) : 0;

        updateData.total_amount = baseSalary + bonusAmount + classesTotal - penaltyAmount;

        updateData.updated_by = req.userId ?? null;

        await payslip.update(updateData);

        /* -------------------- AFTER SNAPSHOT -------------------- */
        const afterSnapshot = {
            classes: payslip.classes,
            bonuses: payslip.bonuses,
            penalties: payslip.penalties,
            base_salary: payslip.base_salary,
            bonus_amount: payslip.bonus_amount,
            penalty_amount: payslip.penalty_amount,
            total_amount: payslip.total_amount
        };

        /* -------------------- ACTIVITY LOG -------------------- */
        await ActivityLog.create({
            entity_type: 'payslip',
            entity_id: payslip.id,
            action_type: 'payslip_updated',
            performed_by: req.userId ?? null,

            before_value: beforeSnapshot,
            after_value: afterSnapshot,

            action: {
                teacher_id: payslip.teacher_id, // ✅ stored explicitly
                message: 'Draft payslip updated',
                updated_fields: Object.keys(updateData)
            }
        });

        return res.status(200).json({
            status: 'success',
            data: payslip
        });
    } catch (error) {
        console.error('Update Payslip Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update payslip'
        });
    }
};

const finalizeTeacherPayslip = async (req, res) => {
    try {
        const { id } = req.params;
        const { send = false } = req.body; // optional

        const payslip = await TeacherPayslip.findByPk(id);

        if (!payslip) {
            return res.status(404).json({
                status: 'error',
                message: 'Payslip not found'
            });
        }

        /* -------------------- STATUS CHECK -------------------- */
        if (payslip.status !== 'draft') {
            return res.status(403).json({
                status: 'error',
                message: 'Only draft payslips can be finalized'
            });
        }

        /* -------------------- BEFORE SNAPSHOT -------------------- */
        const beforeSnapshot = {
            status: payslip.status,
            total_amount: payslip.total_amount
        };

        /* -------------------- FINALIZE -------------------- */
        const now = new Date();

        await payslip.update({
            status: 'final',
            finalized_at: now,
            sent_at: send ? now : null,
            updated_by: req.userId ?? null
        });

        /* -------------------- ACTIVITY LOG -------------------- */
        await ActivityLog.create({
            entity_type: 'payslip',
            entity_id: payslip.id,
            action_type: send ? 'payslip_finalized_and_sent' : 'payslip_finalized',
            performed_by: req.userId ?? null,

            before_value: beforeSnapshot,

            after_value: {
                status: 'final',
                total_amount: payslip.total_amount,
                finalized_at: payslip.finalized_at,
                sent_at: payslip.sent_at
            },

            action: {
                teacher_id: payslip.teacher_id,
                message: send ? 'Payslip finalized and sent' : 'Payslip finalized'
            }
        });

        return res.status(200).json({
            status: 'success',
            data: payslip
        });
    } catch (error) {
        console.error('Finalize Payslip Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to finalize payslip'
        });
    }
};

const cancelPayslipCloneAndReplace = async (req, res) => {
    try {
        const { id } = req.params;

        const payslip = await TeacherPayslip.findByPk(id);

        if (!payslip) {
            return res.status(404).json({
                status: 'error',
                message: 'Payslip not found'
            });
        }

        /* -------------------- STATUS CHECK -------------------- */
        if (payslip.status !== 'final') {
            return res.status(403).json({
                status: 'error',
                message: 'Only finalized payslips can be cancelled'
            });
        }

        /* -------------------- BEFORE SNAPSHOT -------------------- */
        const beforeSnapshot = {
            status: payslip.status,
            total_amount: payslip.total_amount,
            period_start: payslip.period_start,
            period_end: payslip.period_end
        };

        const now = new Date();

        /* -------------------- CANCEL OLD PAYSLIP -------------------- */
        await payslip.update({
            status: 'cancelled',
            cancelled_at: now,
            updated_by: req.userId ?? null
        });

        /* -------------------- CLONE AS NEW DRAFT -------------------- */
        const clonedPayslip = await TeacherPayslip.create({
            teacher_id: payslip.teacher_id,
            salary_profile_id: payslip.salary_profile_id,
            period_start: payslip.period_start,
            period_end: payslip.period_end,

            status: 'draft',

            base_salary: payslip.base_salary,
            bonus_amount: payslip.bonus_amount,
            penalty_amount: payslip.penalty_amount,
            total_amount: payslip.total_amount,

            classes: payslip.classes,
            bonuses: payslip.bonuses,
            penalties: payslip.penalties,

            created_by: req.userId
        });

        /* -------------------- ACTIVITY LOG (CANCEL) -------------------- */
        await ActivityLog.create({
            entity_type: 'payslip',
            entity_id: payslip.id,
            action_type: 'payslip_cancelled',
            performed_by: req.userId ?? null,

            before_value: beforeSnapshot,

            after_value: {
                status: 'cancelled',
                cancelled_at: now
            },

            action: {
                teacher_id: payslip.teacher_id,
                replaced_by_payslip_id: clonedPayslip.id,
                message: 'Payslip cancelled and replaced'
            }
        });

        /* -------------------- ACTIVITY LOG (CLONE) -------------------- */
        await ActivityLog.create({
            entity_type: 'payslip',
            entity_id: clonedPayslip.id,
            action_type: 'payslip_cloned',
            performed_by: req.userId ?? null,

            before_value: null,

            after_value: {
                status: 'draft',
                total_amount: clonedPayslip.total_amount
            },

            action: {
                teacher_id: clonedPayslip.teacher_id,
                cloned_from_payslip_id: payslip.id,
                message: 'Draft payslip created from cancelled payslip'
            }
        });

        return res.status(200).json({
            status: 'success',
            message: 'Payslip cancelled and replaced with a new draft',
            data: {
                cancelled_payslip_id: payslip.id,
                new_draft_payslip_id: clonedPayslip.id
            }
        });
    } catch (error) {
        console.error('Cancel Payslip Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to cancel payslip'
        });
    }
};

  const getTeacherPayslips = async (req, res) => {
      try {
          const { period_start, period_end, status, teacher_id, salary_mode, compensation_group_id, level_locked, custom, page = 1, limit = 10 } = req.query;
          
  
          if (!period_start) {
              return res.status(400).json({
                  status: 'error',
                  message: 'period_start is required'
              });
          }
  
          const startDate = new Date(period_start);
          if (Number.isNaN(startDate.getTime())) {
              return res.status(400).json({
                  status: 'error',
                  message: 'Invalid period_start'
              });
          }

          let endDate = null;
          if (period_end) {
              endDate = new Date(period_end);
              if (Number.isNaN(endDate.getTime())) {
                  return res.status(400).json({
                      status: 'error',
                      message: 'Invalid period_end'
                  });
              }
          }
  
          const periodLabel = startDate.toLocaleString('en-US', {
              month: 'long',
              year: 'numeric'
          });
  
          const safePage = Math.max(Number(page) || 1, 1);
          const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
          const offset = (safePage - 1) * safeLimit;
  
          const isCustomRange =
              custom === true || custom === "true" || custom === 1 || custom === "1";

          /** Payslip conditions */
          const whereClause = endDate
              ? isCustomRange
                  ? {
                        period_start: { [Op.lte]: endDate },
                        period_end: { [Op.gte]: startDate },
                    }
                  : {
                        period_start: startDate,
                        period_end: endDate,
                    }
              : {
                    [Op.and]: [
                        where(fn('MONTH', col('TeacherPayslip.period_start')), startDate.getMonth() + 1),
                        where(fn('YEAR', col('TeacherPayslip.period_start')), startDate.getFullYear()),
                    ],
                };

        if (status) {
            whereClause.status = status;
        }

        /** Salary profile conditions (FILTER MAGIC 🔥) */
        const salaryProfileWhere = {};

        if (teacher_id) {
            salaryProfileWhere.teacher_id = teacher_id;
        }

        if (salary_mode) {
            salaryProfileWhere.salary_mode = salary_mode;
        }

        if (compensation_group_id) {
            salaryProfileWhere.compensation_group_id = compensation_group_id;
        }

        if (level_locked !== undefined && level_locked !== "") {
        salaryProfileWhere.level_locked =
            level_locked === true ||
            level_locked === "true" ||
            level_locked === 1 ||
            level_locked === "1";
        }

        const { rows, count } = await TeacherPayslip.findAndCountAll({
            where: whereClause,
            order: [['created_at', 'DESC']],
            limit: safeLimit,
            offset,
            include: [
                {
                    model: TeacherSalaryProfile,
                    as: 'salary_profile',
                    where: salaryProfileWhere,
                    required: true, // 👈 CRITICAL: ensures filtering
                    include: [
                        {
                            model: CompensationGroup,
                            as: 'compensation_group',
                            attributes: ['id', 'currency_code']
                        }
                    ]
                },
                {
                    model: User,
                    as: 'teacher',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                }
            ]
        });

        const data = rows.map((row) => {
            const json = row.toJSON();

            if (isCustomRange && endDate) {
                const startDateStr = new Date(period_start)
                    .toISOString()
                    .slice(0, 10);
                const endDateStr = new Date(period_end)
                    .toISOString()
                    .slice(0, 10);

                const isDateStrInRange = (dateStr) => {
                    if (!dateStr) return false;
                    return dateStr >= startDateStr && dateStr <= endDateStr;
                };

                const stats = parseJson(json.classes_stats, []);
                const filteredStats = Array.isArray(stats)
                    ? stats.filter((entry) => {
                          const dateStr = entry?.date;
                          if (!dateStr) return false;
                          return isDateStrInRange(dateStr);
                      })
                    : [];

                const classTotals = {};
                filteredStats.forEach((entry) => {
                    const list = Array.isArray(entry?.classes) ? entry.classes : [];
                    list.forEach((cls) => {
                        const key = cls?.type;
                        if (!key) return;
                        if (!classTotals[key]) {
                            classTotals[key] = { type: key, count: 0, amount: 0 };
                        }
                        classTotals[key].count += Number(cls?.count || 0);
                        classTotals[key].amount += Number(cls?.amount || 0);
                    });
                });

                json.classes = Object.values(classTotals);

                const isDateInRange = (value) => {
                    if (!value) return false;
                    const dateStr = new Date(value).toISOString().slice(0, 10);
                    return isDateStrInRange(dateStr);
                };

                const bonuses = parseJson(json.bonuses, []);
                const penalties = parseJson(json.penalties, []);

                const filteredBonuses = Array.isArray(bonuses)
                    ? bonuses.filter((b) => {
                          if (b?.added_at) return isDateInRange(b.added_at);
                          return true;
                      })
                    : [];

                const filteredPenalties = Array.isArray(penalties)
                    ? penalties.filter((p) => {
                          if (p?.added_at) return isDateInRange(p.added_at);
                          if (p?.penalty_month) {
                              const monthDateStr = `${p.penalty_month}-01`;
                              return isDateStrInRange(monthDateStr);
                          }
                          return true;
                      })
                    : [];

                const classAmountTotal = Object.values(classTotals).reduce(
                    (sum, c) => sum + Number(c.amount || 0),
                    0
                );
                const bonusAmountTotal = filteredBonuses.reduce(
                    (sum, b) => sum + Number(b.amount || 0),
                    0
                );
                const penaltyAmountTotal = filteredPenalties.reduce(
                    (sum, p) => sum + Number(p.amount || 0),
                    0
                );
                const baseSalary = Number(json.base_salary || 0);

                json.bonuses = filteredBonuses;
                json.penalties = filteredPenalties;
                json.bonus_amount = bonusAmountTotal;
                json.penalty_amount = penaltyAmountTotal;
                json.total_amount =
                    classAmountTotal + baseSalary + bonusAmountTotal - penaltyAmountTotal;
            }

            return {
                ...json,
                period: periodLabel,
                currency_code:
                    json.salary_profile?.compensation_group?.currency_code || "USD"
            };
        });

        return res.status(200).json({
            status: 'success',
            data,
            meta: {
                total: count,
                page: safePage,
                limit: safeLimit,
                total_pages: Math.ceil(count / safeLimit),
                period: formatPayrollPeriodFromStart(period_start)
            }
        });
    } catch (error) {
        console.error('Get Teacher Payslips Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch payslips'
        });
    }
};

const addPenaltyToPayslip = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;
    const { penalty_type, amount, description, penalty_month } = req.body;

    if (!penalty_type || !amount) {
      await transaction.rollback();
      return res.status(400).json({
        status: "error",
        message: "Penalty type and amount are required",
      });
    }

    const payslip = await TeacherPayslip.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE, // 🔒 CRITICAL
    });

    if (!payslip) {
      await transaction.rollback();
      return res.status(404).json({
        status: "error",
        message: "Payslip not found",
      });
    }

    /* -------------------- DRAFT ONLY -------------------- */
    if (payslip.status !== "draft") {
      await transaction.rollback();
      return res.status(400).json({
        status: "error",
        message: "Cannot add penalty to finalized payslip",
      });
    }

    const penaltyAmount = Number(amount);
    if (Number.isNaN(penaltyAmount) || penaltyAmount <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        status: "error",
        message: "Penalty amount must be a positive number",
      });
    }

    /* -------------------- SAFE PARSE -------------------- */
    const existingPenalties = Array.isArray(payslip.penalties)
      ? payslip.penalties
      : typeof payslip.penalties === "string"
      ? JSON.parse(payslip.penalties || "[]")
      : [];

    /* -------------------- NEW PENALTY -------------------- */
    const newPenalty = {
      penalty_type,
      amount: penaltyAmount,
      description: description || null,
      penalty_month: penalty_month || payslip.period_start,
      added_by: req.userId ?? null,
      added_at: new Date(),
    };

    /* -------------------- ADJUSTMENT TABLE -------------------- */
    await TeacherSalaryAdjustment.create(
      {
        teacher_id: payslip.teacher_id,
        type: "penalty",
        applied_date: penalty_month || payslip.period_start,
        value: newPenalty,
      },
      { transaction }
    );

    const updatedPenalties = [...existingPenalties, newPenalty];

    /* -------------------- AMOUNT CALC -------------------- */
    const updatedPenaltyAmount = updatedPenalties.reduce(
      (sum, p) => sum + Number(p.amount || 0),
      0
    );

    const updatedTotalAmount =
      Number(payslip.total_amount || 0) - penaltyAmount;

    /* -------------------- UPDATE PAYSLIP -------------------- */
    await payslip.update(
      {
        penalties: updatedPenalties, // ❌ no stringify
        penalty_amount: updatedPenaltyAmount,
        total_amount: updatedTotalAmount,
        updated_by: req.userId ?? null,
      },
      { transaction }
    );

    /* -------------------- EARNING HISTORY -------------------- */
    const earningDate = moment().utc().format("YYYY-MM-DD");
    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

    const [earningHistory] = await TeacherEarningHistory.findOrCreate({
      where: {
        teacher_id: payslip.teacher_id,
        earning_date: earningDate,
      },
      defaults: {
        teacher_id: payslip.teacher_id,
        earning_date: earningDate,
        base_rate: 0,
        bonus_amount: 0,
        penalty_amount: 0,
        total_amount: 0,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    await earningHistory.update(
      {
        penalty_amount: round2(
          Number(earningHistory.penalty_amount || 0) + penaltyAmount
        ),
        total_amount: round2(
          Number(earningHistory.total_amount || 0) - penaltyAmount
        ),
      },
      { transaction, silent: true }
    );

    /* -------------------- ACTIVITY LOG -------------------- */
    await ActivityLog.create(
      {
        entity_type: "payslip",
        entity_id: payslip.id,
        action_type: "payslip_penalty_added",
        performed_by: req.userId ?? null,
        before_value: {
          penalties: existingPenalties,
          penalty_amount: Number(payslip.penalty_amount || 0),
          total_amount: Number(payslip.total_amount || 0),
        },
        after_value: {
          penalties: updatedPenalties,
          penalty_amount: updatedPenaltyAmount,
          total_amount: updatedTotalAmount,
        },
        action: {
          teacher_id: payslip.teacher_id,
          penalty: newPenalty,
          message: "Penalty added to payslip",
        },
      },
      { transaction }
    );

    await transaction.commit();

    return res.status(200).json({
      status: "success",
      message: "Penalty added to payslip",
      data: newPenalty,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Add Payslip Penalty Error:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to add penalty to payslip",
    });
  }
};

const addBonusToPayslip = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;
    const { bonus_type, amount, description } = req.body;

    if (!bonus_type || !amount) {
      await transaction.rollback();
      return res.status(400).json({
        status: "error",
        message: "Bonus type and amount are required",
      });
    }

    const payslip = await TeacherPayslip.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE, // 🔒 IMPORTANT
    });

    if (!payslip) {
      await transaction.rollback();
      return res.status(404).json({
        status: "error",
        message: "Payslip not found",
      });
    }

    /* -------------------- DRAFT ONLY -------------------- */
    if (payslip.status !== "draft") {
      await transaction.rollback();
      return res.status(400).json({
        status: "error",
        message: "Cannot add bonus to finalized payslip",
      });
    }

    const bonusAmount = Number(amount);
    if (Number.isNaN(bonusAmount) || bonusAmount <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        status: "error",
        message: "Bonus amount must be a positive number",
      });
    }

    /* -------------------- SAFE PARSE -------------------- */
    const existingBonuses = Array.isArray(payslip.bonuses)
      ? payslip.bonuses
      : typeof payslip.bonuses === "string"
      ? JSON.parse(payslip.bonuses || "[]")
      : [];

    /* -------------------- NEW BONUS -------------------- */
    const newBonus = {
      bonus_type,
      amount: bonusAmount,
      description: description || null,
      added_by: req.userId ?? null,
      added_at: new Date(),
    };

    /* -------------------- SALARY ADJUSTMENT -------------------- */
    await TeacherSalaryAdjustment.create(
      {
        teacher_id: payslip.teacher_id,
        type: "bonus",
        applied_date: payslip.period_start,
        value: newBonus,
      },
      { transaction }
    );

    const updatedBonuses = [...existingBonuses, newBonus];

    const updatedBonusAmount = updatedBonuses.reduce(
      (sum, b) => sum + Number(b.amount || 0),
      0
    );

    const updatedTotalAmount =
      Number(payslip.total_amount || 0) + bonusAmount;

    /* -------------------- UPDATE PAYSLIP -------------------- */
    await payslip.update(
      {
        bonuses: updatedBonuses, // ❌ no stringify
        bonus_amount: updatedBonusAmount,
        total_amount: updatedTotalAmount,
        updated_by: req.userId ?? null,
      },
      { transaction }
    );

    /* -------------------- EARNING HISTORY -------------------- */
    const earningDate = moment().utc().format("YYYY-MM-DD");
    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

    const [earningHistory] = await TeacherEarningHistory.findOrCreate({
      where: {
        teacher_id: payslip.teacher_id,
        earning_date: earningDate,
      },
      defaults: {
        teacher_id: payslip.teacher_id,
        earning_date: earningDate,
        base_rate: 0,
        bonus_amount: 0,
        penalty_amount: 0,
        total_amount: 0,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    await earningHistory.update(
      {
        bonus_amount: round2(
          Number(earningHistory.bonus_amount || 0) + bonusAmount
        ),
        total_amount: round2(
          Number(earningHistory.total_amount || 0) + bonusAmount
        ),
      },
      { transaction, silent: true }
    );

    /* -------------------- ACTIVITY LOG -------------------- */
    await ActivityLog.create(
      {
        entity_type: "payslip",
        entity_id: payslip.id,
        action_type: "payslip_bonus_added",
        performed_by: req.userId ?? null,
        before_value: {
          bonuses: existingBonuses,
          bonus_amount: Number(payslip.bonus_amount || 0),
          total_amount: Number(payslip.total_amount || 0),
        },
        after_value: {
          bonuses: updatedBonuses,
          bonus_amount: updatedBonusAmount,
          total_amount: updatedTotalAmount,
        },
        action: {
          teacher_id: payslip.teacher_id,
          bonus: newBonus,
          message: "Bonus added to payslip",
        },
      },
      { transaction }
    );

    await transaction.commit();

    return res.status(200).json({
      status: "success",
      message: "Bonus added to payslip",
      data: newBonus,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Add Payslip Bonus Error:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to add bonus to payslip",
    });
  }
};

const getPayslipClassesForPenalty = async (req, res) => {
    try {
        const { payslip_id } = req.params;
        const payslip = await TeacherPayslip.findByPk(payslip_id);

        if (!payslip) {
            return res.status(404).json({
                status: "error",
                message: "Payslip not found",
            });
        }

        const teacherId = payslip.teacher_id;

        /* --------------------------------------------------
           PERIOD CALCULATION
        -------------------------------------------------- */
        let startDate = moment(payslip.period_start).startOf("day").toDate();
        let endDate = moment(payslip.period_end).endOf("day").toDate();

        if (payslip.period_type === "FIRST_HALF") {
            startDate = moment(payslip.period_start).startOf("month").toDate();
            endDate = moment(payslip.period_start).date(15).endOf("day").toDate();
        }

        if (payslip.period_type === "SECOND_HALF") {
            startDate = moment(payslip.period_start).date(16).startOf("day").toDate();
            endDate = moment(payslip.period_start).endOf("month").endOf("day").toDate();
        }

        /* --------------------------------------------------
           1️⃣ FETCH EARNING HISTORY (SOURCE OF TRUTH)
        -------------------------------------------------- */
        const earningRows = await TeacherEarningHistory.findAll({
            where: {
                teacher_id: teacherId,
                earning_date: {
                    [Op.between]: [
                        moment(startDate).format("YYYY-MM-DD"),
                        moment(endDate).format("YYYY-MM-DD"),
                    ],
                },
            },
            attributes: ["earning_date", "classes"],
            order: [["earning_date", "ASC"]],
            raw: true,
        });

        /* --------------------------------------------------
       2️⃣ COLLECT CLASS IDS (FIXED)
    -------------------------------------------------- */
        const regularClassIds = new Set();
        const trialClassIds = new Set();

        for (const row of earningRows) {
            if (!row.classes) continue;

            let parsed;
            try {
                parsed =
                    typeof row.classes === "string"
                        ? JSON.parse(row.classes)
                        : row.classes;
            } catch {
                continue;
            }

            // ✅ NEW FORMAT
            if (Array.isArray(parsed.regular_class_ids)) {
                parsed.regular_class_ids.forEach((id) =>
                    regularClassIds.add(Number(id))
                );
            }

            if (Array.isArray(parsed.trial_class_ids)) {
                parsed.trial_class_ids.forEach((id) =>
                    trialClassIds.add(Number(id))
                );
            }

            // 🔁 BACKWARD COMPAT (if exists)
            if (Array.isArray(parsed.regular)) {
                parsed.regular.forEach((id) => regularClassIds.add(Number(id)));
            }

            if (Array.isArray(parsed.trial)) {
                parsed.trial.forEach((id) => trialClassIds.add(Number(id)));
            }
        }

        /* --------------------------------------------------
           3️⃣ FETCH REGULAR CLASSES
        -------------------------------------------------- */
        const regularClasses = await Class.findAll({
            where: {
                id: { [Op.in]: [...regularClassIds] },
            },
            attributes: [
                "id",
                "meeting_start",
                "meeting_end",
                "status",
                "demo_class_id",
            ],
            include: [
                {
                    model: User,
                    as: "Student",
                    attributes: ["full_name", "email", "mobile", "country_code"],
                    required: false,
                },
            ],
            order: [["meeting_start", "ASC"]],
        });

        const trialWrapperClasses = await Class.findAll({
            where: {
                id: { [Op.in]: [...trialClassIds] }, // 👈 important
            },
            attributes: [
                "id",
                "meeting_start",
                "meeting_end",
                "status",
                "demo_class_id",
            ],
            order: [["meeting_start", "ASC"]],
            raw: true,
        });


        /* --------------------------------------------------
           4️⃣ FETCH TRIAL CLASSES (via demo_class_id)
        -------------------------------------------------- */
        const demoClassIds = trialWrapperClasses
            .map((c) => c.demo_class_id)
            .filter(Boolean);




        const trialClasses = await TrialClassRegistration.findAll({
            where: {
                id: { [Op.in]: demoClassIds },
            },
            attributes: [
                "id",
                "meeting_start",
                "meeting_end",
                "student_name",
                "mobile",
                "email",
                "status",
            ],
            order: [["meeting_start", "ASC"]],
            raw: true,
        });


        /* --------------------------------------------------
           RESPONSE
        -------------------------------------------------- */
        return res.status(200).json({
            status: "success",
            data: {
                payslip_id: payslip.id,
                period_type: payslip.period_type,
                period: {
                    start: startDate,
                    end: endDate,
                },
                counts: {
                    regular: regularClasses.length,
                    trial: trialClasses.length,
                },
                regular_classes: regularClasses,
                trial_classes: trialClasses,
            },
        });
    } catch (error) {
        console.error("Get Payslip Classes Error:", error);
        return res.status(500).json({
            status: "error",
            message: "Failed to fetch classes for payslip",
        });
    }
};

const addClassPenaltyToPayslip = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;

    const {
      penalty_type,
      description,
      penalty_month,
      unit_amount,
      regular_class_ids = [],
      trial_class_ids = []
    } = req.body;

    if (!penalty_type || !String(penalty_type).trim()) {
      await transaction.rollback();
      return res.status(400).json({
        status: "error",
        message: "penalty_type is required"
      });
    }
    if (!Array.isArray(regular_class_ids) || !Array.isArray(trial_class_ids)) {
      await transaction.rollback();
      return res.status(400).json({
        status: "error",
        message: "regular_class_ids and trial_class_ids must be arrays"
      });
    }
    const unitAmountNum = Number(unit_amount);
    if (!Number.isFinite(unitAmountNum) || unitAmountNum <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        status: "error",
        message: "unit_amount must be a positive number"
      });
    }

    const payslip = await TeacherPayslip.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE // 🔒 CRITICAL
    });

    if (!payslip) {
      await transaction.rollback();
      return res.status(404).json({
        status: "error",
        message: "Payslip not found"
      });
    }

    const totalClasses =
      regular_class_ids.length + trial_class_ids.length;

    if (totalClasses === 0) {
      await transaction.rollback();
      return res.status(400).json({
        status: "error",
        message: "No classes selected"
      });
    }

    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

    const amount = unitAmountNum * totalClasses;

    const penalties = normalizeToArray(payslip.penalties);

    penalties.push({
      penalty_type,
      description,
      unit_amount: unitAmountNum,
      amount,
      penalty_month,
      regular_class_ids,
      trial_class_ids,
      added_by: req.user.id,
      added_at: new Date()
    });

    const newPenaltyAmount =
      Number(payslip.penalty_amount || 0) + amount;

    /* -------------------- ADJUSTMENT TABLE -------------------- */
    await TeacherSalaryAdjustment.create(
      {
        teacher_id: payslip.teacher_id,
        type: "penalty",
        applied_date: new Date(),
        value: {
          penalty_type,
          amount: unitAmountNum,
          description,
          penalty_month,
          regular_class_ids,
          trial_class_ids,
          added_by: req.user.id,
          added_at: new Date()
        }
      },
      { transaction }
    );

    await payslip.update(
      {
        penalties:JSON.stringify(penalties),
        penalty_amount: newPenaltyAmount,
        total_amount:
          Number(payslip.total_amount || 0) - amount
      },
      { transaction }
    );

    /* -------------------- EARNING HISTORY (PER CLASS DATE) -------------------- */
    const dateCountMap = {};

    if (regular_class_ids.length) {
      const regularClasses = await Class.findAll({
        where: { id: { [Op.in]: regular_class_ids } },
        attributes: ["id", "meeting_start"],
        transaction
      });

      regularClasses.forEach((cls) => {
        if (!cls.meeting_start) return;
        const dateKey = moment
          .utc(cls.meeting_start)
          .format("YYYY-MM-DD");
        dateCountMap[dateKey] = (dateCountMap[dateKey] || 0) + 1;
      });
    }

    if (trial_class_ids.length) {
      // 🔥 DIRECTLY fetch from TrialClassRegistration (NO Class table, NO demo_class_id)
      const trialClasses = await TrialClassRegistration.findAll({
        where: { id: { [Op.in]: trial_class_ids } },
        attributes: ["id", "meeting_start"],
        transaction,
        raw: true
      });

      trialClasses.forEach((trial) => {
        if (!trial.meeting_start) return;

        const dateKey = moment
          .utc(trial.meeting_start)
          .format("YYYY-MM-DD");

        dateCountMap[dateKey] = (dateCountMap[dateKey] || 0) + 1;
      });
    }


    const dateEntries = Object.entries(dateCountMap);
    for (const [earningDate, classCount] of dateEntries) {
      const penaltyAmountForDate =
        unitAmountNum * Number(classCount || 0);

      if (!penaltyAmountForDate) continue;

      const [earningHistory] = await TeacherEarningHistory.findOrCreate({
        where: {
          teacher_id: payslip.teacher_id,
          earning_date: earningDate
        },
        defaults: {
          teacher_id: payslip.teacher_id,
          earning_date: earningDate,
          base_rate: 0,
          bonus_amount: 0,
          penalty_amount: 0,
          total_amount: 0
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });

      await earningHistory.update(
        {
          penalty_amount: round2(
            Number(earningHistory.penalty_amount || 0) + penaltyAmountForDate
          ),
          total_amount: round2(
            Number(earningHistory.total_amount || 0) - penaltyAmountForDate
          )
        },
        { transaction, silent: true }
      );
    }

    await transaction.commit();

    return res.json({
      status: "success",
      message: "Penalty added successfully",
      data: penalties.at(-1)
    });
  } catch (e) {
    await transaction.rollback();
    console.error(e);
    res.status(500).json({
      status: "error",
      message: "Failed to add penalty"
    });
  }
};



module.exports = { createTeacherPayslip, updateTeacherPayslip, finalizeTeacherPayslip, cancelPayslipCloneAndReplace, getTeacherPayslips, addPenaltyToPayslip, addBonusToPayslip, getPayslipClassesForPenalty,addClassPenaltyToPayslip };
