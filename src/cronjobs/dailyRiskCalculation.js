const cron = require('node-cron');
const moment = require('moment');
const { Op } = require('sequelize');
const StudentEvent = require('../models/student_events');
const RiskRule = require('../models/riskRules');
const StudentRiskHistory = require('../models/studentRiskHistory');
const DailyRiskCalcLog = require('../models/daily_risk_calc_logs.model');
const { handleRiskCommunication } = require("../services/communicationService");


// Function to determine risk level based on total score
const getRiskLevel = (score) => {
    if (score >= 150) return 'dark_red';
    if (score >= 100) return 'red';
    if (score >= 50) return 'orange';
    return 'green';
};

// ===============================
//  DAILY RISK CALCULATION (06:30)
// ===============================
const runDailyRiskCalculation = async () => {
    const startTime = new Date();
    console.log(`🕕 [CRON] Daily Risk Calculation started: ${moment().format('YYYY-MM-DD HH:mm:ss')}`);

    try {
        // Fetch all active events (valid & ongoing)
        const activeEvents = await StudentEvent.findAll({
            where: {
                is_active: true,
                valid_until: { [Op.or]: [{ [Op.gte]: new Date() }, { [Op.is]: null }] }
            },
            include: [{ model: RiskRule, as: 'RiskRule' }]
        });

        console.log(`📦 Active events fetched: ${activeEvents.length}`);

        // Group events by student
        const studentMap = new Map();

        for (const event of activeEvents) {
            const studentId = event.student_id;
            const points = event.points || event.RiskRule?.default_points || 0;

            if (!studentMap.has(studentId)) studentMap.set(studentId, []);
            studentMap.get(studentId).push({
                event_id: event.id,
                event_type: event.event_type,
                points,
                created_at: event.created_at
            });
        }

        console.log(`👩‍🎓 Students with active risk events: ${studentMap.size}`);

        // 3️⃣ Loop through each student → calculate total risk & level
        let affectedCount = 0;

        // Process each student’s total risk
        for (const [studentId, events] of studentMap.entries()) {
            const totalPoints = events.reduce((sum, ev) => sum + ev.points, 0);
            const riskLevel = getRiskLevel(totalPoints);

            // Save snapshot in student_risk_history
            await StudentRiskHistory.create({
                user_id: studentId,
                risk_level: riskLevel,
                total_points: totalPoints,
                snapshot_json: JSON.stringify(events)
            });
            affectedCount++;
            // ✅ Trigger communication automation
            await handleRiskCommunication(studentId, riskLevel);
        }

        // 4️⃣ Log summary into DailyRiskCalcLogs ✅
        await DailyRiskCalcLog.create({
            run_date: new Date(),
            start_time: startTime,
            end_time: new Date(),
            total_students: studentMap.size,
            affected_students: affectedCount,
            created_events: activeEvents.length,
            job_status: 'completed',
            notes: 'Daily risk calculation completed successfully'
        });

        console.log(`✅ [CRON] Daily Risk Calculation completed at ${moment().format('YYYY-MM-DD HH:mm:ss')}`);
    } catch (error) {
        console.error('❌ [CRON] Error in Daily Risk Calculation:', error);

        // 🧾 Log the failure
        await DailyRiskCalcLog.create({
            run_date: new Date(),
            start_time: new Date(),
            end_time: new Date(),
            job_status: 'failed',
            notes: error.message
        });
    }
};

// Schedule daily at 06:30 AM
cron.schedule('30 6 * * *', runDailyRiskCalculation, {
    timezone: 'Asia/Kolkata'
});

module.exports = { runDailyRiskCalculation };
