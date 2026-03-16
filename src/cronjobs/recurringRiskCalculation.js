const cron = require("node-cron");
const moment = require("moment");
const { Op } = require("sequelize");
const StudentRiskHistory = require("../models/studentRiskHistory");
const StudentLabels = require("../models/studentLabels");

// Logic to assign L1–L3 based on frequency
const getRecurringLevel = (riskyDays) => {
  if (riskyDays >= 20) return "L3";
  if (riskyDays >= 10) return "L2";
  if (riskyDays > 0) return "L1";
  return null;
};

// ===============================
//  RECURRING RISK CALCULATION (02:00)
// ===============================
const runRecurringRiskCalculation = async () => {
  console.log(`🕑 [CRON] Recurring Risk Calculation started: ${moment().format("YYYY-MM-DD HH:mm:ss")}`);

  try {
    const ninetyDaysAgo = moment().subtract(90, "days").toDate();

    // Fetch all risky entries in last 90 days (orange/red/dark_red)
    const riskHistories = await StudentRiskHistory.findAll({
      where: {
        created_at: { [Op.gte]: ninetyDaysAgo },
        risk_level: { [Op.in]: ["orange", "red", "dark_red"] },
      },
    });

    // Count risky days per student
    const riskCountMap = new Map();
    for (const entry of riskHistories) {
      const studentId = entry.user_id;
      if (!riskCountMap.has(studentId)) riskCountMap.set(studentId, 0);
      riskCountMap.set(studentId, riskCountMap.get(studentId) + 1);
    }

    // Assign recurring labels
    for (const [studentId, riskyDays] of riskCountMap.entries()) {
      const recurringLevel = getRecurringLevel(riskyDays);

      if (recurringLevel) {
        await StudentLabels.upsert({
          user_id: studentId,
          label_key: "recurring_risk_level",
          label_value: recurringLevel,
          valid_until: moment().add(30, "days").toDate(),
        });
      }
    }

    console.log(`✅ [CRON] Recurring Risk Calculation completed at ${moment().format("YYYY-MM-DD HH:mm:ss")}`);
  } catch (error) {
    console.error("❌ [CRON] Error in Recurring Risk Calculation:", error);
  }
};

// Schedule daily at 02:00 AM
cron.schedule("* 2 * * *", runRecurringRiskCalculation, {
  timezone: "Asia/Kolkata",
});

module.exports = { runRecurringRiskCalculation };
