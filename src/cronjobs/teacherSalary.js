const cron = require('node-cron');
const moment = require('moment-timezone');
const { Op, fn, col, where } = require('sequelize');
const Class = require('../models/classes');
const TeacherSalaryProfile = require('../models/teacherSalaryProfile');
const CompensationGroup = require('../models/compensationgroup');
const TeacherPayslip = require('../models/TeacherPaySlip');
const ActivityLog = require('../models/activityLogs');
const TeacherSalaryAdjustment = require('../models/TeacherSalaryAdjustments');
const { calculateRetentionRate } = require('../helper/calculateRetention');
const TeacherEarningHistory = require('../models/teacherEarningHistory');
const { sequelize } = require('../connection/connection');
const User = require('../models/users');

function parseJSONDeep(value, fallback = null) {
  try {
    let parsed = value;

    while (typeof parsed === 'string') {
      parsed = JSON.parse(parsed);
    }

    return parsed ?? fallback;
  } catch (e) {
    return fallback;
  }
}

function resolveEligibleLevel({
  eligibleKPIs,
  levels,
  monthlyLessons,
  lifetimeLessons,
  monthlyHours,
  retentionRate,
  experienceMonths
}) {
  if (!eligibleKPIs || typeof eligibleKPIs !== 'object' || Array.isArray(eligibleKPIs)) {
    return null;
  }
  
  const levelRateMap = {};
  for (const lvl of levels || []) {
      levelRateMap[lvl.key] = Number(lvl.hourly_rate || 0);
    }

  const eligibleLevels = [];

    for (const [levelKey, kpis] of Object.entries(eligibleKPIs)) {
      if (!kpis || typeof kpis !== 'object') continue;

      const eligible =
        monthlyLessons >= (kpis.min_lessons || 0) &&
        lifetimeLessons >= (kpis.min_lifetime_lessons || 0) &&
        monthlyHours >= (kpis.min_hours || 0) &&
        retentionRate >= (kpis.min_retention_rate || 0) &&
        experienceMonths >= (kpis.min_working_months || 0);

    if (eligible) eligibleLevels.push(levelKey);
  }

  if (eligibleLevels.length === 0) return null;

  // ✅ highest hourly rate wins
  eligibleLevels.sort((a, b) => (levelRateMap[b] || 0) - (levelRateMap[a] || 0));

  return eligibleLevels[0];
}

const normalizeJsonArray = (value) => {
  if (!value) return [];

  // Already array
  if (Array.isArray(value)) return value;

  // Sequelize / DB object
  if (typeof value === 'object') {
    if (Array.isArray(value)) return value;
    if (value.dataValues) return normalizeJsonArray(value.dataValues);
    return [];
  }

  // String case (most common in dev)
  if (typeof value === 'string') {
    try {
      let parsed = value;

      // handle double-stringified JSON
      while (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }

      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error('normalizeJsonArray failed:', value);
      return [];
    }
  }

  // Buffer case (mysql)
  if (Buffer.isBuffer(value)) {
    try {
      const parsed = JSON.parse(value.toString());
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
};

function normalizePayableMinutes(minutes) {
    if (minutes <= 25) return 30;
    if (minutes <= 40) return 45;
    return 60;
}

const getClassType = (minutes) => {
    if (minutes <= 25) return '25_min';
    if (minutes <= 40) return '40_min';
    return '55_min';
};

function getMinutes(start, end) {
    return moment(end).diff(moment(start), 'minutes');
}

function calcAmount(rate, minutes) {
    return rate * (minutes / 60);
}

function isCancelledLate(cls) {
    if (!cls.cancelled_at || !cls.meeting_start) return false;

    const diff = moment(cls.meeting_start).diff(moment(cls.cancelled_at), 'minutes');

    return diff >= 0 && diff <= 30;
}

async function resolveHourlyRate(profile,transaction) {
    if (profile.salary_mode === 'manual') {
        return Number(profile.manual_hourly_rate);
    }

    const group = await CompensationGroup.findByPk(profile.compensation_group_id, { raw: true,transaction  });

    if (!group || !group.levels) return null;

    let levels;

    try {
        levels = typeof group.levels === 'string' ? JSON.parse(group.levels) : group.levels;
    } catch (err) {
        console.error(`Invalid levels JSON for compensation_group_id ${profile.compensation_group_id}`);
        return null;
    }

    if (!Array.isArray(levels)) return null;

    const level = levels.find((l) => l.key === profile.current_level);

    return level ? Number(level.hourly_rate) : null;
}
/* ---------- PAID LESSON CHECK ---------- */
function isPaidLesson(cls) {
    if (cls.status === 'ended') return true;
    if (isCancelledLate(cls)) return true;
    return false;
}

/* ---------- DURATION ---------- */
function getMinute(cls) {
    if (cls.meeting_start && cls.meeting_end) {
        return moment(cls.meeting_end).diff(moment(cls.meeting_start), 'minutes');
    }
    return 0;
}

/* ---------- LIFETIME PAID LESSONS ---------- */
async function getLifetimePaidLessons(teacherId, start, end, transaction) {
    const classes = await Class.findAll({
        where: { teacher_id: teacherId, meeting_start: { [Op.between]: [start, end] } },
        transaction
    });

    return classes.filter(isPaidLesson).length;
}

/* ---------- TRUE LIFETIME PAID LESSONS ---------- */
async function getLifetimePaidLessonsAll(teacherId, transaction) {
    const classes = await Class.findAll({
        where: { teacher_id: teacherId },
        transaction
    });

    return classes.filter(isPaidLesson).length;
}

/* ---------- MONTHLY PAID MINUTES ---------- */
async function getMonthlyPaidMinutes(teacherId, start, end, transaction) {
  const classes = await Class.findAll({
    where: {
      teacher_id: teacherId,
      meeting_start: { [Op.between]: [start, end] }
    },
    transaction
  });

  return classes
    .filter(isPaidLesson)
    .reduce((sum, cls) => {
      const actual = getMinute(cls);
      const payable = normalizePayableMinutes(actual);
      return sum + payable;
    }, 0);
}

/* ---------- SALARY CRON ---------- */
async function processTeacherSalary() {
    console.log('processTeacherSalary start');

    const start = moment.utc().subtract(1, 'day').startOf('day').toDate();
    const end = moment.utc().subtract(1, 'day').endOf('day').toDate();
    const payrollDate = start;

    const profiles = await TeacherSalaryProfile.findAll();

    for (const profile of profiles) {
        const transaction = await sequelize.transaction();

        try {
            const hourlyRate = await resolveHourlyRate(profile, transaction);
            if (!hourlyRate) {
                await transaction.rollback();
                continue;
            }

            const classes = await Class.findAll({
                where: {
                    teacher_id: profile.teacher_id,
                    meeting_end: { [Op.between]: [start, end] }
                },
                transaction
            });

            let dailyTotal = 0;
            const dailyClassMap = {};
            const regularClassIds = [];
            const trialClassIds = [];

            // -------------------------------
            // SINGLE PASS CLASS PROCESSING
            // -------------------------------
            for (const cls of classes) {
                let payable = false;
                if (cls.status === 'ended') payable = true;
                if (isCancelledLate(cls)) payable = true;
                if (!payable) continue;

                // const minutes = getMinutes(cls.meeting_start, cls.meeting_end);
                // const amount = calcAmount(hourlyRate, minutes);
                // const classType = getClassType(minutes);

                const actualMinutes = getMinutes(cls.meeting_start, cls.meeting_end);
                const payableMinutes = normalizePayableMinutes(actualMinutes);

                const amount = calcAmount(hourlyRate, payableMinutes);
                const classType = getClassType(actualMinutes); // keep type based on real duration

                dailyTotal += amount;

                if (!dailyClassMap[classType]) {
                    dailyClassMap[classType] = { count: 0, amount: 0 };
                }

                dailyClassMap[classType].count += 1;
                dailyClassMap[classType].amount += amount;

                if (cls.is_trial) trialClassIds.push(cls.id);
                else regularClassIds.push(cls.id);
            }

            const shouldAddSalary = dailyTotal > 0;
            const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

            // -------------------------------
            // DAILY EARNING HISTORY
            // -------------------------------
            if (shouldAddSalary) {
                const earningDate = moment.utc(start).format('YYYY-MM-DD');

                const [earningHistory] = await TeacherEarningHistory.findOrCreate({
                    where: {
                        teacher_id: profile.teacher_id,
                        earning_date: earningDate
                    },
                    defaults: {
                        teacher_id: profile.teacher_id,
                        earning_date: earningDate,
                        base_rate: hourlyRate,
                        total_amount: 0,
                        classes: {
                            regular_class_ids: [],
                            trial_class_ids: []
                        }
                    },
                    transaction
                });

                const rawClasses = earningHistory.classes || {};
                const existingRegular = Array.isArray(rawClasses.regular_class_ids) ? rawClasses.regular_class_ids : [];
                const existingTrial = Array.isArray(rawClasses.trial_class_ids) ? rawClasses.trial_class_ids : [];

                const mergedRegular = [...new Set([...existingRegular, ...regularClassIds])];
                const mergedTrial = [...new Set([...existingTrial, ...trialClassIds])];

                const updatedTotal = round2(Number(earningHistory.total_amount || 0) + Number(dailyTotal));

                await earningHistory.update(
                    {
                        base_rate: hourlyRate,
                        total_amount: updatedTotal,
                        classes: {
                            regular_class_ids: mergedRegular,
                            trial_class_ids: mergedTrial
                        }
                    },
                    { silent: true, transaction }
                );
            }

            // -------------------------------
            // RESOLVE PAY PERIOD (FINAL, CORRECT)
            // -------------------------------

            // salary day = the day being paid (yesterday)
            const salaryDay = moment.utc(start);
            
            // anchor month ONCE
            const monthStart = salaryDay.clone().startOf('month');
            const monthEnd = salaryDay.clone().endOf('month').startOf('day');
            
            const day = salaryDay.date();
            
            let period_start, period_end, period_type;
            
            // -------------------- HALF MONTHLY --------------------
            if (profile.pay_cycle === 'half_monthly') {
                if (day <= 15) {
                    period_start = monthStart.clone().toDate(); // Jan 1
                    period_end = monthStart.clone().date(15).startOf('day').toDate(); // Jan 15
                    period_type = 'FIRST_HALF';
                } else {
                    period_start = monthStart.clone().date(16).startOf('day').toDate(); // Jan 16
                    period_end = monthEnd.clone().startOf('day').toDate(); // Jan 31 ✅
                    period_type = 'SECOND_HALF';
                }
            }
            
            // -------------------- MONTHLY --------------------
            else {
                period_start = monthStart.clone().toDate(); // Jan 1
                period_end = monthEnd.clone().toDate(); // Jan 31 ✅
                period_type = 'FULL';
            }
            
            let payslip = await TeacherPayslip.findOne({
                where: {
                    teacher_id: profile.teacher_id,
                    salary_profile_id: profile.id,
                    status: 'draft',
                    period_type,
                    period_start,
                    period_end
                },
                transaction
            });

            if (!payslip) {
                payslip = await TeacherPayslip.create(
                    {
                        teacher_id: profile.teacher_id,
                        salary_profile_id: profile.id,
                        period_start,
                        period_end,
                        period_type,
                        base_salary: 0,
                        bonus_amount: 0,
                        penalty_amount: 0,
                        total_amount: 0,
                        status: 'draft',
                        created_by: 1
                    },
                    { transaction }
                );
            }

            if (shouldAddSalary) {
                if (!Object.keys(dailyClassMap).length) {
                    console.log('No new classes for today → skipping payslip merge');
                    continue;
                }

                const existingClasses = normalizeJsonArray(payslip.classes);
                const existingClassStats = normalizeJsonArray(payslip.classes_stats);
                const classIndexMap = {};

                existingClasses.forEach((c) => {
                    classIndexMap[c.type] = {
                        type: c.type,
                        count: Number(c.count || 0),
                        amount: Number(c.amount || 0)
                    };
                });

                for (const [type, data] of Object.entries(dailyClassMap)) {
                    if (!classIndexMap[type]) {
                        classIndexMap[type] = { type, count: 0, amount: 0 };
                    }

                    classIndexMap[type].count += Number(data.count || 0);
                    classIndexMap[type].amount = round2(Number(classIndexMap[type].amount) + Number(data.amount || 0));
                }

                const updatedClasses = Object.values(classIndexMap);
                const classTotal = updatedClasses.reduce((s, c) => s + c.amount, 0);

                const updatedTotalAmount = round2(classTotal + Number(payslip.bonus_amount || 0) - Number(payslip.penalty_amount || 0));

                // -------------------------------
                // DAILY CLASS STATS (BY DATE)
                // -------------------------------
                const statsDate = moment.utc(start).format('YYYY-MM-DD');
                const dailyStatsList = Object.entries(dailyClassMap).map(
                    ([type, data]) => ({
                        type,
                        count: Number(data.count || 0),
                        amount: round2(Number(data.amount || 0))
                    })
                );

                const statsIndexMap = {};
                for (const entry of existingClassStats) {
                    if (!entry || !entry.date) continue;
                    statsIndexMap[entry.date] = entry;
                }

                if (!statsIndexMap[statsDate]) {
                    statsIndexMap[statsDate] = { date: statsDate, classes: [] };
                }

                const dayEntry = statsIndexMap[statsDate];
                const dayClassIndex = {};
                (Array.isArray(dayEntry.classes) ? dayEntry.classes : []).forEach((c) => {
                    if (!c || !c.type) return;
                    dayClassIndex[c.type] = {
                        type: c.type,
                        count: Number(c.count || 0),
                        amount: Number(c.amount || 0)
                    };
                });

                for (const stat of dailyStatsList) {
                    if (!dayClassIndex[stat.type]) {
                        dayClassIndex[stat.type] = { type: stat.type, count: 0, amount: 0 };
                    }
                    dayClassIndex[stat.type].count += stat.count;
                    dayClassIndex[stat.type].amount = round2(
                        Number(dayClassIndex[stat.type].amount) + stat.amount
                    );
                }

                statsIndexMap[statsDate].classes = Object.values(dayClassIndex);

                const updatedClassStats = Object.values(statsIndexMap).sort((a, b) =>
                    String(a.date).localeCompare(String(b.date))
                );

                await payslip.update(
                    {
                        classes: updatedClasses,
                        classes_stats: updatedClassStats,
                        total_amount: updatedTotalAmount
                    },
                    { transaction }
                );
            }

            // -------------------------------
            // MANUAL → AUTO SWITCH
            // -------------------------------
            const manualEnd = moment.utc(profile.manual_end_date, 'YYYY-MM-DD', true);
            if (profile.salary_mode === 'manual' && manualEnd.isValid() && moment.utc(end).isSame(manualEnd, 'day')) {
                await profile.update(
                    {
                        salary_mode: 'auto',
                        manual_start_date: null,
                        manual_end_date: null,
                        manual_hourly_rate: null
                    },
                    { silent: true, transaction }
                );

                console.log(`Manual salary ended → switched to AUTO for teacher ${profile.teacher_id}`);
            }

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            console.error(`Salary cron failed for teacher ${profile.teacher_id}`, err);
        }
    }
}

/* ---------- BONUS CRON ---------- */
async function processMonthlyTeacherBonus() {
    console.log('Monthly bonus cron started');

    // 🔒 Always target PREVIOUS month
    const month = moment.utc().subtract(1, 'month');
    const monthStart = month.clone().startOf('month').startOf('day').toDate();
    const monthEnd = month.clone().endOf('month').endOf('day').toDate();

    const profiles = await TeacherSalaryProfile.findAll();

    for (const profile of profiles) {
        const transaction = await sequelize.transaction();

        try {
            const group = await CompensationGroup.findByPk(profile.compensation_group_id, { raw: true, transaction });

            if (!group || !group.bonus_rules) {
                await transaction.rollback();
                continue;
            }

            // const rules = typeof group.bonus_rules === 'string' ? JSON.parse(group.bonus_rules) : group.bonus_rules;
            const rules = parseJSONDeep(group.bonus_rules, []);

            const activeRule = rules.find((r) => r.is_active && r.level_key === profile.current_level);

            if (!activeRule) {
                await transaction.rollback();
                continue;
            }

            /* -------------------- METRICS -------------------- */
            const monthlyLessons = await getLifetimePaidLessons(profile.teacher_id, monthStart, monthEnd, transaction);
            const lifetimeLessons = await getLifetimePaidLessonsAll(profile.teacher_id, transaction);

            const monthlyMinutes = await getMonthlyPaidMinutes(profile.teacher_id, monthStart, monthEnd, transaction);

            // const monthlyHours = monthlyMinutes / 60;
            // const normalizedMonthlyMinutes = Math.ceil(monthlyMinutes / 25) * 30;
            const monthlyHours =  Number((monthlyMinutes / 60).toFixed(2));

            const retentionRate = await calculateRetentionRate(profile.teacher_id, 3, moment.utc(monthEnd), transaction);

            /* -------------------- ELIGIBILITY -------------------- */
            // Bonus eligibility should NOT use lifetime lessons or experience months.
            const eligible =
                monthlyLessons >= activeRule.min_lifetime_lessons &&
                monthlyHours >= activeRule.min_monthly_hours &&
                retentionRate >= activeRule.min_retention_rate;

            if (!eligible) {
                await transaction.rollback();
                continue;
            }

            /* -------------------- FIND TARGET PAYSLIP -------------------- */
            let payslipWhere = {
                teacher_id: profile.teacher_id,
                status: 'draft',
                period_start: {
                    [Op.between]: [monthStart, monthEnd]
                }
            };


            // 🔑 HALF MONTHLY → apply bonus to SECOND_HALF only
            if (profile.pay_cycle === 'half_monthly') {
                payslipWhere.period_type = 'SECOND_HALF';
            } else {
                payslipWhere.period_type = 'FULL';
            }

            const payslip = await TeacherPayslip.findOne({
                where: payslipWhere,
                transaction
            });

            if (!payslip) {
                console.warn(`No target payslip found for bonus: teacher ${profile.teacher_id}`);
                await transaction.rollback();
                continue;
            }

            /* -------------------- BONUS PAYLOAD -------------------- */
            const bonusAmount = Number(activeRule.bonus_amount || 0);
            const existingBonuses = normalizeJsonArray(payslip.bonuses);

            const bonusEntry = {
                type: 'monthly_bonus',
                name: `Level Bonus – ${profile.current_level}`,
                level: profile.current_level,
                criteria: {
                    min_lifetime_lessons: activeRule.min_lifetime_lessons,
                    min_monthly_hours: activeRule.min_monthly_hours,
                    min_retention_rate: activeRule.min_retention_rate
                },
                actuals: {
                    lifetime_lessons: monthlyLessons,
                    monthly_hours: monthlyHours,
                    retention_rate: retentionRate
                },
                amount: bonusAmount,
                period: month.format('MMMM YYYY'),
                applied_at: new Date().toISOString(),
                source: 'monthly_bonus_cron'
            };

            const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

            /* ----------------------------------------------------
               ADD BONUS INTO TEACHER_EARNING_HISTORY
            ---------------------------------------------------- */
            const earningDate = moment.utc(monthEnd).format('YYYY-MM-DD');

            const [earningHistory] = await TeacherEarningHistory.findOrCreate({
                where: {
                    teacher_id: profile.teacher_id,
                    earning_date: earningDate
                },
                defaults: {
                    teacher_id: profile.teacher_id,
                    earning_date: earningDate,
                    base_rate: 0,
                    bonus_amount: 0,
                    penalty_amount: 0,
                    total_amount: 0
                },
                transaction
            });

            const updatedBonusAmounts = round2(Number(earningHistory.bonus_amount || 0) + bonusAmount);

            const updatedTotalAmounts = round2(Number(earningHistory.total_amount || 0) + bonusAmount);

            await earningHistory.update(
                {
                    bonus_amount: updatedBonusAmounts,
                    total_amount: updatedTotalAmounts
                },
                { silent: true, transaction }
            );

            /* -------------------- SALARY ADJUSTMENT -------------------- */
            await TeacherSalaryAdjustment.create(
                {
                    teacher_id: profile.teacher_id,
                    type: 'bonus',
                    applied_date: monthStart,
                    value: bonusEntry
                },
                { transaction }
            );

            /* -------------------- PAYSLIP UPDATE -------------------- */
            const updatedBonuses = [...existingBonuses, bonusEntry];
            const updatedBonusAmount = Number(payslip.bonus_amount || 0) + bonusAmount;
            const updatedTotalAmount = Number(payslip.total_amount || 0) + bonusAmount;

            await payslip.update(
                {
                    bonuses: updatedBonuses,
                    bonus_amount: updatedBonusAmount,
                    total_amount: updatedTotalAmount
                },
                { silent: true, transaction }
            );

            /* -------------------- LEVEL ELIGIBILITY -------------------- */
            // const eligibleKPIs = typeof group.eligible_kpis === 'string' ? JSON.parse(group.eligible_kpis) : group.eligible_kpis;
            const eligibleKPIs = parseJSONDeep(group.eligible_kpis, {});

            const user = await User.findByPk(profile.teacher_id, {
                attributes: ['created_at'],
                transaction
            });

            if (!user || !user.created_at) {
                await transaction.rollback();
                continue;
            }

            const joinedAt = moment.unix(user.created_at);
            const experienceMonths = moment.utc().diff(joinedAt, 'months');
            const levels = parseJSONDeep(group.levels, []);

            const eligibleLevel = resolveEligibleLevel({
                eligibleKPIs,
                levels,
                  monthlyLessons,
                  lifetimeLessons,
                  monthlyHours,
                  retentionRate,
                  experienceMonths
              });

            if (eligibleLevel) {
                const profileUpdate = {
                    eligible_level: eligibleLevel
                };

                if (!profile.level_locked && profile.current_level !== eligibleLevel) {
                    profileUpdate.current_level = eligibleLevel;
                }

                await profile.update(profileUpdate, {
                    silent: true,
                    transaction
                });
            }

            /* -------------------- ACTIVITY LOG -------------------- */
            await ActivityLog.create(
                {
                    entity_type: 'payslip',
                    entity_id: payslip.id,
                    action_type: 'payslip_bonus_applied',
                    performed_by: null,
                    before_value: {
                        bonus_amount: payslip.bonus_amount,
                        total_amount: payslip.total_amount
                    },
                    after_value: {
                        bonus_amount: updatedBonusAmount,
                        total_amount: updatedTotalAmount
                    },
                    action: {
                        teacher_id: profile.teacher_id,
                        bonus_amount: bonusAmount,
                        period: month.format('MMMM YYYY'),
                        message: 'Monthly bonus applied'
                    }
                },
                { transaction }
            );

            await transaction.commit();

            console.log(`Bonus applied → teacher ${profile.teacher_id} | amount: ${bonusAmount}`);
        } catch (err) {
            await transaction.rollback();
            console.error(`Bonus cron failed for teacher ${profile.teacher_id}`, err);
        }
    }

}

/* ---------- SCHEDULE ---------- */
// Wrap async function with error handling for processMonthlyTeacherBonus
// TESTING MODE: Running every minute - Change back to '0 6 1 * *' for production (monthly on 1st at 6 AM UTC)
cron.schedule('0 6 1 * *', async () => {
    try {
        await processMonthlyTeacherBonus();
    } catch (error) {
        console.error('[CRON ERROR] processMonthlyTeacherBonus failed:', error);
    }
}, {
    timezone: 'UTC',
    scheduled: true
});

cron.schedule('0 1 * * *', async () => {
    try {
        await processTeacherSalary();
    } catch (error) {
        console.error('[CRON ERROR] processTeacherSalary failed:', error);
    }
}, {
    timezone: 'UTC',
    scheduled: true
});

module.exports = {
    processTeacherSalary,
    processMonthlyTeacherBonus
};
