const moment = require("moment");
const RiskRule = require("../../models/riskRules");
const StudentEvent = require("../../models/student_events");

const createStudentEvent = async (req, res) => {
  try {
    const { student_id, event_type, description } = req.body;
    const createdBy = req.userId || null; // Auto from logged-in user

    // 1️⃣ Validate input
    if (!student_id || !event_type) {
      return res.status(400).json({
        success: false,
        message: "Student and Event Type are required."
      });
    }

    // 2️⃣ Fetch rule details
    const rule = await RiskRule.findOne({ where: { event_type } });
    if (!rule) {
      return res.status(404).json({
        success: false,
        message: `No rule found for event type: ${event_type}`
      });
    }

    // 3️⃣ Auto-fill points and valid_until from rule
    const points = rule.default_points || 0;
    const validUntil = rule.default_valid_days
      ? moment().add(rule.default_valid_days, "days").toDate()
      : null;

    // 4️⃣ Create event record
    const newEvent = await StudentEvent.create({
      student_id,
      event_type,
      description: description || rule.display_name,
      points,
      valid_until: validUntil,
      created_by: createdBy,
      source: "manual", // 📍 This marks it as manually created
      is_active: true
    });

    return res.status(201).json({
      success: true,
      message: "Event created successfully.",
      data: newEvent
    });
  } catch (error) {
    console.error("❌ Error creating student event:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      details: error.message
    });
  }
};

module.exports = { createStudentEvent };