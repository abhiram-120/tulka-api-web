const { Op } = require('sequelize');
const moment = require('moment');
const PastDuePayment = require('../../models/PastDuePayment');
const StudentEvent = require('../../models/student_events');
const RiskRule = require('../../models/riskRules');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const User = require('../../models/users');

/**
 * Helper: create a student event for risk tracking
 */
async function createRiskEvent({ studentId, eventType, description, points, validDays, source }) {
  try {
    const validUntil = validDays ? moment().add(validDays, 'days').toDate() : null;
    await StudentEvent.create({
      student_id: studentId,
      event_type: eventType,
      description: description || null,
      points,
      valid_until: validUntil,
      reported_by: 'system',
      event_source: source || 'webhook',
      is_active: true
    });
    console.log(`🧩 Risk Event created: ${eventType} for Student ${studentId} (${points} pts)`);
  } catch (err) {
    console.error('❌ Error creating Risk Event:', err.message);
  }
}

/**
 * POST /webhook/payplus
 * Unified webhook endpoint for PayPlus notifications
 */
const handlePayPlusWebhook = async (req, res) => {
  try {
    const event = req.body?.event;
    const payload = req.body?.data || {};
    if (!event) {
      return res.status(400).json({ status: 'error', message: 'Missing event type' });
    }

    console.log(`💳 [Webhook] PayPlus event received → ${event}`);

    // Find the user based on transaction / subscription info
    let userId = null;
    let user = null;

    if (payload?.user_id) {
      userId = payload.user_id;
    } else if (payload?.subscription_id) {
      const sub = await UserSubscriptionDetails.findByPk(payload.subscription_id);
      userId = sub?.user_id;
    } else if (payload?.page_request_uid) {
      const payment = await PastDuePayment.findOne({
        where: { payplus_page_request_uid: payload.page_request_uid }
      });
      userId = payment?.user_id;
    }

    if (userId) {
      user = await User.findByPk(userId);
    }

    if (!userId) {
      console.warn('⚠️ No user found for webhook payload');
    }

    // Handle PayPlus Events
    switch (event) {
      case 'charge.failed': {
        await createRiskEvent({
          studentId: userId,
          eventType: 'CHARGE_FAILED',
          description: 'Payment failed via PayPlus',
          points: 40,
          validDays: 14,
          source: 'webhook'
        });

        // Log it in PastDuePayment (optional)
        if (payload?.transaction_id) {
          await PastDuePayment.create({
            user_id: userId,
            subscription_id: payload.subscription_id || null,
            amount: payload.amount || 0,
            currency: payload.currency || 'ILS',
            failed_at: new Date(),
            due_date: moment().add(1, 'day').format('YYYY-MM-DD'),
            grace_period_expires_at: moment().add(30, 'days').toDate(),
            failure_status_code: payload.status_code || 'UNKNOWN',
            failure_message_description: payload.message || 'PayPlus charge failed',
            status: 'past_due'
          });
        }

        break;
      }

      case 'card.expiry_soon': {
        await createRiskEvent({
          studentId: userId,
          eventType: 'CC_EXP_SOON',
          description: 'Credit card expiring soon',
          points: 25,
          validDays: 15,
          source: 'webhook'
        });
        break;
      }

      case 'payment_method.changed_to_cc': {
        await createRiskEvent({
          studentId: userId,
          eventType: 'SWITCH_TO_CC',
          description: 'User switched to recurring credit card',
          points: -30,
          validDays: null,
          source: 'webhook'
        });
        break;
      }

      default:
        console.log(`ℹ️ Unhandled PayPlus event: ${event}`);
        break;
    }

    return res.status(200).json({ status: 'success', message: 'Webhook processed' });
  } catch (err) {
    console.error('❌ PayPlus Webhook error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Webhook processing failed',
      details: err.message
    });
  }
};

module.exports = { handlePayPlusWebhook };
