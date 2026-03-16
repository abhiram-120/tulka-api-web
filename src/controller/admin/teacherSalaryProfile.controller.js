const ActivityLog = require('../../models/activityLogs');
const CompensationGroup = require('../../models/compensationgroup');
const TeacherSalaryProfile = require('../../models/teacherSalaryProfile');
const User = require('../../models/users');
const { Op, fn, col, literal } = require('sequelize');
const moment = require('moment');
const Class = require('../../models/classes');
const TeacherPayslip = require('../../models/TeacherPaySlip');
const { sequelize } = require('../../connection/connection');
const { calculateRetentionRate } = require('../../helper/calculateRetention');

const parseJsonArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return [];
        }
    }
    return [];
};

const toPositiveInt = (value) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

function formatClassesForCSV(classes) {
    let parsed = classes;

    // Step 1: Parse string safely (handle double-stringified JSON)
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
            if (typeof parsed === 'string') {
                parsed = JSON.parse(parsed);
            }
        } catch {
            return '';
        }
    }

    // Step 2: Normalize to array
    if (!Array.isArray(parsed)) {
        parsed = [parsed];
    }

    if (!parsed.length) return '';

    // Step 3: Format nicely
    return parsed
        .filter((c) => c && c.type)
        .map((c) => `${String(c.type).replace('_', ' ')} * ${Number(c.count || 0)} (${Number(c.amount || 0).toFixed(2)})`)
        .join(' | ');
}
/* ---------------- CREATE ---------------- */
const createTeacherSalaryProfile = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const {
            teacher_id,
            salary_mode,
            manual_start_date,
            manual_end_date,
            manual_hourly_rate,
            compensation_group_id,
            current_group,
            current_level,
            eligible_level,
            level_locked,
            bonus,
            penalty,
            total_amount
        } = req.body;

        const teacherId = toPositiveInt(teacher_id);
        const compGroupId = toPositiveInt(compensation_group_id);
        const normalizedSalaryMode =
            salary_mode === 'manual' ? 'manual' : 'auto';
        const manualRate =
            manual_hourly_rate == null || manual_hourly_rate === ''
                ? null
                : Number(manual_hourly_rate);

        if (!teacherId || !compGroupId || !current_group || !current_level) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields'
            });
        }

        if (
            manualRate != null &&
            (!Number.isFinite(manualRate) || manualRate < 0)
        ) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'manual_hourly_rate must be a valid non-negative number'
            });
        }

        // -------------------- MANUAL DATE VALIDATION --------------------
        if (normalizedSalaryMode === 'manual') {
            if (!manual_start_date || !manual_end_date) {
                await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Manual start date and end date are required'
                });
            }

            const startDate = moment(manual_start_date, 'YYYY-MM-DD', true);
            const endDate = moment(manual_end_date, 'YYYY-MM-DD', true);

            // invalid date format
            if (!startDate.isValid() || !endDate.isValid()) {
                await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid manual date format'
                });
            }

            // end date before start date
            if (endDate.isBefore(startDate)) {
                await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Manual end date cannot be before start date'
                });
            }
        }

        const existingProfile = await TeacherSalaryProfile.findOne({
            where: { teacher_id: teacherId },
            transaction
        });

        if (existingProfile) {
            await transaction.rollback();
            return res.status(409).json({
                status: 'error',
                message: 'Salary profile already exists for this teacher'
            });
        }

        /* -------------------- RESOLVE PAY CYCLE FROM COMP GROUP -------------------- */
        const compensationGroup = await CompensationGroup.findByPk(
            compGroupId,
            { transaction }
        );
        if (!compensationGroup) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Compensation group not found'
            });
        }

        const resolvedPayCycle =
            compensationGroup?.pay_cycle === 'half_monthly'
                ? 'half_monthly'
                : 'monthly';

        /* -------------------- CREATE SALARY PROFILE -------------------- */
        const profile = await TeacherSalaryProfile.create(
            {
                teacher_id: teacherId,
                salary_mode: normalizedSalaryMode,
                pay_cycle: resolvedPayCycle,
                manual_start_date,
                manual_end_date,
                manual_hourly_rate: manualRate,
                compensation_group_id: compGroupId,
                current_group,
                current_level,
                eligible_level,
                level_locked: level_locked ?? false,
                bonus: bonus ?? 0,
                penalty: penalty ?? 0,
                total_amount: total_amount ?? 0
            },
            { transaction }
        );

        /* -------------------- CREATE INITIAL DRAFT PAYSLIP -------------------- */
        const now = moment.utc();
        const day = now.date();
        let period_start;
        let period_end;
        let period_type;

        if (resolvedPayCycle === 'half_monthly') {
            if (day <= 15) {
                period_start = now.clone().startOf('month').format('YYYY-MM-DD');
                period_end = now.clone().date(15).endOf('day').format('YYYY-MM-DD');
                period_type = 'FIRST_HALF';
            } else {
                period_start = now.clone().date(16).startOf('day').format('YYYY-MM-DD');
                period_end = now.clone().endOf('month').format('YYYY-MM-DD');
                period_type = 'SECOND_HALF';
            }
        } else {
            period_start = now.clone().startOf('month').format('YYYY-MM-DD');
            period_end = now.clone().endOf('month').format('YYYY-MM-DD');
            period_type = 'FULL';
        }

        await TeacherPayslip.create(
            {
                teacher_id: profile.teacher_id,
                salary_profile_id: profile.id,
                period_start,
                period_end,
                period_type,
                status: 'draft',
                base_salary: 0,
                bonus_amount: 0,
                penalty_amount: 0,
                total_amount: 0,
                classes: [],
                bonuses: [],
                penalties: [],
                created_by: req.userId || 1
            },
            { transaction }
        );

        /* -------------------- ACTIVITY LOG -------------------- */
        await ActivityLog.create(
            {
                entity_type: 'salary',
                entity_id: profile.id,
                action_type: 'teacher_salary_profile_created',
                performed_by: req.userId || 1,
                before_value: null,
                after_value: {
                    salary_mode: profile.salary_mode,
                    compensation_group_id: profile.compensation_group_id,
                    current_group: profile.current_group,
                    current_level: profile.current_level,
                    eligible_level: profile.eligible_level,
                    level_locked: profile.level_locked
                },
                action: {
                    teacher_id: profile.teacher_id,
                    message: 'Teacher salary profile created'
                }
            },
            { transaction }
        );

        await transaction.commit();

        return res.status(201).json({
            status: 'success',
            data: profile
        });
    } catch (error) {
        await transaction.rollback();
        console.error('Create Teacher Salary Profile Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to create salary profile'
        });
    }
};

/* ---------------- GET ALL ---------------- */
const getTeacherSalaryProfiles = async (req, res) => {
    const { teacher_id, salary_mode, compensation_group_id, level_locked } = req.query;

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    try {
        /** 🔎 Build WHERE dynamically */
        const whereClause = {};

        if (teacher_id) {
            const parsedTeacherId = toPositiveInt(teacher_id);
            if (!parsedTeacherId) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid teacher_id'
                });
            }
            whereClause.teacher_id = parsedTeacherId;
        }

        if (salary_mode) {
            whereClause.salary_mode = salary_mode;
        }

        if (compensation_group_id) {
            const parsedCompGroupId = toPositiveInt(compensation_group_id);
            if (!parsedCompGroupId) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid compensation_group_id'
                });
            }
            whereClause.compensation_group_id = parsedCompGroupId;
        }

        if (level_locked === 'true') {
            whereClause.level_locked = true;
        } else if (level_locked === 'false') {
            whereClause.level_locked = false;
        }

        const rows = await TeacherSalaryProfile.findAll({
            where: whereClause,
            order: [['created_at', 'DESC']],
            limit,
            offset,
            include: [
                {
                    model: User,
                    as: 'teacher',
                    required: false,
                    attributes: ['id', 'full_name', 'email', 'mobile', 'avatar', 'status', 'role_name']
                }
            ]
        });

        /* ----------------------------------
       2️⃣ Fetch TOTAL count (NO pagination)
    ----------------------------------- */
        const total = await TeacherSalaryProfile.count({
            where: whereClause
        });

        return res.status(200).json({
            status: 'success',
            data: rows,
            meta: {
                total: total,
                page,
                limit,
                total_pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get Teacher Salary Profiles Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch salary profiles'
        });
    }
};

/* ---------------- GET ONE ---------------- */
const getTeacherSalaryProfileById = async (req, res) => {
    try {
        const { id } = req.params;

        const profile = await TeacherSalaryProfile.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'teacher',
                    required: false,
                    attributes: ['id', 'full_name', 'email', 'mobile']
                }
            ]
        });

        if (!profile) {
            return res.status(404).json({
                status: 'error',
                message: 'Salary profile not found'
            });
        }

        const profileData = profile.toJSON();
        const teacher = profileData.teacher;

        if (teacher) {
            profileData.teacher = {
                id: teacher.id,
                name: teacher.full_name || '',
                full_name: teacher.full_name || '',
                email: teacher.email || '',
                mobile: teacher.mobile || ''
            };
        }

        return res.status(200).json({
            status: 'success',
            data: profileData
        });
    } catch (error) {
        console.error('Get Teacher Salary Profile Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch salary profile'
        });
    }
};

/* ---------------- UPDATE ---------------- */
const updateTeacherSalaryProfile = async (req, res) => {
    const transaction = await sequelize.transaction();

      try {
          const { id } = req.params;
          const allowedFields = [
              'salary_mode',
              'manual_start_date',
              'manual_end_date',
              'manual_hourly_rate',
              'compensation_group_id',
              'current_group',
              'current_level',
              'eligible_level',
              'level_locked',
              'bonus',
              'penalty',
              'total_amount'
          ];
          const payload = {};
          allowedFields.forEach((field) => {
              if (req.body[field] !== undefined) payload[field] = req.body[field];
          });

          if (!Object.keys(payload).length) {
              await transaction.rollback();
              return res.status(400).json({
                  status: 'error',
                  message: 'No valid fields to update'
              });
          }

          const profile = await TeacherSalaryProfile.findByPk(id, { transaction });
          if (!profile) {
              await transaction.rollback();
              return res.status(404).json({ status: 'error', message: 'Salary profile not found' });
          }

          const isCompGroupUpdateBlocked = new Date().getUTCDate() > 15;
          if (payload.compensation_group_id !== undefined) {
              const parsedCompGroupId = toPositiveInt(payload.compensation_group_id);
              if (!parsedCompGroupId) {
                  await transaction.rollback();
                  return res.status(400).json({
                      status: 'error',
                      message: 'Invalid compensation_group_id'
                  });
              }
              payload.compensation_group_id = parsedCompGroupId;
          }
          const isCompGroupChanging =
              payload.compensation_group_id &&
              String(payload.compensation_group_id) !== String(profile.compensation_group_id);

          if (isCompGroupChanging && isCompGroupUpdateBlocked) {
              await transaction.rollback();
              return res.status(400).json({
                  status: 'error',
                  message: 'Compensation group cannot be updated after the 15th of the month'
              });
          }

          /* -------------------- MANUAL DATE VALIDATION -------------------- */
          const effectiveSalaryMode = payload.salary_mode ?? profile.salary_mode;

        if (effectiveSalaryMode === 'manual') {
            const start = payload.manual_start_date ?? profile.manual_start_date;
            const end = payload.manual_end_date ?? profile.manual_end_date;

            if (!start || !end) {
                await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Manual start date and end date are required'
                });
            }

            const startDate = moment(start, 'YYYY-MM-DD', true);
            const endDate = moment(end, 'YYYY-MM-DD', true);

            if (!startDate.isValid() || !endDate.isValid()) {
                await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid manual date format'
                });
            }

            if (endDate.isBefore(startDate)) {
                await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Manual end date cannot be before start date'
                });
            }

            // Optional: normalize stored values
            payload.manual_start_date = startDate.format('YYYY-MM-DD');
            payload.manual_end_date = endDate.format('YYYY-MM-DD');
        }

        /* -------------------- PENALTY NORMALIZATION -------------------- */
        let newPenalties = [];

        if (payload.penalty) {
            newPenalties = parseJsonArray(payload.penalty);

            const existing = parseJsonArray(profile.penalty) || [];
            payload.penalty = [...(Array.isArray(existing) ? existing : []), ...newPenalties];
        }

        /* -------------------- PAY CYCLE SYNC ON GROUP CHANGE -------------------- */
        if (
            payload.compensation_group_id &&
            String(payload.compensation_group_id) !== String(profile.compensation_group_id)
        ) {
            payload.eligible_level = null;
            const previousPayCycle = profile.pay_cycle === 'half_monthly'
                ? 'half_monthly'
                : 'monthly';
            const compensationGroup = await CompensationGroup.findByPk(
                payload.compensation_group_id,
                { transaction }
            );
            if (!compensationGroup) {
                await transaction.rollback();
                return res.status(404).json({
                    status: 'error',
                    message: 'Compensation group not found'
                });
            }

            const nextPayCycle =
                compensationGroup?.pay_cycle === 'half_monthly'
                    ? 'half_monthly'
                    : 'monthly';

            payload.pay_cycle = nextPayCycle;

            if (nextPayCycle !== previousPayCycle) {
                const now = new Date();
                const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
                const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
                const startStr = startOfMonth.toISOString().slice(0, 10);
                const endStr = endOfMonth.toISOString().slice(0, 10);

                if (previousPayCycle === 'monthly' && nextPayCycle === 'half_monthly') {
                    const midMonthStr = new Date(Date.UTC(
                        now.getUTCFullYear(),
                        now.getUTCMonth(),
                        15
                    )).toISOString().slice(0, 10);
                    await TeacherPayslip.update(
                        { period_type: 'FIRST_HALF', period_end: midMonthStr },
                        {
                            where: {
                                teacher_id: profile.teacher_id,
                                period_start: { [Op.between]: [startStr, endStr] },
                                period_type: 'FULL'
                            },
                            transaction
                        }
                    );
                } else if (previousPayCycle === 'half_monthly' && nextPayCycle === 'monthly') {
                    const endMonthStr = endStr;
                    await TeacherPayslip.update(
                        { period_type: 'FULL', period_end: endMonthStr },
                        {
                            where: {
                                teacher_id: profile.teacher_id,
                                period_start: { [Op.between]: [startStr, endStr] },
                                period_type: 'FIRST_HALF'
                            },
                            transaction
                        }
                    );
                }
            }
        }

        await profile.update(payload, { transaction });

        /* -------------------- UPDATE PAYSLIP -------------------- */
        if (newPenalties.length > 0) {
            const penaltyMonth = newPenalties[0]?.penalty_month;

            if (!penaltyMonth) {
                await transaction.rollback();
                return res.status(400).json({ status: 'error', message: 'Penalty month is required' });
            }

            const monthStart = moment(penaltyMonth).startOf('month').format('YYYY-MM-DD');
            const monthEnd = moment(penaltyMonth).endOf('month').format('YYYY-MM-DD');

            let payslip = await TeacherPayslip.findOne({
                where: {
                    teacher_id: profile.teacher_id,
                    period_start: monthStart,
                    period_end: monthEnd,
                    status: 'draft'
                },
                transaction
            });

            // ✅ Auto-create draft if missing
            if (!payslip) {
                payslip = await TeacherPayslip.create(
                    {
                        teacher_id: profile.teacher_id,
                        salary_profile_id: profile.id,
                        period_start: monthStart,
                        period_end: monthEnd,
                        status: 'draft',
                        penalties: [],
                        base_salary: 0,
                        bonus_amount: 0,
                        penalty_amount: 0,
                        total_amount: 0,
                        created_by: req.userId ?? 1
                    },
                    { transaction }
                );
            }

            const existingPayslipPenalties = parseJsonArray(payslip.penalties);

            const mapped = newPenalties.map((p) => ({
                name: p.type,
                amount: Number(p.amount),
                description: p.description || null,
                penalty_month: p.penalty_month,
                reference_penalty_id: p.reference_penalty_id
            }));

            const updatedPenalties = [...existingPayslipPenalties, ...mapped];

            const totalPenaltyAmount = updatedPenalties.reduce((sum, p) => sum + Number(p.amount || 0), 0);

            await payslip.update(
                {
                    penalties: updatedPenalties,
                    penalty_amount: totalPenaltyAmount,
                    total_amount: Number(payslip.base_salary) + Number(payslip.bonus_amount) - totalPenaltyAmount,
                    updated_by: req.userId ?? null
                },
                { transaction }
            );
        }

        /* -------------------- ACTIVITY LOG -------------------- */
        await ActivityLog.create(
            {
                entity_type: 'salary',
                entity_id: profile.id,
                action_type: 'teacher_salary_profile_updated',
                performed_by: req.userId ?? null,
                action: {
                    teacher_id: profile.teacher_id,
                    message: 'Teacher salary profile updated',
                    updated_fields: Object.keys(payload)
                }
            },
            { transaction }
        );

        await transaction.commit();

        return res.json({ status: 'success', data: profile });
    } catch (error) {
        await transaction.rollback();
        console.error('Update Teacher Salary Profile Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update salary profile'
        });
    }
};

/* ---------------- DELETE ---------------- */
const deleteTeacherSalaryProfile = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const { id } = req.params;

        const profile = await TeacherSalaryProfile.findByPk(id, { transaction });
        if (!profile) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Salary profile not found'
            });
        }

        /* -------------------- BEFORE SNAPSHOT -------------------- */
        const beforeSnapshot = {
            teacher_id: profile.teacher_id,
            salary_mode: profile.salary_mode,
            compensation_group_id: profile.compensation_group_id,
            current_group: profile.current_group,
            current_level: profile.current_level,
            eligible_level: profile.eligible_level,
            level_locked: profile.level_locked,
            bonus: profile.bonus,
            penalty: profile.penalty,
            total_amount: profile.total_amount
        };

        /* -------------------- DELETE PAYSLIPS -------------------- */
        await TeacherPayslip.destroy({
            where: {
                teacher_id: profile.teacher_id
            },
            transaction
        });

        /* -------------------- DELETE PROFILE -------------------- */
        await profile.destroy({ transaction });

        /* -------------------- ACTIVITY LOG -------------------- */
        await ActivityLog.create(
            {
                entity_type: 'salary',
                entity_id: id,
                action_type: 'teacher_salary_profile_deleted',
                performed_by: req.userId ?? null,
                before_value: beforeSnapshot,
                after_value: null,
                action: {
                    teacher_id: profile.teacher_id,
                    message: 'Teacher salary profile and all payslips deleted'
                }
            },
            { transaction }
        );

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Salary profile and all payslips deleted successfully'
        });
    } catch (error) {
        await transaction.rollback();
        console.error('Delete Teacher Salary Profile Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to delete salary profile'
        });
    }
};

const getTeacherSalaryProfileDropdownData = async (req, res) => {
    try {
        /* ---------- Fetch teachers ---------- */
        const teachers = await User.findAll({
            where: {
                role_name: 'teacher',
                status: 'active',
                ban: false
            },
            attributes: ['id', ['full_name', 'name'], 'email'],
            order: [['full_name', 'ASC']]
        });

        /* ---------- Fetch compensation groups ---------- */
        const groups = await CompensationGroup.findAll({
            where: {
                is_active: true
            },
            attributes: ['id', 'name', 'levels'],
            order: [['name', 'ASC']]
        });

        /* ---------- Normalize levels ---------- */
        const formattedGroups = groups.map((group) => ({
            id: group.id,
            name: group.name,
            levels: Array.isArray(group.levels) ? group.levels : JSON.parse(group.levels || '[]')
        }));

        return res.status(200).json({
            status: 'success',
            data: {
                teachers,
                compensation_groups: formattedGroups
            }
        });
    } catch (error) {
        console.error('Get Salary Profile Dropdown Data Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch salary profile dropdown data'
        });
    }
};

const getTeacherSalaryAndBonuses = async (req, res) => {
    try {
        const teacher_id = Number(req.query.teacher_id);

        if (!teacher_id) {
            return res.status(400).json({
                status: 'error',
                message: 'teacher_id is required'
            });
        }

        /* =========================
       1️⃣ Salary Profile
    ========================== */
        const salaryProfile = await TeacherSalaryProfile.findOne({
            where: { teacher_id },
            attributes: ['salary_mode', 'current_group', 'current_level', 'eligible_level', 'level_locked', 'compensation_group_id'],
            include: [
    {
      model: CompensationGroup,
      as: 'compensation_group',
      attributes: ['currency_code']
    }
  ]
        });

        if (!salaryProfile) {
            return res.status(404).json({
                status: 'error',
                message: 'Salary profile not found'
            });
        }

        /* =========================
       2️⃣ Compensation Group
    ========================== */
        const compensationGroup = await CompensationGroup.findOne({
            where: {
                id: salaryProfile.compensation_group_id,
                is_active: true
            },
            attributes: ['bonus_rules', 'name']
        });

        const rawBonusRules = compensationGroup?.bonus_rules;
        const compensationGroupName = compensationGroup?.name;

        // ✅ Normalize bonus_rules safely
        let bonusRulesArray = [];

        if (Array.isArray(rawBonusRules)) {
            bonusRulesArray = rawBonusRules;
        } else if (typeof rawBonusRules === 'string') {
            try {
                const parsed = JSON.parse(rawBonusRules);
                if (Array.isArray(parsed)) {
                    bonusRulesArray = parsed;
                } else if (Array.isArray(parsed?.rules)) {
                    bonusRulesArray = parsed.rules;
                }
            } catch (e) {
                console.error('Failed to parse bonus_rules JSON', e);
            }
        } else if (Array.isArray(rawBonusRules?.rules)) {
            bonusRulesArray = rawBonusRules.rules;
        }

        const bonusTargets = bonusRulesArray.map((rule) => ({
            level_key: rule.level_key,
            bonus_name: rule.bonus_name,
            min_lifetime_lessons: Number(rule.min_lifetime_lessons),
            min_monthly_hours: Number(rule.min_monthly_hours),
            min_retention_rate: Number(rule.min_retention_rate),
            bonus_amount: Number(rule.bonus_amount),
            is_active: rule.is_active === true || rule.is_active === 1
        }));

        const currentLevel = salaryProfile.current_level;

        // Find bonus for teacher's current level
        const currentLevelBonus = bonusTargets.find((rule) => rule.level_key?.toLowerCase().trim() === currentLevel?.toLowerCase().trim()) || null;

        /* =========================
       3️⃣ Classes (Last 30 Days)
    ========================== */
        const classesLast30Days = await Class.count({
            where: {
                teacher_id,
                status: 'ended',
                meeting_start: {
                    [Op.gte]: moment().subtract(30, 'days').toDate()
                }
            }
        });

        /* =========================
       4️⃣ Renewal Rate (Last 90 Days)
    ========================== */
        const renewalStats = await Class.findAll({
            attributes: [
                [fn('COUNT', col('id')), 'total'],
                [fn('SUM', literal('CASE WHEN next_month_class_term = 1 THEN 1 ELSE 0 END')), 'renewed']
            ],
            where: {
                teacher_id,
                meeting_start: {
                    [Op.gte]: moment().subtract(90, 'days').toDate()
                }
            },
            raw: true
        });

        const totalClasses = Number(renewalStats[0]?.total || 0);
        const renewedClasses = Number(renewalStats[0]?.renewed || 0);

        const avgRenewalRate = totalClasses ? Number(((renewedClasses / totalClasses) * 100).toFixed(2)) : 0;

        /* =========================
        5️⃣ Salary History
        ========================== */
        const currencyCode =
        salaryProfile.compensation_group?.currency_code || "USD";

        const payslips = await TeacherPayslip.findAll({
            where: { teacher_id },
            attributes: ['period_start', 'status', 'base_salary', 'bonus_amount', 'penalty_amount', 'total_amount'],
            order: [['period_start', 'DESC']]
        });

        const salaryHistory = payslips.map((p) => ({
            month: moment(p.period_start).format('YYYY-MM'),
            total_paid: Number(p.base_salary),
            bonuses: Number(p.bonus_amount),
            penalties: Number(p.penalty_amount),
            net_salary: Number(p.total_amount),
            currency: currencyCode || 'USD',
            status: p.status
        }));

        const retentionRate = await calculateRetentionRate(teacher_id, 3);
        /* =========================
        6️⃣ Final Response
        ========================== */
        return res.json({
            status: 'success',
            data: {
                kpis: {
                    classes_last_30_days: classesLast30Days,
                    avg_renewal_rate_90_days: retentionRate,
                    eligible_level: salaryProfile.eligible_level,
                    current_level: salaryProfile.current_level,
                    salary_mode: salaryProfile.salary_mode,
                    level_locked: salaryProfile.level_locked ? 1 : 0,
                    compensationGroupName
                },
                bonus_targets: currentLevelBonus,
                salary_history: salaryHistory
            }
        });
    } catch (error) {
        console.error('Teacher salary & bonus error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch salary & bonus details'
        });
    }
};

const exportTeacherPayslipsCSV = async (req, res) => {
    try {
        const { teacher_id } = req.query;

        if (!teacher_id) {
            return res.status(400).json({
                status: 'error',
                message: 'teacher_id is required'
            });
        }

        const payslips = await TeacherPayslip.findAll({
            where: { teacher_id },
            order: [['period_start', 'DESC']],
            raw: true
        });

        if (!payslips.length) {
            return res.status(404).json({
                status: 'error',
                message: 'No payslips found for this teacher'
            });
        }

        /* -------------------- CSV HEADERS -------------------- */
        const csvHeaders = ['Period Start', 'Period End', 'Status', 'Base Salary', 'Bonus Amount', 'Penalty Amount', 'Total Amount', 'Classes'].join(',');

        /* -------------------- CSV ROWS -------------------- */
        const csvRows = payslips.map((p) => {
            const classes = formatClassesForCSV(p.classes);

            return [p.period_start, p.period_end, p.status, Number(p.base_salary || 0), Number(p.bonus_amount || 0), Number(p.penalty_amount || 0), Number(p.total_amount || 0), `"${classes}"`].join(
                ','
            );
        });

        const csvContent = [csvHeaders, ...csvRows].join('\n');

        /* -------------------- FILE NAME -------------------- */
        const filename = `teacher-${teacher_id}-payslips-${new Date().toISOString().split('T')[0]}.csv`;

        /* -------------------- RESPONSE -------------------- */
        return res.status(200).json({
            status: 'success',
            message: 'Teacher payslips exported successfully',
            data: {
                filename,
                downloadUrl: `data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`
            }
        });
    } catch (error) {
        console.error('Export Teacher Payslips Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to export teacher payslips'
        });
    }
};

module.exports = {
    createTeacherSalaryProfile,
    getTeacherSalaryProfiles,
    getTeacherSalaryProfileById,
    updateTeacherSalaryProfile,
    deleteTeacherSalaryProfile,
    getTeacherSalaryProfileDropdownData,
    getTeacherSalaryAndBonuses,
    exportTeacherPayslipsCSV
};
