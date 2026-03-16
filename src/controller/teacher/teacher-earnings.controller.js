const { Op, fn, col, literal } = require('sequelize');
const TeacherPayslip = require('../../models/TeacherPaySlip');
const moment = require('moment-timezone');
const TeacherEarningHistory = require('../../models/teacherEarningHistory');
const Class = require('../../models/classes');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const User = require('../../models/users');
const CompensationGroup = require('../../models/compensationgroup');
const TeacherSalaryProfile = require('../../models/teacherSalaryProfile');
const { calculateRetentionRate } = require('../../helper/calculateRetention');

const CURRENCY_SYMBOLS = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
  JPY: "¥",
  CNY: "¥",
  PHP: "₱",
  KRW: "₩",
  IDR: "Rp",
  VND: "₫",
  THB: "฿",
  MYR: "RM",
  SGD: "$",
  HKD: "$",
  AUD: "$",
  CAD: "$",
  NZD: "$",

  CHF: "CHF",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  PLN: "zł",
  HUF: "Ft",
  CZK: "Kč",
  RON: "lei",
  BGN: "лв",

  AED: "د.إ",
  SAR: "﷼",
  QAR: "﷼",
  KWD: "د.ك",
  BHD: "د.ب",
  OMR: "ر.ع",
  ILS: "₪",
  JOD: "د.ا",

  ZAR: "R",
  NGN: "₦",
  EGP: "£",
  GHS: "₵",
  KES: "KSh",
  UGX: "USh",
  TZS: "TSh",

  BRL: "R$",
  MXN: "$",
  ARS: "$",
  CLP: "$",
  COP: "$",
  PEN: "S/",
  UYU: "$",
  BOB: "Bs",
  CRC: "₡",
  DOP: "$",
  JMD: "$",

  XOF: "CFA",
  XAF: "FCFA",
  XCD: "$",
  XPF: "₣"
};

const getCurrencySymbol = (code) =>
  CURRENCY_SYMBOLS[String(code || "USD").toUpperCase()] || code;

const parseJsonArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;

    if (typeof value === 'string') {
        try {
            let parsed = JSON.parse(value);
            while (typeof parsed === 'string') {
                parsed = JSON.parse(parsed);
            }
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    return [];
};

const VALID_HISTORY_RANGES = new Set([
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_3_months",
  "custom",
]);

const isValidDateString = (value) =>
  moment.utc(String(value), "YYYY-MM-DD", true).isValid();

const DEFAULT_CURRENCY = 'USD';

const getTeacherKpis = async (req, res) => {
    try {
        const teacher_id = req.user.id;

        if (!teacher_id) {
            return res.status(400).json({
                status: 'error',
                message: 'teacher_id is required'
            });
        }

        /* -------------------- SALARY PROFILE (CURRENCY) -------------------- */
        const salaryProfile = await TeacherSalaryProfile.findOne({
            where: { teacher_id },
            include: [
                {
                    model: CompensationGroup,
                    as: 'compensation_group',
                    attributes: ['currency_code']
                }
            ]
        });

        const currencyCode =
            salaryProfile?.compensation_group?.currency_code || "USD";
        const currencySymbol = getCurrencySymbol(currencyCode);

        /* -------------------- DATE BOUNDARIES -------------------- */
        const today = moment.utc().endOf('day').toDate();
        const currentMonthStart = moment.utc().startOf('month').toDate();
        const nextMonthStart = moment.utc().add(1, 'month').startOf('month').toDate();

        /* --------------------------------------------------
           (1) TOTAL EARNED TILL TODAY (FINAL AND DRAFT)
        -------------------------------------------------- */
        const totalEarnedTillToday = await TeacherPayslip.sum('total_amount', {
            where: {
                teacher_id,
                status: { [Op.in]: ['draft', 'final'] },
                period_end: { [Op.lt]: nextMonthStart }
            }
        });

        /* --------------------------------------------------
           (2) TOTAL BONUS TILL TODAY (FINAL AND DRAFT)
        -------------------------------------------------- */
        const bonusEarnedTillToday = await TeacherPayslip.sum('bonus_amount', {
            where: {
                teacher_id,
                status: { [Op.in]: ['draft', 'final'] },
                period_start: { [Op.gte]: currentMonthStart },
                period_end: { [Op.lt]: nextMonthStart }
            }
        });

        /* --------------------------------------------------
           (3) CURRENT ACTIVE PAYSLIP (FINAL > DRAFT)
        -------------------------------------------------- */
        const payslips = await TeacherPayslip.findAll({
            where: {
                teacher_id,
                status: { [Op.ne]: 'cancelled' },
                period_start: { [Op.gte]: currentMonthStart },
                period_end: { [Op.lt]: nextMonthStart }
            },
            attributes: ['classes']
        });

        /* --------------------------------------------------
   (3A) CURRENT BALANCE (CURRENT MONTH, DRAFT + FINAL)
-------------------------------------------------- */
        const currentBalance = await TeacherPayslip.sum('total_amount', {
            where: {
                teacher_id,
                status: { [Op.ne]: 'cancelled' },
                period_start: { [Op.gte]: currentMonthStart },
                period_end: { [Op.lt]: nextMonthStart }
            }
        });



        /* --------------------------------------------------
           (4) CLASSES + HOURS CALCULATION
        -------------------------------------------------- */
        let totalClasses = 0;
        let totalHours = 0;

        for (const payslip of payslips) {
            let classes = payslip.classes;

            if (typeof classes === 'string') {
                try {
                    classes = JSON.parse(classes);
                    if (typeof classes === 'string') classes = JSON.parse(classes);
                } catch {
                    classes = [];
                }
            }

            if (!Array.isArray(classes)) continue;

            for (const cls of classes) {
                const count = Number(cls.count || 0);
                totalClasses += count;
                if (cls.type === '25_min') totalHours += (30 * count) / 60;
                if (cls.type === '40_min') totalHours += (45 * count) / 60;
                if (cls.type === '55_min') totalHours += (60 * count) / 60;
            }
        }

        totalHours = Math.round(totalHours * 100) / 100;


        /* --------------------------------------------------
           (5) RETENTION RATE (ROLLING 3 MONTHS)
        -------------------------------------------------- */
        const retentionRate = await calculateRetentionRate(
            teacher_id,
            3,
            moment.utc()
        );

        /* -------------------- RESPONSE -------------------- */
        return res.status(200).json({
            status: 'success',
            data: {
                total_earned_till_today: Number(totalEarnedTillToday || 0),
                total_bonus_till_today: Number(bonusEarnedTillToday || 0),
                current_balance: Number(currentBalance || 0),
                total_classes_current_month: totalClasses,
                total_hours_current_month: totalHours,
                retention_rate: retentionRate,
                code: currencyCode,
                symbol: currencySymbol
            }
        });
    } catch (error) {
        console.error('TEACHER KPI ERROR:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch teacher KPIs'
        });
    }
};

const getTeacherBonusTarget = async (req, res) => {
    try {
        const teacher_id = req.user.id;

        if (!teacher_id) {
            return res.status(400).json({
                status: "error",
                message: "teacher_id is required",
            });
        }

        /* -------------------- SALARY PROFILE -------------------- */
        const salaryProfile = await TeacherSalaryProfile.findOne({
            where: { teacher_id },
            attributes: [
                "compensation_group_id",
                "current_level",
                "eligible_level",
                "level_locked",
            ],
        });

        if (!salaryProfile) {
            return res.status(404).json({
                status: "error",
                message: "Salary profile not found",
            });
        }

        /* -------------------- COMPENSATION GROUP -------------------- */
        const compensationGroup = await CompensationGroup.findOne({
            where: {
                id: salaryProfile.compensation_group_id,
                is_active: true,
            },
            attributes: ["id", "name", "bonus_rules", "currency_code"],
        });

        if (!compensationGroup) {
            return res.status(404).json({
                status: "error",
                message: "Compensation group not found",
            });
        }

        /* -------------------- RESOLVE LEVEL -------------------- */
        const level = salaryProfile.current_level;

        /* -------------------- BONUS RULE RESOLUTION -------------------- */
        let bonusRules = [];

        if (typeof compensationGroup.bonus_rules === "string") {
            try {
                bonusRules = JSON.parse(compensationGroup.bonus_rules);
            } catch {
                bonusRules = [];
            }
        } else if (Array.isArray(compensationGroup.bonus_rules)) {
            bonusRules = compensationGroup.bonus_rules;
        }

        const levelBonusTarget = bonusRules.find(
            (rule) =>
                rule.level_key === level &&
                rule.is_active === true
        );


        if (!levelBonusTarget) {
            return res.status(200).json({
                status: "success",
                data: {
                    level,
                    has_bonus: false,
                    message: "No bonus rule configured for this level",
                },
            });
        }

        /* -------------------- RESPONSE -------------------- */
        return res.status(200).json({
            status: "success",
            data: {
                compensation_group: compensationGroup.name,
                level,
                currency_code: compensationGroup.currency_code,
                has_bonus: true,
                bonus_target: {
                    target_hours: levelBonusTarget.min_monthly_hours || 0,
                    target_classes: levelBonusTarget.min_lifetime_lessons || 0,
                    target_retention: levelBonusTarget.min_retention_rate || 0,
                    bonus_amount: levelBonusTarget.bonus_amount || 0,
                    bonus_name: levelBonusTarget.bonus_name || null
                }
            }
        });

    } catch (error) {
        console.error("Get Teacher Bonus Target Error:", error);
        return res.status(500).json({
            status: "error",
            message: "Failed to fetch bonus target",
        });
    }
};

const getTeacherEarningsOverview = async (req, res) => {
    try {
        const teacher_id = req.user.id;

        const salaryProfile = await TeacherSalaryProfile.findOne({
            where: { teacher_id },
            include: [
                {
                    model: CompensationGroup,
                    as: 'compensation_group',
                    attributes: ['currency_code']
                }
            ]
        });

        const currencyCode =
            salaryProfile?.compensation_group?.currency_code || "USD";

        const currencySymbol = getCurrencySymbol(currencyCode);


        if (!teacher_id) {
            return res.status(400).json({
                status: 'error',
                message: 'teacher_id is required'
            });
        }

        // Last 12 months (UTC safe)
        const startMonth = moment.utc().subtract(11, 'months').startOf('month').toDate();
        const endMonth = moment.utc().endOf('month').toDate();

        const earnings = await TeacherPayslip.findAll({
            where: {
                teacher_id,
                status: 'final',
                period_start: {
                    [Op.gte]: startMonth,
                    [Op.lte]: endMonth
                }
            },
            attributes: [
                [fn('DATE_FORMAT', col('period_start'), '%Y-%m'), 'month'],
                [fn('SUM', col('total_amount')), 'total_amount'],
                [fn('SUM', col('bonus_amount')), 'bonus_amount']
            ],
            group: [literal('month')],
            order: [[literal('month'), 'ASC']]
        });

        return res.status(200).json({
            status: 'success',
            data: earnings,
            currency: {
                code: currencyCode,
                symbol: currencySymbol
            },
        });
    } catch (error) {
        console.error('EARNINGS OVERVIEW ERROR:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch earnings overview'
        });
    }
};

const resolveDateRange = (range) => {
  const now = moment.utc();

  switch (range) {
    case "this_week":
      return {
        from: now.clone().startOf("week").toDate(),
        to: now.clone().endOf("week").toDate()
      };

    case "last_week":
      return {
        from: now.clone().subtract(1, "week").startOf("week").toDate(),
        to: now.clone().subtract(1, "week").endOf("week").toDate()
      };

    case "this_month":
      return {
        from: now.clone().startOf("month").toDate(),
        to: now.clone().endOf("month").toDate()
      };

    case "last_month":
      return {
        from: now.clone().subtract(1, "month").startOf("month").toDate(),
        to: now.clone().subtract(1, "month").endOf("month").toDate()
      };

    case "last_3_months":
      return {
        from: now.clone().subtract(3, "months").startOf("month").toDate(),
        to: now.clone().endOf("month").toDate()
      };

    default:
      return null;
  }
};

const getTeacherEarningHistory = async (req, res) => {
    try {
        const teacher_id = req.user.id;

        const salaryProfile = await TeacherSalaryProfile.findOne({
            where: { teacher_id },
            include: [
                {
                    model: CompensationGroup,
                    as: 'compensation_group',
                    attributes: ['currency_code']
                }
            ]
        });

        const currencyCode =
            salaryProfile?.compensation_group?.currency_code || "USD";

        const currencySymbol = getCurrencySymbol(currencyCode);


        if (!teacher_id) {
            return res.status(400).json({
                status: 'error',
                message: 'teacher_id is required'
            });
        }

        // ---------------------------
        // Pagination (safe defaults)
        // ---------------------------
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const offset = (page - 1) * limit;

        // ---------------------------
        // Filters (date range)
        // ---------------------------

        const { from_date, to_date, range } = req.query;

        const where = { teacher_id };
        if (range && !VALID_HISTORY_RANGES.has(String(range))) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid range value'
            });
        }
        if (from_date && !isValidDateString(from_date)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid from_date. Expected YYYY-MM-DD'
            });
        }
        if (to_date && !isValidDateString(to_date)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid to_date. Expected YYYY-MM-DD'
            });
        }
        if (from_date && to_date && moment.utc(to_date).isBefore(moment.utc(from_date))) {
            return res.status(400).json({
                status: 'error',
                message: 'to_date cannot be before from_date'
            });
        }

        if (range && range !== "custom") {
            const resolved = resolveDateRange(range);
            if (resolved) {
                where.earning_date = {
                    [Op.between]: [resolved.from, resolved.to]
                };
            }
        } else if (from_date || to_date) {
            where.earning_date = {
                ...(from_date && { [Op.gte]: from_date }),
                ...(to_date && { [Op.lte]: to_date })
            };
        }



        // ---------------------------
        // Main query (paginated)
        // ---------------------------
        const { rows, count } = await TeacherEarningHistory.findAndCountAll({
            where,
            order: [['earning_date', 'DESC']],
            limit,
            offset
        });

        // ---------------------------
        // Penalties (map by class id)
        // ---------------------------
        const earningDates = rows
            .map((row) => row.earning_date)
            .filter(Boolean);

        const regularPenaltyMap = {};
        const trialPenaltyMap = {};

        if (earningDates.length) {
            const minDate = earningDates.reduce((min, d) => (d < min ? d : min));
            const maxDate = earningDates.reduce((max, d) => (d > max ? d : max));

            const payslips = await TeacherPayslip.findAll({
                where: {
                    teacher_id,
                    status: { [Op.ne]: 'cancelled' },
                    period_start: { [Op.lte]: maxDate },
                    period_end: { [Op.gte]: minDate }
                },
                attributes: ['id', 'period_start', 'period_end', 'penalties'],
                raw: true
            });

            payslips.forEach((payslip) => {
                const penalties = parseJsonArray(payslip.penalties);

                penalties.forEach((penalty) => {
                    const penaltyInfo = {
                        penalty_type: penalty?.penalty_type ?? null,
                        unit_amount: Number(penalty?.unit_amount || 0)
                    };

                    (penalty?.regular_class_ids || []).forEach((id) => {
                        const key = Number(id);
                        if (!regularPenaltyMap[key]) regularPenaltyMap[key] = [];
                        regularPenaltyMap[key].push(penaltyInfo);
                    });

                    (penalty?.trial_class_ids || []).forEach((id) => {
                        const key = Number(id);
                        if (!trialPenaltyMap[key]) trialPenaltyMap[key] = [];
                        trialPenaltyMap[key].push(penaltyInfo);
                    });
                });
            });
        }

        // ---------------------------
        // Collect class IDs
        // ---------------------------
        const regularClassIds = new Set();
        const trialClassIds = new Set();

        rows.forEach((row) => {
            let classes = row.classes;

            if (typeof classes === 'string') {
                try {
                    classes = JSON.parse(classes);
                } catch {
                    classes = {};
                }
            }

            (classes?.regular_class_ids || []).forEach(id =>
                regularClassIds.add(id)
            );
            (classes?.trial_class_ids || []).forEach(id =>
                trialClassIds.add(id)
            );
        });

        // ---------------------------
        // Regular classes
        // ---------------------------
        const regularClasses =
            regularClassIds.size > 0
                ? await Class.findAll({
                    where: { id: [...regularClassIds] },
                    raw: false,
                    include: [
                        {
                            model: User,
                            as: 'Student',
                            attributes: ['id', ['full_name', 'name']]
                        }
                    ]
                })
                : [];

        const regularClassMap = {};
        regularClasses.forEach((cls) => {
            const duration =
                cls.meeting_start && cls.meeting_end
                    ? Math.round(
                        (new Date(cls.meeting_end) - new Date(cls.meeting_start)) / 60000
                    )
                    : 0;

            regularClassMap[cls.id] = {
                student_name: cls.Student?.dataValues?.name ?? null,
                meeting_start: cls.meeting_start,
                meeting_end: cls.meeting_end,
                class_date: cls.meeting_start,
                is_present: cls.is_present,
                duration,
                type: 'regular'
            };
        });

        // ---------------------------
        // Trial classes
        // ---------------------------
        const trialClassRecords =
            trialClassIds.size > 0
                ? await Class.findAll({
                    where: { id: [...trialClassIds] },
                    attributes: ['id', 'demo_class_id']
                })
                : [];

        const trialWrapperMap = {};
        const demoClassIds = trialClassRecords
            .map((c) => {
                trialWrapperMap[c.id] = c.demo_class_id;
                return c.demo_class_id;
            })
            .filter(Boolean);

        const trialRegistrations =
            demoClassIds.length > 0
                ? await TrialClassRegistration.findAll({
                    where: { id: demoClassIds }
                })
                : [];

        const trialRegistrationMap = {};
        trialRegistrations.forEach((trial) => {
            const duration =
                trial.meeting_start && trial.meeting_end
                    ? Math.round(
                        (new Date(trial.meeting_end) - new Date(trial.meeting_start)) /
                        60000
                    )
                    : 0;

            trialRegistrationMap[trial.id] = {
                student_name: trial.student_name,
                meeting_start: trial.meeting_start,
                meeting_end: trial.meeting_end,
                class_date: trial.meeting_start,
                is_present: trial.status === 'completed',
                duration,
                type: 'trial'
            };
        });

        // ---------------------------
        // Attach class details
        // ---------------------------
        const enrichedRows = rows.map((row) => {
            let classes = row.classes;

            if (typeof classes === 'string') {
                try {
                    classes = JSON.parse(classes);
                } catch {
                    classes = {};
                }
            }

            const classDetails = [];

            (classes?.regular_class_ids || []).forEach((id) => {
                if (regularClassMap[id]) {
                    classDetails.push({
                        ...regularClassMap[id],
                        penalties: regularPenaltyMap[id] || []
                    });
                }
            });

            (classes?.trial_class_ids || []).forEach((id) => {
                const classId = Number(id);
                const demoId = trialWrapperMap[classId];
                if (demoId && trialRegistrationMap[demoId]) {
                    classDetails.push({
                        ...trialRegistrationMap[demoId],
                        penalties: trialPenaltyMap[classId] || trialPenaltyMap[demoId] || []
                    });
                }
            });

            return {
                ...row.toJSON(),
                currency_code: currencyCode,
                currency_symbol: currencySymbol,
                classes_details: classDetails
            };
        });

        return res.status(200).json({
            status: 'success',
            data: enrichedRows,
            currency: {
                code: currencyCode,
                symbol: currencySymbol
            },
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error('EARNING HISTORY ERROR:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch earning history'
        });
    }
};

const getWeeklyEarningSummary = async (req, res) => {
    try {
        const teacher_id = req.user.id;

        const salaryProfile = await TeacherSalaryProfile.findOne({
            where: { teacher_id },
            include: [
                {
                    model: CompensationGroup,
                    as: 'compensation_group',
                    attributes: ['currency_code']
                }
            ]
        });

        const currencyCode =
            salaryProfile?.compensation_group?.currency_code || "USD";

        const currencySymbol = getCurrencySymbol(currencyCode);


        if (!teacher_id) {
            return res.status(400).json({
                status: 'error',
                message: 'teacher_id is required'
            });
        }

        // -----------------------------
        // UTC WEEK RANGE (Mon → Sun)
        // -----------------------------
        const startOfWeek = moment.utc().startOf('isoWeek').format('YYYY-MM-DD');
        const endOfWeek = moment.utc().endOf('isoWeek').format('YYYY-MM-DD');

        const records = await TeacherEarningHistory.findAll({
            where: {
                teacher_id,
                earning_date: {
                    [Op.between]: [startOfWeek, endOfWeek]
                }
            },
            attributes: ['earning_date', 'classes', 'total_amount'],
            order: [['earning_date', 'ASC']]
        });

        // -----------------------------
        // Aggregate Per Day
        // -----------------------------
        const dailyMap = {};

        for (const row of records) {
            const dayKey = moment.utc(row.earning_date).format('ddd'); // Mon, Tue

            if (!dailyMap[dayKey]) {
                dailyMap[dayKey] = {
                    day: dayKey,
                    total_classes: 0,
                    total_amount: 0
                };
            }

            // -----------------------------
            // COUNT CLASSES FROM JSON
            // -----------------------------
            let rawClasses = row.classes;

            if (typeof rawClasses === 'string') {
                try {
                    rawClasses = JSON.parse(rawClasses);
                } catch {
                    rawClasses = {};
                }
            }

            rawClasses = rawClasses || {};

            const regularCount = Array.isArray(rawClasses.regular_class_ids) ? rawClasses.regular_class_ids.length : 0;

            const trialCount = Array.isArray(rawClasses.trial_class_ids) ? rawClasses.trial_class_ids.length : 0;

            dailyMap[dayKey].total_classes += regularCount + trialCount;

            dailyMap[dayKey].total_amount += Number(row.total_amount || 0);
        }

        return res.status(200).json({
            status: 'success',
            data: Object.values(dailyMap),
            currency: {
                code: currencyCode,
                symbol: currencySymbol
            },
        });
    } catch (error) {
        console.error('WEEKLY EARNING SUMMARY ERROR:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch weekly earning summary'
        });
    }
};

const exportTeacherEarningHistory = async (req, res) => {
    try {
        const teacherId = req.user.id; // or req.params.teacher_id

        let where = { teacher_id: teacherId };

        const earnings = await TeacherEarningHistory.findAll({
            where,
            order: [["earning_date", "ASC"]],
            raw: true,
        });

        if (!earnings.length) {
            return res.status(404).json({
                status: "error",
                message: "No earning history found",
            });
        }

        /* -------------------- CSV UTILS -------------------- */
        const csvEscape = (val) => {
            if (val === null || val === undefined) return "";
            const str = String(val);
            return str.includes(",") || str.includes('"')
                ? `"${str.replace(/"/g, '""')}"`
                : str;
        };

        /* -------------------- BUILD CSV -------------------- */

        const rows = [
            [
                "Date",
                "Base Rate",
                "Bonus Amount",
                "Penalty Amount",
                "Total Amount"
            ],
        ];

        for (const e of earnings) {

            rows.push([
                e.earning_date,
                csvEscape(e.base_rate),
                csvEscape(e.bonus_amount),
                csvEscape(e.penalty_amount),
                csvEscape(e.total_amount),
            ]);
        }

        const csvContent = rows.map((r) => r.join(",")).join("\n");

        /* -------------------- RESPONSE -------------------- */

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
            "Content-Disposition",
            "attachment; filename=teacher-earning-history.csv"
        );

        return res.send(csvContent);
    } catch (error) {
        console.error("Earning history export failed:", error);
        return res.status(500).json({
            status: "error",
            message: error.message,
        });
    }
};

module.exports = {
    getTeacherKpis,
    getTeacherEarningsOverview,
    getTeacherEarningHistory,
    getWeeklyEarningSummary,
    exportTeacherEarningHistory,
    getTeacherBonusTarget
};
