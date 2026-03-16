// controller/sales/sales-records.controller.js - Fixed without trial_payment_link_id

const { Op, Sequelize } = require('sequelize');
const moment = require('moment');
const { sequelize } = require('../../connection/connection');

// Import existing models
const PaymentTransaction = require('../../models/PaymentTransaction');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const User = require('../../models/users');
const SubscriptionPlan = require('../../models/subscription_plan');
const SubscriptionDuration = require('../../models/subscription_duration');
const LessonLength = require('../../models/lesson_length');
const LessonsPerMonth = require('../../models/lessons_per_month');
const RecurringPayment = require('../../models/RecurringPayment');
const TrialClassRegistration = require('../../models/trialClassRegistration');

/**
 * Map backend status to frontend status
 */
const mapStatusToFrontend = (backendStatus) => {
    const statusMap = {
        success: 'Paid',
        pending: 'Waiting for Payment',
        failed: 'Payment Failed',
        refunded: 'Refunded',
        cancelled: 'Canceled',
        payment_sent: 'Payment Sent'
    };
    return statusMap[backendStatus] || 'Canceled';
};

/**
 * Get sales records with filtering and pagination
 */

const getSalesRecords = async (req, res) => {
    try {
        const { page, limit, start_date, end_date, status, plan, sales_agent_id, source, payment_type, search } = req.query;

        const currentUser = req.user;
        const isAdmin = currentUser.role_name === 'admin';

        // =======================================
        // 🔍 BUILD FILTER CLAUSE
        // =======================================
        let baseWhereClause = {};

        if (!isAdmin) {
            baseWhereClause.generated_by = currentUser.id;
        }

        if (isAdmin && sales_agent_id && sales_agent_id !== 'all') {
            baseWhereClause.generated_by = sales_agent_id;
        }

        // Date range filter
        if (start_date && end_date) {
            baseWhereClause.created_at = {
                [Op.between]: [moment.utc(start_date).startOf('day').toDate(), moment.utc(end_date).endOf('day').toDate()]
            };
        }

        // Status filter
        if (status && status !== 'all') {
            const statusMap = {
                Paid: 'success',
                'Waiting for Payment': 'pending',
                'Payment Failed': 'failed',
                Refunded: 'refunded',
                Canceled: 'cancelled',
                'Payment Sent': 'payment_sent'
            };
            baseWhereClause.status = statusMap[status] || status;
        }

        // Search filter
        if (search) {
            baseWhereClause[Op.or] = [{ student_name: { [Op.like]: `%${search}%` } }, { student_email: { [Op.like]: `%${search}%` } }, { transaction_id: { [Op.like]: `%${search}%` } }];
        }

        // Payment type filter
        if (payment_type && payment_type !== 'all') {
            baseWhereClause.is_recurring = payment_type === 'Recurring';
        }

        // =======================================
        // 🧾 FETCH PAYMENT TRANSACTIONS
        // =======================================
        const { count, rows: paymentTransactions } = await PaymentTransaction.findAndCountAll({
            where: baseWhereClause,
            include: [
                {
                    model: User,
                    as: 'SalesAgent',
                    attributes: ['id', 'full_name', 'email', 'avatar'],
                    required: false
                },
                {
                    model: User,
                    as: 'StudentUser',
                    attributes: ['id', 'full_name', 'email', 'mobile'],
                    required: false
                }
            ],
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
            offset: (parseInt(page) - 1) * parseInt(limit),
            distinct: true
        });

        // Preload all related trial registrations (optimized)
        const allEmails = paymentTransactions.map((tx) => tx.student_email);
        const trialRecords = await TrialClassRegistration.findAll({
            where: { email: { [Op.in]: allEmails } },
            attributes: ['id', 'email', 'status', 'booking_type', 'family_id', 'child_id']
        });

        const trialMap = {};
        trialRecords.forEach((record) => {
            trialMap[record.email] = record.toJSON();
        });

        // =======================================
        // 🧮 TRANSFORM TRANSACTIONS
        // =======================================
        const formattedRecords = paymentTransactions.map((transaction) => {
            const txData = transaction.toJSON();

            // 💰 Parse amount safely
            let amount = 0;
            try {
                if (txData.amount !== null && txData.amount !== undefined) {
                    const parsedAmount = parseFloat(String(txData.amount));
                    amount = isNaN(parsedAmount) ? 0 : Math.round(parsedAmount * 100) / 100;
                }
            } catch {
                amount = 0;
            }

            // 👤 Sales Agent
            let salesAgentData = {
                id: txData.generated_by || 1,
                full_name: 'Unknown Agent',
                email: 'unknown@example.com',
                avatar: null
            };
            if (txData.SalesAgent) {
                salesAgentData = {
                    id: txData.SalesAgent.id,
                    full_name: txData.SalesAgent.full_name || 'Unknown Agent',
                    email: txData.SalesAgent.email || 'unknown@example.com',
                    avatar: txData.SalesAgent.avatar || null
                };
            }

            // 👩‍🎓 Student
            const studentData = txData.StudentUser || {
                full_name: txData.student_name || 'Unknown Student',
                email: txData.student_email || 'unknown@example.com',
                mobile: txData.phone_number || 'N/A'
            };

            // 🧮 Next Billing Date Calculation
            let nextBillingDate = null;
            if (txData.is_recurring) {
                const monthsToAdd = parseInt(txData.custom_months) || 1;
                nextBillingDate = moment(txData.created_at).add(monthsToAdd, 'months').startOf('day').toDate();
            }

            // 🧩 Source Detection
            let source = 'Direct Sale';
            const trialRecord = trialMap[txData.student_email];
            if (trialRecord) {
                if (trialRecord.booking_type === 'family_member' || trialRecord.family_id) {
                    source = 'Family Payment';
                } else if (['converted', 'payment_sent', 'trial_2_paid', 'trial_3_paid'].includes(trialRecord.status)) {
                    source = 'Trial Conversion';
                } else {
                    source = 'Trial Related';
                }
            }

            // 📘 Plan details
            const planDetails = {
                name: 'Custom Plan',
                lessons_per_month: parseInt(txData.lessons_per_month) || 4,
                duration: `${parseInt(txData.custom_months) || 1} month(s)`,
                type: txData.is_recurring ? 'Recurring' : 'One-time'
            };

            // 🧾 Final record
            return {
                id: txData.id.toString(),
                studentName: studentData.full_name || 'Unknown Student',
                phoneNumber: studentData.mobile || 'N/A',
                email: studentData.email || 'unknown@example.com',
                plan: {
                    name: planDetails.name,
                    lessonsPerMonth: planDetails.lessons_per_month,
                    duration: planDetails.duration,
                    type: planDetails.type
                },
                amount: amount,
                currency: txData.currency || 'ILS',
                paymentDate: txData.created_at,
                nextBillingDate: nextBillingDate ? moment(nextBillingDate).format('YYYY-MM-DD') : 'N/A',
                salesAgent: {
                    id: salesAgentData.id?.toString() || '1',
                    name: salesAgentData.full_name || 'Unknown Agent',
                    avatar: salesAgentData.avatar || null
                },
                status: mapStatusToFrontend(txData.status),
                source: source,
                paymentMethod: txData.payment_method || 'Credit Card',
                transactionId: txData.transaction_id || txData.token || 'N/A',
                subscriptionId: txData.subscription_id || null,
                createdAt: txData.created_at
            };
        });

        // =======================================
        // 📊 METRICS CALCULATION
        // =======================================
        const paidRecords = formattedRecords.filter((record) => record.status === 'Paid');
        const totalRevenue = paidRecords.reduce((sum, record) => sum + (parseFloat(record.amount) || 0), 0);
        const totalSales = paidRecords.length;

        const currentMonth = moment().month();
        const currentYear = moment().year();
        const monthlyRevenue = paidRecords
            .filter((record) => {
                try {
                    const recordDate = moment(record.paymentDate);
                    return recordDate.month() === currentMonth && recordDate.year() === currentYear;
                } catch {
                    return false;
                }
            })
            .reduce((sum, record) => sum + (parseFloat(record.amount) || 0), 0);

        // =======================================
        // ✅ RESPONSE
        // =======================================
        const response = {
            status: 'success',
            data: {
                records: formattedRecords,
                total: count,
                pages: Math.ceil(count / parseInt(limit)),
                current_page: parseInt(page),
                metrics: {
                    total_sales: totalSales,
                    total_revenue: Math.round(totalRevenue * 100) / 100,
                    monthly_revenue: Math.round(monthlyRevenue * 100) / 100
                }
            }
        };

        return res.status(200).json(response);
    } catch (error) {
        console.error('Error in getSalesRecords:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get specific sales record by ID
 */
const getSalesRecordById = async (req, res) => {
    try {
        const { id } = req.params;
        const currentUser = req.user;

        const whereClause = { id };

        if (currentUser.role_name !== 'admin') {
            whereClause.generated_by = currentUser.id;
        }

        const paymentTransaction = await PaymentTransaction.findOne({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'SalesAgent',
                    attributes: ['id', 'full_name', 'email', 'avatar'],
                    required: false
                },
                {
                    model: User,
                    as: 'StudentUser',
                    attributes: ['id', 'full_name', 'email', 'mobile'],
                    required: false
                }
            ]
        });

        if (!paymentTransaction) {
            return res.status(404).json({
                status: 'error',
                message: 'Sales record not found in payment'
            });
        }

        const txData = paymentTransaction.toJSON();

        const detailedRecord = {
            id: txData.id.toString(),
            student_name: txData.student_name || txData.StudentUser?.full_name,
            email: txData.student_email || txData.StudentUser?.email,
            phone: txData.StudentUser?.mobile,
            amount: parseFloat(txData.amount || 0),
            currency: txData.currency || 'ILS',
            payment_date: txData.created_at,
            payment_method: txData.payment_method || 'Credit Card',
            transaction_id: txData.transaction_id || txData.token,
            status: mapStatusToFrontend(txData.status),
            is_recurring: txData.is_recurring,
            lessons_per_month: txData.lessons_per_month,
            lesson_minutes: txData.lesson_minutes,
            custom_months: txData.custom_months,
            sales_agent: txData.SalesAgent,
            response_data: txData.response_data
        };

        return res.status(200).json({
            status: 'success',
            data: detailedRecord
        });
    } catch (error) {
        console.error('Error in getSalesRecordById:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Send receipt for a sales record
 */
const sendReceipt = async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;
        const currentUser = req.user;

        if (!email) {
            return res.status(400).json({
                status: 'error',
                message: 'Email is required'
            });
        }

        const whereClause = { id };

        if (currentUser.role_name !== 'admin') {
            whereClause.generated_by = currentUser.id;
        }

        const paymentTransaction = await PaymentTransaction.findOne({
            where: whereClause
        });

        if (!paymentTransaction) {
            return res.status(404).json({
                status: 'error',
                message: 'Sales record not found in reciept'
            });
        }

        // console.log(`Sending receipt for transaction ${paymentTransaction.transaction_id} to ${email}`);

        return res.status(200).json({
            status: 'success',
            message: `Receipt sent successfully to ${email}`
        });
    } catch (error) {
        console.error('Error in sendReceipt:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get sales analytics
 */
const getSalesAnalytics = async (req, res) => {
    try {
        const { start_date, end_date, sales_agent_id, group_by = 'day' } = req.query;

        const currentUser = req.user;
        const isAdmin = currentUser.role_name === 'admin';

        let whereClause = {
            status: 'success'
        };

        if (!isAdmin) {
            whereClause.generated_by = currentUser.id;
        } else if (sales_agent_id) {
            whereClause.generated_by = sales_agent_id;
        }

        if (start_date && end_date) {
            whereClause.created_at = {
                [Op.between]: [moment.utc(start_date).startOf('day').toDate(), moment.utc(end_date).endOf('day').toDate()]
            };
        }

        let dateFormat;
        switch (group_by) {
            case 'week':
                dateFormat = '%Y-%u';
                break;
            case 'month':
                dateFormat = '%Y-%m';
                break;
            default:
                dateFormat = '%Y-%m-%d';
        }

        const analytics = await PaymentTransaction.findAll({
            where: whereClause,
            attributes: [
                [Sequelize.fn('DATE_FORMAT', Sequelize.col('created_at'), dateFormat), 'period'],
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'total_sales'],
                [Sequelize.fn('SUM', Sequelize.col('amount')), 'total_revenue'],
                [Sequelize.fn('AVG', Sequelize.col('amount')), 'avg_order_value']
            ],
            group: [Sequelize.fn('DATE_FORMAT', Sequelize.col('created_at'), dateFormat)],
            order: [[Sequelize.fn('DATE_FORMAT', Sequelize.col('created_at'), dateFormat), 'ASC']]
        });

        const formattedAnalytics = analytics.map((item) => ({
            period: item.getDataValue('period'),
            total_sales: parseInt(item.getDataValue('total_sales')),
            total_revenue: parseFloat(item.getDataValue('total_revenue')),
            avg_order_value: parseFloat(item.getDataValue('avg_order_value'))
        }));

        return res.status(200).json({
            status: 'success',
            data: formattedAnalytics
        });
    } catch (error) {
        console.error('Error in getSalesAnalytics:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const exportSalesRecords = async (req, res) => {
  try {
    console.log("📦 exportSalesRecords hit ✅");

    const currentUser = req.user;
    const { start_date, end_date, status, page = 1, limit = 10 } = req.query;

    console.log("🧾 Export query params →", { start_date, end_date, status, page, limit });

    let whereClause = {};

    // Restrict non-admins to their own records
    if (currentUser.role_name !== "admin") {
      whereClause.generated_by = currentUser.id;
    }

    // Date filters
    if (start_date && end_date) {
      whereClause.created_at = {
        [Op.between]: [
          moment.utc(start_date).startOf("day").toDate(),
          moment.utc(end_date).endOf("day").toDate(),
        ],
      };
    }

    // Status filter
    if (status && status !== "all") {
      whereClause.status = status;
    }

    // Pagination setup
    const parsedLimit = Math.max(parseInt(limit) || 10, 1);
    const parsedPage = Math.max(parseInt(page) || 1, 1);
    const offset = (parsedPage - 1) * parsedLimit;

    // Fetch records
    const paymentTransactions = await PaymentTransaction.findAll({
      where: whereClause,
      include: [
        { model: User, as: "Generator", attributes: ["full_name"], required: false },
        { model: User, as: "Student", attributes: ["full_name", "email", "mobile"], required: false },
        { model: SubscriptionPlan, as: "Plan", attributes: ["name", "price"], required: false },
        { model: SubscriptionDuration, as: "Duration", attributes: ["name"], required: false },
      ],
      order: [["created_at", "DESC"]],
      limit: parsedLimit,
      offset,
    });

    if (!paymentTransactions.length) {
      return res.status(404).json({
        status: "error",
        message: "No sales records found for the given filters or page",
      });
    }

    // Map DB status → readable
    const mapStatus = {
      success: "Paid",
      failed: "Payment Failed",
      pending: "Waiting for Payment",
      refunded: "Refunded",
    };

    // Smart Source Detector (async)
    const detectSource = async (tx) => {
      try {
        const data = tx.response_data || {};

        // If explicitly from trial
        if (data.trial_id) return "Trial Conversion";
        if (data.source === "Direct Sale" || data.source === "direct") return "Direct Sale";
        if (data.source === "family") return "Family Payment";

        // Try to find a matching trial class
        const trialRecord = await TrialClassRegistration.findOne({
          where: {
            email: tx.student_email,
            status: {
              [Op.in]: ["converted", "payment_sent", "trial_2_paid", "trial_3_paid"],
            },
          },
          attributes: ["id", "status"],
        });

        if (trialRecord) return "Trial Conversion";

        return "Direct Sale";
      } catch (err) {
        console.warn("⚠️ detectSource error for tx:", tx.id, err.message);
        return "Direct Sale";
      }
    };

    // Currency formatter
    const formatCurrency = (amount, currencyCode = "ILS") => {
      try {
        return new Intl.NumberFormat("en", {
          style: "currency",
          currency: currencyCode,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(parseFloat(amount || 0));
      } catch {
        return `${currencyCode} ${parseFloat(amount || 0).toFixed(2)}`;
      }
    };

    // CSV headers
    const csvHeaders = [
      "Student",
      "Email",
      "Phone",
      "Plan Details",
      "Amount",
      "Payment Date",
      "Next Billing",
      "Sales Agent",
      "Status",
      "Source",
      "Transaction ID",
    ].join(",");

    // Build rows (async because detectSource uses DB)
    const csvRows = await Promise.all(
      paymentTransactions.map(async (tx) => {
        const t = tx.toJSON();

        // Plan details
        const planName = t.Plan?.name || "Custom Plan";
        const lessons = t.lessons_per_month ? `${t.lessons_per_month} lessons/month` : "";
        const duration = t.Duration?.name
          ? `Duration: ${t.Duration.name}`
          : t.custom_months
          ? `Duration: ${t.custom_months} month(s)`
          : "";
        const recurring = t.is_recurring ? "Recurring" : "One-time";
        const planDetails = [planName, lessons, duration, recurring].filter(Boolean).join(" • ");

        // Dates
        const paymentDate = moment(t.created_at).format("MMM DD, YYYY HH:mm");
        const nextBilling = t.is_recurring
          ? moment(t.created_at).add(1, "month").format("MMM DD, YYYY")
          : "N/A";

        // Other data
        const formattedAmount = formatCurrency(t.amount, t.currency);
        const agent = t.Generator?.full_name || "Unknown";
        const source = await detectSource(t);

        return [
          t.student_name || t.Student?.full_name || "N/A",
          t.student_email || t.Student?.email || "",
          t.Student?.mobile || "",
          planDetails,
          formattedAmount,
          paymentDate,
          nextBilling,
          agent,
          mapStatus[t.status] || t.status,
          source,
          t.transaction_id || t.token || "",
        ]
          .map((field) => `"${field}"`)
          .join(",");
      })
    );

    // Final CSV
    const csvContent = [csvHeaders, ...csvRows].join("\n");
    const filename = `sales-records-page-${page}-${moment().format("YYYY-MM-DD-HHmmss")}.csv`;
    const csvWithBOM = "\uFEFF" + csvContent;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(csvWithBOM);
  } catch (error) {
    console.error("❌ Error in exportSalesRecords:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      details: error.message,
    });
  }
};


module.exports = {
    getSalesRecords,
    getSalesRecordById,
    sendReceipt,
    getSalesAnalytics,
    exportSalesRecords
};
