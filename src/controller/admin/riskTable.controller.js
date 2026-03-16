const { Op, Sequelize } = require('sequelize');
const RiskTable = require('../../models/riskTable.model');
const RiskRule = require('../../models/riskRules');
const User = require('../../models/users');
const RegularClass = require('../../models/regularClass');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const SubscriptionPlan = require('../../models/subscription_plan');
const Class = require('../../models/classes');
const SubscriptionDuration = require('../../models/subscription_duration');
const PaymentTransaction = require('../../models/PaymentTransaction');
const RiskThresholds = require('../../models/riskThresholds.model');
const moment = require('moment');

function getLastTriggerEvent(riskEvents) {
    if (!riskEvents) return null;

    let events = riskEvents;

    // ✅ Handle JSON string from DB
    if (typeof riskEvents === 'string') {
        try {
            events = JSON.parse(riskEvents);
        } catch (err) {
            console.error('❌ Failed to parse risk_events JSON', err);
            return null;
        }
    }

    if (!Array.isArray(events) || events.length === 0) return null;

    return events
        .filter(ev => ev.triggeredAt)
        .sort(
            (a, b) => new Date(b.triggeredAt) - new Date(a.triggeredAt)
        )[0] || null;
}

function normalizeRiskEvents(riskEvents) {
    if (!riskEvents) return [];

    if (Array.isArray(riskEvents)) return riskEvents;

    if (typeof riskEvents === 'string') {
        try {
            const parsed = JSON.parse(riskEvents);
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            console.error('❌ Failed to parse risk_events', err);
            return [];
        }
    }

    return [];
}

const normalizeArrayFilter = (value) => {
  return []
    .concat(value || [])
    .map(v => String(v).trim())
    .filter(Boolean); 
};

const getRiskTable = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            risk_level,
            payment_method,
            recurring_lessons,
            teacher_id,
            subscription_type,
            learningDuration,
            total_paid_min,
            total_paid_max,
            contact_status,
            rep_id,
            date_from,
            date_to
        } = req.query;

        console.log('req query', req.query);

        const numericPage = Number(page);
        const numericLimit = Number(limit);
        const offset = (numericPage - 1) * numericLimit;

        const where = {};

        /* =========================
       BASIC STRING FILTERS
    ========================= */

        const riskLevels = normalizeArrayFilter(risk_level);

        if (riskLevels.length) {
            where.risk_level = { [Op.in]: riskLevels };
        }

        if (contact_status) {
            where.contact_status = { [Op.in]: [].concat(contact_status) };
        }

        if (subscription_type) {
            where.subscription_type = { [Op.in]: [].concat(subscription_type) };
        }

        /* =========================
       PAYMENT METHOD (SPECIAL LOGIC)
    ========================= */

        if (payment_method) {
            const methods = [].concat(payment_method).map((m) => {
                if (m === 'Credit Card') return 'unknown';
                if (m === 'Bank Transfer') return 'bank_transfer';
                return m;
            });

            where.payment_method = { [Op.in]: methods };
        }

        /* =========================
       BOOLEAN FILTER
    ========================= */

        if (recurring_lessons !== undefined) {
            where.recurring_lessons = recurring_lessons === 'true';
        }
        console.log('recurring_lessons', recurring_lessons);
        console.log('recurring_lessons', where);

        /* =========================
       ID FILTERS
    ========================= */

        if (teacher_id) {
            where.teacher_id = teacher_id;
        }

        if (rep_id) {
            where.rep_id = Number(rep_id);
        }

        /* =========================
       RANGE FILTERS
    ========================= */

        let learning_duration_min;
        let learning_duration_max;

        if (learningDuration && learningDuration !== 'all') {
            if (learningDuration.includes('-')) {
                const [min, max] = learningDuration.split('-');
                learning_duration_min = Number(min);
                learning_duration_max = Number(max);
            } else if (learningDuration.endsWith('+')) {
                learning_duration_min = Number(learningDuration.replace('+', ''));
            }
        }

        if (typeof learning_duration_min === 'number' || typeof learning_duration_max === 'number') {
            where.learning_duration = {};

            if (!isNaN(learning_duration_min)) {
                where.learning_duration[Op.gte] = learning_duration_min;
            }

            if (!isNaN(learning_duration_max)) {
                where.learning_duration[Op.lte] = learning_duration_max;
            }
        }

        if (total_paid_min || total_paid_max) {
            where.total_paid = {};
            if (total_paid_min) where.total_paid[Op.gte] = Number(total_paid_min);
            if (total_paid_max) where.total_paid[Op.lte] = Number(total_paid_max);
        }

        /* =========================
       DATE FILTER
    ========================= */

        if (date_from || date_to) {
            where.added_date = {};

            if (date_from) {
                where.added_date[Op.gte] = moment.utc(date_from).startOf('day').toDate();
            }

            if (date_to) {
                where.added_date[Op.lte] = moment.utc(date_to).endOf('day').toDate();
            }
        }

        /* =========================
        FETCH DATA
        ========================= */

        /* =========================
   FETCH SALES REPS & TEACHERS
========================= */

        const salesReps = await User.findAll({
            where: {
                role_name: {
                    [Op.in]: ['sales_role', 'sales_appointment_setter']
                }
            },
            attributes: ['id', 'full_name', 'avatar'],
            raw: true
        });

        const teachersList = await User.findAll({
            where: {
                role_name: 'teacher'
            },
            attributes: ['id', 'full_name', 'avatar'],
            raw: true
        });

        console.log('where', where);

        const { rows: risks, count: totalCount } = await RiskTable.findAndCountAll({
            where,
            order: [['created_at', 'DESC']],
            limit: numericLimit,
            offset
        });

        const studentIds = risks.map((r) => r.student_id).filter(Boolean);
        const teacherIds = risks.map((r) => r.teacher_id).filter(Boolean);
        const repIds = risks.map((r) => r.rep_id).filter(Boolean);
        const normalizedSalesReps = salesReps.map((u) => ({
            id: u.id,
            name: u.full_name,
            avatar: u.avatar || null
        }));

        const normalizedTeachers = teachersList.map((u) => ({
            id: u.id,
            name: u.full_name,
            avatar: u.avatar || null
        }));

        const allUserIds = [...new Set([...studentIds, ...teacherIds, ...repIds])];

        const users = await User.findAll({
            where: {
                id: { [Op.in]: allUserIds }
            },
            attributes: ['id', 'full_name', 'email','avatar'],
            raw: true
        });

        const userMap = new Map();
        users.forEach((u) => {
            userMap.set(u.id, u);
        });

        const response = risks.map((risk) => {
            const student = userMap.get(risk.student_id) || {};
            const teacher = userMap.get(risk.teacher_id) || {};
            const rep = userMap.get(risk.rep_id) || {};

            const allRiskEvents = normalizeRiskEvents(risk.risk_events);
            const lastTrigger = getLastTriggerEvent(allRiskEvents);

            return {
                id: risk.id,

                student: {
                    id: risk.student_id,
                    name: student.full_name || 'Unknown',
                    email: student.email || '-',
                    avatar: student.avatar || null
                },

                // teacher: {
                //     name: teacher.full_name || 'No teacher'
                // },

                teacher: risk.teacher_id
                    ? {
                          id: risk.teacher_id,
                          name: teacher.full_name || 'Unknown'
                      }
                    : null,

                assigned_rep: risk.rep_id
                    ? {
                          id: risk.rep_id,
                          name: rep.full_name || 'Unknown',
                          email: rep.email || '-',
                          avatar: rep.avatar || null
                      }
                    : null,

                recurring: risk.recurring_lessons ? '🟢 Yes' : '🔴 No',

                subscription_type: risk.subscription_type,
                learning_duration: risk.learning_duration,

                payment_method: risk.payment_method === 'unknown' ? 'Credit Card' : risk.payment_method === 'bank_transfer' ? 'Bank Transfer' : risk.payment_method,

                total_paid: Number(risk.total_paid || 0),

                risk_score: risk.risk_score,
                risk_level: risk.risk_level,
                next_class_date: risk.next_class_date,

                // ✅ SEND ALL EVENTS
                risk_events: allRiskEvents.map((ev) => ({
                    event_key: ev.event_key,
                    display_name: ev.display_name,
                    points: ev.points,
                    triggered_at: ev.triggeredAt,
                    isManual: ev.isManual,
                    addedBy: ev.addedBy
                })),

                // ✅ STILL SEND LAST TRIGGER
                last_trigger: lastTrigger
                    ? {
                          event: lastTrigger.display_name,
                          points: lastTrigger.points,
                          triggered_at: lastTrigger.triggeredAt
                      }
                    : null,

                contact_status: risk.contact_status,
                added_date: risk.added_date
            };
        });

        return res.status(200).json({
            success: true,
            totalCount,
            page: numericPage,
            limit: numericLimit,
            pages: Math.ceil(totalCount / numericLimit),
            sales_reps: normalizedSalesReps,
            teachers: normalizedTeachers,
            data: response
        });
    } catch (error) {
        console.error('❌ getRiskTable error:', error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const updateContactStatus = async (req, res) => {
    try {
        const { student_id, contact_status } = req.body;

        if (!student_id || !contact_status) {
            return res.status(400).json({ success: false, message: 'Missing data' });
        }

        const record = await RiskTable.findOne({ where: { student_id } });
        if (!record) {
            return res.status(404).json({ success: false, message: 'Student not found in risk table' });
        }

        await record.update({ contact_status });
        res.status(200).json({ success: true, message: 'Contact status updated successfully' });
    } catch (error) {
        console.error('❌ Contact Status Update Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const exportRiskTableCSV = async (req, res) => {
    try {
        const risks = await RiskTable.findAll({
            order: [['created_at', 'DESC']]
        });

        if (!risks.length) {
            return res.status(404).json({ success: false, message: 'No data found' });
        }

        const headers = [
            'Student Name',
            'Email',
            'Teacher & Schedule',
            'Learning & Subscription',
            'Payments',
            'Total Risk Score',
            'Risk Level',
            'Last Trigger Event',
            'Total Events',
            'Contact Status',
            'Recurring Tag'
        ];

        const csvRows = [headers];

        for (const risk of risks) {
            const student = await User.findOne({
                where: { id: risk.student_id },
                attributes: ['id', 'full_name', 'email', 'is_parent']
            });

            const studentName = student?.full_name || 'N/A';
            const email = student?.email || 'N/A';

            const regularClass = await RegularClass.findOne({
                where: { student_id: risk.student_id },
                attributes: ['teacher_id']
            });

            let teacherSchedule = 'No fixed teacher';
            if (regularClass) {
                const teacher = await User.findOne({
                    where: { id: regularClass.teacher_id },
                    attributes: ['full_name']
                });
                teacherSchedule = `${teacher?.full_name || 'Unknown'} (🟢 Yes)`;
            } else {
                teacherSchedule = 'No fixed teacher (🔴 No)';
            }

            const subscription = await UserSubscriptionDetails.findOne({
                where: { user_id: risk.student_id },
                include: [
                    {
                        model: SubscriptionPlan,
                        as: 'SubscriptionPlan',
                        include: [
                            {
                                model: SubscriptionDuration,
                                as: 'Duration',
                                attributes: ['name', 'months']
                            }
                        ],
                        attributes: ['name', 'price']
                    }
                ]
            });

            const learningSub = subscription ? `${subscription.SubscriptionPlan?.Duration?.months || 'N/A'} months - ${subscription.SubscriptionPlan?.name || 'N/A'}` : 'N/A';

            const payments = await PaymentTransaction.findAll({
                where: { student_id: risk.student_id, status: 'success' },
                attributes: ['amount', 'payment_method']
            });

            const totalPaid = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

            let latestPaymentMethod = payments.length > 0 ? payments[0].payment_method : 'unknown';
            if (!latestPaymentMethod || latestPaymentMethod.toLowerCase() === 'unknown') {
                latestPaymentMethod = 'Credit Card';
            }

            const paymentsDisplay = `${latestPaymentMethod} / ₹${totalPaid.toFixed(2)}`;

            const riskEvents = typeof risk.risk_events === 'string' ? JSON.parse(risk.risk_events) : Array.isArray(risk.risk_events) ? risk.risk_events : [];

            const totalEvents = riskEvents.length;

            const ruleIds = riskEvents.map((ev) => ev.rule_id);
            const rules = ruleIds.length
                ? await RiskRule.findAll({
                      where: { id: ruleIds },
                      attributes: ['id', 'default_points', 'display_name']
                  })
                : [];

            const ruleMap = {};
            for (const rule of rules) ruleMap[rule.id] = rule;

            const totalScore = riskEvents.reduce((sum, ev) => {
                const points = ruleMap[ev.rule_id]?.default_points || ev.points || 0;
                return sum + points;
            }, 0);

            let riskLevel = 'green';
            if (totalScore >= 100) riskLevel = 'dark_red';
            else if (totalScore >= 70) riskLevel = 'red';
            else if (totalScore >= 40) riskLevel = 'orange';

            const sortedEvents = [...riskEvents].sort((a, b) => new Date(b.triggeredAt) - new Date(a.triggeredAt));
            const latestEvent = sortedEvents[0];
            const lastTrigger = ruleMap[latestEvent?.rule_id]?.display_name || latestEvent?.display_name || latestEvent?.event_type || 'No recent event';

            const recurringTag = risk.recurring_tag || 'N/A';
            const contactStatus = risk.contact_status || 'N/A';
            // const assignedRep = risk.assigned_rep_name || 'Unassigned';

            if (!risk.student_id) {
                console.log(`⚠️ Missing student_id for risk entry ID ${risk.id}`);
            }

            csvRows.push([
                studentName || 'N/A',
                email || 'N/A',
                teacherSchedule || 'N/A',
                learningSub || 'N/A',
                paymentsDisplay || 'N/A',
                totalScore || 0,
                riskLevel || 'green',
                lastTrigger || 'No recent event',
                totalEvents || 0,
                contactStatus || 'N/A',
                recurringTag || 'N/A'
                // assignedRep || 'Unassigned'
            ]);
        }

        const csvString = csvRows.map((r) => r.join(',')).join('\n');
        const filename = `risk-table-${moment().format('YYYY-MM-DD-HHmm')}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.send('\uFEFF' + csvString);
    } catch (error) {
        console.error('❌ CSV Export Error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const updateAssignedRep = async (req, res) => {
    try {
        const { student_id, rep_id } = req.body;

        if (!student_id) {
            return res.status(400).json({
                success: false,
                message: 'student_id is required'
            });
        }

        // If rep_id = "unassigned", turn it into NULL
        const finalRepId = rep_id === 'unassigned' || rep_id === '' || rep_id === null ? null : Number(rep_id);

        // Get risk row for student
        const riskRow = await RiskTable.findOne({
            where: { student_id }
        });

        if (!riskRow) {
            return res.status(404).json({
                success: false,
                message: 'Student not found in risk table'
            });
        }

        // Update rep_id
        await riskRow.update({ rep_id: finalRepId });

        return res.status(200).json({
            success: true,
            message: 'Assigned rep updated successfully',
            data: {
                student_id,
                rep_id: finalRepId
            }
        });
    } catch (error) {
        console.error('❌ Error updating assigned rep:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

module.exports = { getRiskTable, updateContactStatus, exportRiskTableCSV, updateAssignedRep };
