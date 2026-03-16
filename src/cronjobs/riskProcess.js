const { Op, Sequelize } = require('sequelize');
const cron = require('node-cron');
const RiskTable = require('../models/riskTable.model');
const RiskRule = require('../models/riskRules');
const User = require('../models/users');
const RegularClass = require('../models/regularClass');
const UserSubscriptionDetails = require('../models/UserSubscriptionDetails');
const SubscriptionPlan = require('../models/subscription_plan');
const Class = require('../models/classes');
const SubscriptionDuration = require('../models/subscription_duration');
const PaymentTransaction = require('../models/PaymentTransaction');
const RiskThresholds = require('../models/riskThresholds.model');
const moment = require('moment');
const { sequelize } = require('../connection/connection');

async function getPrimaryTeacherId(studentId, transaction) {
    const rows = await Class.findAll({
        where: { student_id: studentId },
        attributes: ['teacher_id', [sequelize.fn('COUNT', sequelize.col('teacher_id')), 'class_count']],
        group: ['teacher_id'],
        order: [[sequelize.literal('class_count'), 'DESC']],
        limit: 1,
        raw: true,
        transaction
    });

    return rows.length ? rows[0].teacher_id : null;
}

async function getLatestActiveSubscription(studentId, transaction) {
    return UserSubscriptionDetails.findOne({
        where: {
            user_id: studentId,
            status: 'active'
        },
        order: [['created_at', 'DESC']],
        raw: true,
        transaction
    });
}

async function resolvePaymentMethod(studentId, transaction) {
    const payment = await PaymentTransaction.findOne({
        where: {
            student_id: studentId,
            status: 'success'
        },
        order: [['created_at', 'DESC']],
        attributes: ['payment_method'],
        raw: true,
        transaction
    });

    return payment?.payment_method || 'bank_transfer';
}

async function getLearningDurationMonths(studentId, transaction) {
    const firstSub = await UserSubscriptionDetails.findOne({
        where: { user_id: studentId },
        order: [['created_at', 'ASC']],
        attributes: ['created_at'],
        raw: true,
        transaction
    });

    if (!firstSub) return null;

    return moment().diff(moment(firstSub.created_at), 'months');
}
 
async function getTotalPaidAmount(studentId, transaction) {
    const result = await PaymentTransaction.findAll({
        where: {
            student_id: studentId,
            status: 'success'
        },
        attributes: [
            'amount',
            'refund_amount',
            'refund_type'
        ],
        raw: true,
        transaction
    });

    if (!result.length) return 0;

    let total = 0;

    for (const tx of result) {
        const amount = Number(tx.amount) || 0;
        const refundAmount = Number(tx.refund_amount) || 0;

        if (tx.refund_type === 'full') {
            continue; // fully refunded → ignore payment
        }

        if (tx.refund_type === 'partial') {
            total += Math.max(amount - refundAmount, 0);
        } else {
            total += amount;
        }
    }

    return Number(total.toFixed(2));
}

async function hasRecurringLessons(studentId, startOfMonth, endOfMonth, transaction) {
    const count = await Class.count({
        where: {
            student_id: studentId,
            meeting_start: {
                [Op.between]: [startOfMonth, endOfMonth]
            }
        },
        transaction
    });

    return count > 1;
}

async function resolveStudentRiskContext(studentId, startOfMonth, endOfMonth, transaction) {
    const [teacher_id, subscription, payment_method, learning_duration, recurring_lessons,total_paid,next_class_date] = await Promise.all([
        getPrimaryTeacherId(studentId, transaction),
        getLatestActiveSubscription(studentId, transaction),
        resolvePaymentMethod(studentId, transaction),
        getLearningDurationMonths(studentId, transaction),
        hasRecurringLessons(studentId, startOfMonth, endOfMonth, transaction),
        getTotalPaidAmount(studentId, transaction),
        getNextClassDate(studentId, transaction)
    ]);

    return {
        teacher_id,
        subscription_type: subscription?.type || null,
        payment_method,
        learning_duration,
        recurring_lessons,
        total_paid,
        next_class_date
    };
}

async function checkMissedClassesYesterday(studentId, startOfDay, endOfDay, transaction) {
    // Fetch missed classes (is_present = 0) for yesterday only
    const missed = await Class.count({
        where: {
            student_id: studentId,
            is_present: 0,
            meeting_start: {
                [Op.between]: [startOfDay, endOfDay]
            }
        },
        transaction
    });

    if (!missed || missed <= 0) return [];

    const events = [];
    const dayKey = moment(startOfDay).format('YYYYMMDD');

    // One event per missed class for the day
    for (let i = 1; i <= missed; i++) {
        events.push(buildEvent(`missed_${studentId}_${dayKey}_${i}`, 'Missed Class (Yesterday)', 5));
    }

    return events;
}

async function checkMonthlyConsecutiveMissed(studentId, startOfMonth, endOfMonth, transaction) {
    const classes = await Class.findAll({
        where: {
            student_id: studentId,
            meeting_start: {
                [Op.between]: [startOfMonth, endOfMonth]
            }
        },
        attributes: ['is_present', 'meeting_start'],
        order: [['meeting_start', 'ASC']],
        raw: true,
        transaction
    });

    if (!classes.length) return [];

    let streak = 0;
    let maxStreak = 0;

    for (let i = 0; i < classes.length; i++) {
        const missed = Number(classes[i].is_present) === 0;
        if (missed) {
            streak++;
            if (streak > maxStreak) maxStreak = streak;
        } else {
            streak = 0;
        }
    }

    const monthKey = moment(startOfMonth).format('YYYYMM');

    if (maxStreak >= 3) {
        return [buildEvent(`month_streak3_${studentId}_${monthKey}`, 'Missed 3+ Consecutive Classes (Prev Month)', 20)];
    }
    if (maxStreak === 2) {
        return [buildEvent(`month_streak2_${studentId}_${monthKey}`, 'Missed 2 Consecutive Classes (Prev Month)', 10)];
    }

    return [];
}

async function checkUnusedLessons(studentId, transaction) {
    // Fetch active subscription with left lessons
    const sub = await UserSubscriptionDetails.findOne({
        where: {
            user_id: studentId,
            status: 'active',
            left_lessons: { [Op.gt]: 0 }
        },
        attributes: ['left_lessons'],
        raw: true,
        transaction
    });

    if (!sub || !sub.left_lessons) return [];

    const unused = Number(sub.left_lessons);

    if (unused > 16) {
        return [buildEvent(`unused_${studentId}`, 'Unused lessons > 16', 10)];
    }

    return [];
}

async function getNextClassDate(studentId, transaction) {
    const nextClass = await Class.findOne({
        where: {
            student_id: studentId,
            status: {
                [Op.notIn]: ['cancelled', 'canceled']
            },
            meeting_start: {
                [Op.gt]: new Date()
            }
        },
        order: [['meeting_start', 'ASC']],
        attributes: ['meeting_start'],
        raw: true,
        transaction
    });

    return nextClass?.meeting_start || null;
}


async function checkNoScheduleThisMonth(studentId, startOfMonth, endOfMonth, transaction) {
    // 1️⃣ Check if student has a regular schedule at all
    const regular = await RegularClass.findOne({
        where: { student_id: studentId },
        attributes: ['id'],
        raw: true,
        transaction
    });

    if (!regular) return []; // no regular schedule → rule doesn't apply

    // 2️⃣ Count scheduled/pending classes in current month
    const scheduledCount = await Class.count({
        where: {
            student_id: studentId,
            status: { [Op.in]: ['pending', 'scheduled'] },
            meeting_start: { [Op.between]: [startOfMonth, endOfMonth] }
        },
        transaction
    });

    // 3️⃣ If none scheduled this month → +60 points (one event)
    if (scheduledCount === 0) {
        return [buildEvent(`noschedule_${studentId}`, 'No scheduled classes this month', 60)];
    }

    return [];
}

async function checkBankMethod(studentId, startOfMonth, endOfMonth, transaction) {
    const payments = await PaymentTransaction.findAll({
        where: {
            student_id: studentId,
            status: 'success',
            created_at: {
                [Op.between]: [startOfMonth, endOfMonth]
            }
        },
        attributes: ['id', 'payment_method', 'is_recurring', 'created_at'],
        raw: true,
        transaction
    });

    if (!payments.length) return [];

    const events = [];

    for (const payment of payments) {
        const method = (payment.payment_method || '').toLowerCase();
        const isOneTime = payment.is_recurring === false;

        if (method.includes('bank') || isOneTime) {
            events.push(
                buildEvent(
                    `bankmethod_${studentId}_${payment.id}`, // 🔑 UNIQUE
                    'Bank transfer / one-time payment used',
                    20,
                    {
                        payment_id: payment.id,
                        date: payment.created_at
                    }
                )
            );
        }
    }

    return events;
}

function buildEvent(event_key, display_name, points) {
    return {
        event_key,
        display_name,
        points,
        triggeredAt: new Date()
    };
}

async function checkFailedPayments(studentId, startOfMonth, endOfMonth, transaction) {
    // Count failed payments for this student this month
    const result = await PaymentTransaction.count({
        where: {
            student_id: studentId,
            status: 'failed',
            created_at: { [Op.between]: [startOfMonth, endOfMonth] }
        },
        transaction
    });

    // Condition: Must be 3 or more
    if (result >= 3) {
        return [buildEvent(`payfail3_${studentId}`, 'Payment failed 3+ times this month', 10)];
    }

    return []; // no events
}

const runDailyMissedClassRisk = async () => {
    console.log('runDailyMissedClassRisk');
    try {
        const startOfDay = moment().subtract(1, 'day').startOf('day').toDate();
        const endOfDay = moment().subtract(1, 'day').endOf('day').toDate();

        const students = await User.findAll({
            attributes: ['id', 'full_name', 'avatar', 'is_parent'],
            where: { role_name: 'user' },
            raw: true
        });

        let totalProcessed = 0;
        let totalTriggered = 0;

        for (const student of students) {
            const studentId = student.id;

            await sequelize.transaction(async (transaction) => {
                const existing = await RiskTable.findOne({
                    where: { student_id: studentId },
                    raw: true,
                    transaction
                });
                let prevEvents = [];
                if (existing?.risk_events) {
                    try {
                        prevEvents = Array.isArray(existing.risk_events) ? existing.risk_events : JSON.parse(existing.risk_events);
                    } catch {
                        prevEvents = [];
                    }
                }

                const missedClassEvents = await checkMissedClassesYesterday(studentId, startOfDay, endOfDay, transaction);
                const newEvents = missedClassEvents.filter((ev) => !prevEvents.some((prev) => prev.event_key === ev.event_key));

                if (newEvents.length === 0) return;

                totalTriggered += newEvents.length;
                totalProcessed++;

                const mergedEvents = [...prevEvents, ...newEvents];
                const risk_score = mergedEvents.reduce((sum, ev) => sum + (Number(ev.points) || 0), 0);

                let risk_level = 'low';
                if (risk_score >= 100) risk_level = 'critical';
                else if (risk_score >= 70) risk_level = 'high';
                else if (risk_score >= 40) risk_level = 'medium';

                const context = await resolveStudentRiskContext(studentId, startOfDay, endOfDay, transaction);

                await RiskTable.upsert(
                    {
                        student_id: studentId,
                        student_name: student.full_name,
                        student_avatar: student.avatar,
                        is_family: student.is_parent ? 1 : 0,

                        teacher_id: context.teacher_id,
                        subscription_type: context.subscription_type,
                        payment_method: context.payment_method,
                        learning_duration: context.learning_duration,
                        recurring_lessons: context.recurring_lessons,
                        total_paid: context.total_paid,
                        next_class_date: context.next_class_date,

                        risk_score,
                        risk_level,
                        risk_events: mergedEvents,
                        updated_at: new Date()
                    },
                    { conflictFields: ['student_id'], transaction }
                );
            });
        }

        return {
            success: true,
            message: 'Daily missed class risk evaluation completed',
            totalProcessed,
            totalTriggered
        };
    } catch (err) {
        console.error('❌ Daily Missed Class Risk Error:', err);
    }
};

const runMonthlyRiskChecks = async () => {
    console.log('runMonthlyRiskChecks');
    try {
        const startOfPrevMonth = moment().subtract(1, 'month').startOf('month').toDate();
        const endOfPrevMonth = moment().subtract(1, 'month').endOf('month').toDate();
        const startOfMonth = moment().startOf('month').toDate();
        const endOfMonth = moment().endOf('month').toDate();

        const students = await User.findAll({
            attributes: ['id', 'full_name', 'avatar', 'is_parent'],
            where: { role_name: 'user' },
            raw: true
        });

        let totalProcessed = 0;
        let totalTriggered = 0;

        for (const student of students) {
            const studentId = student.id;

            await sequelize.transaction(async (transaction) => {
                const existing = await RiskTable.findOne({
                    where: { student_id: studentId },
                    raw: true,
                    transaction
                });
                let prevEvents = [];
                if (existing?.risk_events) {
                    try {
                        prevEvents = Array.isArray(existing.risk_events) ? existing.risk_events : JSON.parse(existing.risk_events);
                    } catch {
                        prevEvents = [];
                    }
                }

                const failedPayEvents = await checkFailedPayments(studentId, startOfPrevMonth, endOfPrevMonth, transaction);
                const monthlyStreakEvents = await checkMonthlyConsecutiveMissed(studentId, startOfPrevMonth, endOfPrevMonth, transaction);
                const unusedEvents = await checkUnusedLessons(studentId, transaction);
                const noScheduleEvents = await checkNoScheduleThisMonth(studentId, startOfMonth, endOfMonth, transaction);
                const bankMethodEvents = await checkBankMethod(studentId, startOfPrevMonth, endOfPrevMonth, transaction);

                const monthKey = moment(startOfPrevMonth).format('YYYYMM');
                const monthEvents = [
                    ...failedPayEvents.map((ev) => ({ ...ev, event_key: `${ev.event_key}_${monthKey}` })),
                    ...monthlyStreakEvents,
                    ...unusedEvents.map((ev) => ({ ...ev, event_key: `${ev.event_key}_${monthKey}` })),
                    ...noScheduleEvents.map((ev) => ({ ...ev, event_key: `${ev.event_key}_${moment(startOfMonth).format('YYYYMM')}` })),
                    ...bankMethodEvents.map((ev) => ({ ...ev, event_key: `${ev.event_key}_${monthKey}` }))
                ];

                const newEvents = monthEvents.filter((ev) => !prevEvents.some((prev) => prev.event_key === ev.event_key));

                if (newEvents.length === 0) return;

                totalTriggered += newEvents.length;
                totalProcessed++;

                const mergedEvents = [...prevEvents, ...newEvents];
                const risk_score = mergedEvents.reduce((sum, ev) => sum + (Number(ev.points) || 0), 0);

                let risk_level = 'low';
                if (risk_score >= 100) risk_level = 'critical';
                else if (risk_score >= 70) risk_level = 'high';
                else if (risk_score >= 40) risk_level = 'medium';

                const context = await resolveStudentRiskContext(studentId, startOfMonth, endOfMonth, transaction);

                await RiskTable.upsert(
                    {
                        student_id: studentId,
                        student_name: student.full_name,
                        student_avatar: student.avatar,
                        is_family: student.is_parent ? 1 : 0,

                        teacher_id: context.teacher_id,
                        subscription_type: context.subscription_type,
                        payment_method: context.payment_method,
                        learning_duration: context.learning_duration,
                        recurring_lessons: context.recurring_lessons,
                        total_paid: context.total_paid,
                        next_class_date: context.next_class_date,

                        risk_score,
                        risk_level,
                        risk_events: mergedEvents,
                        updated_at: new Date()
                    },
                    { conflictFields: ['student_id'], transaction }
                );
            });
        }

        return {
            success: true,
            message: 'Monthly risk checks completed',
            totalProcessed,
            totalTriggered
        };
    } catch (err) {
        console.error('❌ Monthly Risk Checks Error:', err);
    }
};

// Daily missed class risk (yesterday)
cron.schedule('15 10 * * *', runDailyMissedClassRisk, {
    timezone: 'UTC'
});

// Monthly checks: first day of month
cron.schedule('45 10 1 * *', runMonthlyRiskChecks, {
    timezone: 'UTC'
});
