const StudentCommunicationLog = require('../models/student_communication_logs.model');

async function handleRiskCommunication(studentId, riskLevel) {
    try {
        // Prevent duplicate triggers within 24 h
        const recent = await StudentCommunicationLog.findOne({
            where: {
                student_id: studentId,
                risk_level,
                created_at: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            }
        });
        if (recent) return;

        switch (riskLevel) {
            case 'orange':
                await sendWhatsAppMessage(studentId, 'orange');
                await createSupportTask(studentId, 'follow-up within 72 h');
                break;

            case 'red':
                await sendWhatsAppMessage(studentId, 'red');
                await createSupportTask(studentId, 'call same day');
                break;

            case 'dark_red':
                await createSupportTask(studentId, 'manager review / bonus offer');
                break;

            default:
                return;
        }

        await StudentCommunicationLog.create({
            student_id: studentId,
            risk_level,
            message_type: riskLevel === 'dark_red' ? 'review' : 'whatsapp',
            status: 'sent',
            notes: `Auto communication triggered for ${riskLevel}`
        });
    } catch (err) {
        console.error('❌ [COMM] Error in communication automation:', err);
        await StudentCommunicationLog.create({
            student_id: studentId,
            risk_level,
            message_type: 'system',
            status: 'failed',
            notes: err.message
        });
    }
}

// Stub: replace with Twilio/Meta API integration later
async function sendWhatsAppMessage(studentId, riskLevel) {
    console.log(`💬 Sending WhatsApp (${level}) → Student #${studentId}`);
    return true;
}

async function createSupportTask(studentId, note) {
    console.log(`🧾 Creating support task → Student #${studentId}: ${note}`);
    return true;
}

module.exports = { handleRiskCommunication, sendWhatsAppMessage, createSupportTask };
