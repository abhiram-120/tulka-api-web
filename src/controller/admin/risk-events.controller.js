// controllers/events.controller.js
const ManualEventLog = require('../../models/manual_event_logs.model');
const StudentEvent = require('../../models/student_events');
const RiskTable = require('../../models/riskTable.model');
const RiskRule = require('../../models/riskRules');
const RiskThresholds = require('../../models/riskThresholds.model');

const createManualEvent = async (req, res) => {
    try {
        const { student_id, event_type, description, points, impact_level, valid_until } = req.body;
        const created_by = req.user.role_name;

        if (!student_id || !event_type || !description || !points || !impact_level || !valid_until) {
            return res.status(400).json({ success: false, data: "Please provide all the details" });
        }

        // 1️⃣ Create manual event entry
        const event = await StudentEvent.create({
            user_id: Number(student_id),
            event_type,
            description,
            points,
            valid_until,
            reported_by: created_by,
            event_source: "manual"
        });

        // 2️⃣ Log entry
        await ManualEventLog.create({
            event_id: event.id,
            student_id,
            event_type,
            created_by,
            action: "create",
            new_data: event.toJSON()
        });

        // 3️⃣ Fetch or create the student's risk record
        const riskRecord = await RiskTable.findOne({ where: { student_id } });

        if (!riskRecord) {
            console.warn(`⚠️ No risk_table record found for student_id ${student_id}`);
            return res.status(201).json({ success: true, event });
        }

        // Parse current risk events
        const currentEvents = Array.isArray(riskRecord.risk_events)
            ? riskRecord.risk_events
            : typeof riskRecord.risk_events === "string"
            ? JSON.parse(riskRecord.risk_events)
            : [];

        // Avoid duplicates
        const manualRuleId = `manual-${Date.now()}`;
        const newEvent = {
            rule_id: manualRuleId,
            triggeredAt: new Date().toISOString(),
            isManual: true,
            addedBy: created_by,
            points: Number(points),
            impact_level,
            display_name: description?.slice(0, 50) || event_type,
            event_type
        };

        const updatedEvents = [...currentEvents, newEvent];

        // 4️⃣ Get thresholds
        let thresholds = await RiskThresholds.findOne({ order: [["id", "DESC"]] });
        thresholds = thresholds
            ? thresholds.get({ plain: true })
            : { critical: 100, high: 70, medium: 40, low: 20 };

        const { critical, high, medium } = thresholds;

        // 5️⃣ Update risk score
        const newRiskScore = (riskRecord.risk_score || 0) + Number(points);

        // Determine level
        let newRiskLevel = "low";
        if (newRiskScore >= critical) newRiskLevel = "critical";
        else if (newRiskScore >= high) newRiskLevel = "high";
        else if (newRiskScore >= medium) newRiskLevel = "medium";

        // 6️⃣ Save updated risk table
        await riskRecord.update({
            risk_events: updatedEvents,
            risk_score: newRiskScore,
            risk_level: newRiskLevel
        });

        console.log(`✅ Risk events updated for student ${student_id}. Score: ${newRiskScore}`);

        return res.status(201).json({
            success: true,
            event,
            updated_risk: {
                risk_score: newRiskScore,
                risk_level: newRiskLevel,
                risk_events: updatedEvents
            }
        });
    } catch (error) {
        console.error("🧨 Manual Event Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { createManualEvent };
