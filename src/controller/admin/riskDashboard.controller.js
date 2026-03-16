const { Op } = require("sequelize");
const moment = require("moment");
const StudentRiskHistory = require("../../models/studentRiskHistory");
const StudentEvents = require("../../models/student_events");
const StudentLabels = require("../../models/studentLabels");
const RiskRules = require("../../models/riskRules");
const CancelReason = require("../../models/cancelReason"); 
const Student = require("../../models/users"); 

const getRiskDashboard = async (req, res) => {
  try {
    const {
      risk_level,
      payment_type,
      no_recurring,
      failed_charge,
      recurring_tag,
      page = 1,
      limit = 10,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // ==========================
    // 1️⃣ Base Query Conditions
    // ==========================
    const whereConditions = {};

    if (risk_level && risk_level !== "all") {
      whereConditions.risk_level = risk_level;
    }

    // ==========================
    // 2️⃣ Get Latest Risk Snapshot
    // ==========================
    const riskSnapshots = await StudentRiskHistory.findAll({
      where: whereConditions,
      include: [
        {
          model: Student,
          as: "Student",
          attributes: ["id", "full_name", "email", "payment_type", "is_recurring"],
          where: {
            ...(payment_type && payment_type !== "all" && { payment_type }),
            ...(no_recurring === "true" && { is_recurring: false }),
            ...(failed_charge === "true" && { payment_status: "failed" }),
          },
        },
        {
          model: StudentLabels,
          as: "Labels",
          attributes: ["label_key", "label_value"],
          required: false,
        },
      ],
      order: [["created_at", "DESC"]],
      limit: parseInt(limit),
      offset,
    });

    if (!riskSnapshots.length) {
      return res.status(200).json({ success: true, data: [] });
    }

    // ==========================
    // 3️⃣ Prepare Result Data
    // ==========================
    const studentIds = riskSnapshots.map((r) => r.user_id);

    // Fetch Active Events for each student
    const activeEvents = await StudentEvents.findAll({
      where: {
        student_id: { [Op.in]: studentIds },
        is_active: true,
        valid_until: { [Op.or]: [{ [Op.gte]: new Date() }, { [Op.is]: null }] },
      },
      include: [
        { model: RiskRules, as: "RiskRule", attributes: ["display_name"] },
      ],
      order: [["created_at", "DESC"]],
    });

    // Group active events per student
    const eventMap = {};
    for (const ev of activeEvents) {
      const sid = ev.student_id;
      if (!eventMap[sid]) eventMap[sid] = [];
      eventMap[sid].push(ev.RiskRule?.display_name || ev.event_type);
    }

    // ==========================
    // 4️⃣ Transform Final Output
    // ==========================
    const getSuggestedAction = (riskLevel) => {
      switch (riskLevel?.toLowerCase()) {
        case "orange": return "Auto WhatsApp + Rep follow-up (72h)";
        case "red": return "Personal call same day";
        case "dark_red": return "Manager review + pause/bonus lesson";
        default: return "Normal";
      }
    };

    const result = riskSnapshots.map((r) => {
      const label = r.Labels?.find((l) => l.label_key === "recurring_risk_level");
      const lastEvent = eventMap[r.user_id]?.[0] || "N/A";
      const activeEventList = eventMap[r.user_id]?.join(" | ") || "None";

      return {
        student_name: r.Student?.full_name || "N/A",
        total_risk_score: r.total_points || 0,
        risk_level: r.risk_level || "green",
        last_trigger: lastEvent,
        active_events: activeEventList,
        recurring_risk_tag: label ? label.label_value : "None",
        suggested_action: getSuggestedAction(r.risk_level),
      };
    });

    // ==========================
    // 5️⃣ Filter Recurring Tag (if provided)
    // ==========================
    const filteredResult =
      recurring_tag && recurring_tag !== "all"
        ? result.filter((r) => r.recurring_risk_tag === recurring_tag)
        : result;

    // ==========================
    // 6️⃣ Return Final Response
    // ==========================
    return res.status(200).json({
      success: true,
      data: filteredResult,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: filteredResult.length,
      },
    });
  } catch (error) {
    console.error("❌ Error in getRiskDashboard:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      details: error.message,
    });
  }
};

module.exports = { getRiskDashboard };
