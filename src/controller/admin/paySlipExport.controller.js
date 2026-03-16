const PayslipExport = require('../../models/paySlipExport');
const TeacherPayslip = require('../../models/TeacherPaySlip');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { PDFDocument } = require('pdf-lib');
const fillPayslipPdf = require('../../utils/fillPayslippdf');
const TeacherSalaryProfile = require('../../models/teacherSalaryProfile');
const { Op } = require('sequelize');
const CompensationGroup = require('../../models/compensationgroup');


/* -------------------- TIMEZONE → CURRENCY -------------------- */
const CURRENCY_SYMBOLS = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
  JPY: "¥",
  CNY: "¥",
  PHP: "₱",
  KRW: "₩",
  IDR: "Rp",
  VND: "₫",
  THB: "฿",
  MYR: "RM",
  SGD: "$",
  HKD: "$",
  AUD: "$",
  CAD: "$",
  NZD: "$",

  CHF: "CHF",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  PLN: "zł",
  HUF: "Ft",
  CZK: "Kč",
  RON: "lei",
  BGN: "лв",

  AED: "د.إ",
  SAR: "﷼",
  QAR: "﷼",
  KWD: "د.ك",
  BHD: "د.ب",
  OMR: "ر.ع",
  ILS: "₪",
  JOD: "د.ا",

  ZAR: "R",
  NGN: "₦",
  EGP: "£",
  GHS: "₵",
  KES: "KSh",
  UGX: "USh",
  TZS: "TSh",

  BRL: "R$",
  MXN: "$",
  ARS: "$",
  CLP: "$",
  COP: "$",
  PEN: "S/",
  UYU: "$",
  BOB: "Bs",
  CRC: "₡",
  DOP: "$",
  JMD: "$",

  XOF: "CFA",
  XAF: "FCFA",
  XCD: "$",
  XPF: "₣"
};

const getCurrencySymbol = (code) =>
  CURRENCY_SYMBOLS[String(code || "USD").toUpperCase()] || code;

const DEFAULT_CURRENCY = 'USD';

const parseJson = (value, fallback = []) => {
    if (!value) return fallback;

    // already an array
    if (Array.isArray(value)) return value;

    if (typeof value === 'string') {
        try {
            let parsed = JSON.parse(value);

            // handle double-encoded JSON
            if (typeof parsed === 'string') {
                parsed = JSON.parse(parsed);
            }

            return Array.isArray(parsed) ? parsed : fallback;
        } catch (err) {
            return fallback;
        }
    }

    return fallback;
};

const bulkExportPayslips = async (req, res) => {
  try {

    const {
      month,
      period_start,
      period_end,
      teacher_id,
      salary_mode,
      compensation_group_id,
      level_locked,
      custom,
    } = req.query;
    const isCustomRange =
      custom === true || custom === "true" || custom === 1 || custom === "1";

    let monthStart;
    let monthEnd;
    let startDate;
    let endDate;

    if (period_start && period_end) {
      startDate = period_start;
      endDate = period_end;

      monthStart = new Date(period_start);
      monthEnd = new Date(period_end);

      if (Number.isNaN(monthStart.getTime()) || Number.isNaN(monthEnd.getTime())) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid period_start or period_end',
          success: false
        });
      }
    } else {
      if (!month) {
        return res.status(400).json({
          status: 'error',
          message: 'month is required',
          success: false
        });
      }

      const [year, monthStr] = month.split('-');
      const monthIndex = Number(monthStr) - 1;

      startDate = `${year}-${monthStr}-01`;
      const lastDay = new Date(year, monthIndex + 1, 0).getDate();
      endDate = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

      monthStart = new Date(`${year}-${monthStr}-01`);
      monthEnd = new Date(year, monthIndex + 1, 0);
    }

    if (isCustomRange) {
      monthStart = new Date(period_start);
      monthEnd = new Date(period_end);

      if (Number.isNaN(monthStart.getTime()) || Number.isNaN(monthEnd.getTime())) {
        return res.status(400).json({
          status: "error",
          message: "Invalid period_start or period_end",
        });
      }
    }

    /* -------------------- FILTER BUILDERS -------------------- */
    const payslipWhere = isCustomRange
      ? {
          period_start: { [Op.lte]: monthEnd },
          period_end: { [Op.gte]: monthStart },
        }
      : {
          period_start: { [Op.eq]: monthStart },
          period_end: { [Op.eq]: monthEnd },
        };

    const salaryProfileWhere = {};

    if (teacher_id) salaryProfileWhere.teacher_id = teacher_id;
    if (salary_mode) salaryProfileWhere.salary_mode = salary_mode;
    if (compensation_group_id)
      salaryProfileWhere.compensation_group_id = compensation_group_id;

    if (level_locked !== undefined && level_locked !== "") {
      salaryProfileWhere.level_locked =
        level_locked === true ||
        level_locked === "true" ||
        level_locked === 1 ||
        level_locked === "1";
    }

    /* -------------------- FETCH PAYSLIPS -------------------- */
    const payslips = await TeacherPayslip.findAll({
      where: payslipWhere,
      include: [
        {
          model: TeacherSalaryProfile,
          as: 'salary_profile',
          required: true,
          attributes: ['id', 'pay_cycle',"level_locked"],
          where: salaryProfileWhere,
          include: [
            {
              model: CompensationGroup,
              as: 'compensation_group',
              attributes: ['currency_code']
            }
          ]
        },
        {
          association: 'teacher'
        }
      ],
      order: [
        ['teacher_id', 'ASC'],
        ['period_start', 'ASC']
      ]
    });

    if (!payslips.length) {
      return res.status(404).json({
        status: 'error',
        message: 'No payslips found for the selected period',
        success: false
      });
    }

    const templatePath = path.join(__dirname, '../../templates/Blue and White Corporate Employee Payslip A4.pdf');

    /* -------------------- ZIP STREAM SETUP -------------------- */
    res.setHeader('Content-Type', 'application/zip');
    const label = new Date(startDate).toLocaleString('en-US', { month: 'long', year: 'numeric' });
    res.setHeader('Content-Disposition', `attachment; filename="Payslips_${label}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    if (isCustomRange && (!period_start || !period_end)) {
      return res.status(400).json({
        status: "error",
        message: "period_start and period_end are required for custom export",
      });
    }

    const startDateStr = isCustomRange
      ? new Date(period_start).toISOString().slice(0, 10)
      : null;
    const endDateStr = isCustomRange
      ? new Date(period_end).toISOString().slice(0, 10)
      : null;

    const isDateStrInRange = (dateStr) =>
      dateStr && startDateStr && endDateStr
        ? dateStr >= startDateStr && dateStr <= endDateStr
        : false;

    const isDateInRange = (value) => {
      if (!value) return false;
      const dateStr = new Date(value).toISOString().slice(0, 10);
      return isDateStrInRange(dateStr);
    };

    /* -------------------- GENERATE & APPEND PDFs -------------------- */
    for (const payslip of payslips) {
      const teacher = payslip.teacher;

      let classes = parseJson(payslip.classes, []);
      let penalties = parseJson(payslip.penalties, []);
      let bonuses = Number(payslip.bonus_amount || 0);

      const currencyCode =
        payslip.salary_profile?.compensation_group?.currency_code || "USD";
      const currencySymbol = getCurrencySymbol(currencyCode);

      const baseSalary = Number(payslip.base_salary || 0);
      let totalPenaltyAmount = Number(payslip.penalty_amount) || 0;
      let netSalary = Number(payslip.total_amount || 0);
      let periodLabel = `${payslip.period_start} - ${payslip.period_end}`;

      if (isCustomRange) {
        const stats = parseJson(payslip.classes_stats, []);
        const filteredStats = Array.isArray(stats)
          ? stats.filter((entry) => {
              const dateStr = entry?.date;
              if (!dateStr) return false;
              return isDateStrInRange(dateStr);
            })
          : [];

        const classTotals = {};
        filteredStats.forEach((entry) => {
          const list = Array.isArray(entry?.classes) ? entry.classes : [];
          list.forEach((cls) => {
            const key = cls?.type;
            if (!key) return;
            if (!classTotals[key]) {
              classTotals[key] = { type: key, count: 0, amount: 0 };
            }
            classTotals[key].count += Number(cls?.count || 0);
            classTotals[key].amount += Number(cls?.amount || 0);
          });
        });

        classes = Object.values(classTotals);

        const bonusesArr = parseJson(payslip.bonuses, []);
        const penaltiesArr = parseJson(payslip.penalties, []);

        const filteredBonuses = Array.isArray(bonusesArr)
          ? bonusesArr.filter((b) =>
              b?.added_at ? isDateInRange(b.added_at) : true
            )
          : [];

        const filteredPenalties = Array.isArray(penaltiesArr)
          ? penaltiesArr.filter((p) => {
              if (p?.added_at) return isDateInRange(p.added_at);
              if (p?.penalty_month) {
                const monthDateStr = `${p.penalty_month}-01`;
                return isDateStrInRange(monthDateStr);
              }
              return true;
            })
          : [];

        bonuses = filteredBonuses.reduce(
          (sum, b) => sum + Number(b.amount || 0),
          0
        );
        totalPenaltyAmount = filteredPenalties.reduce(
          (sum, p) => sum + Number(p.amount || 0),
          0
        );

        penalties = filteredPenalties;
        periodLabel = `${period_start} - ${period_end}`;
      }

      const classMap = {};
      classes.forEach((c) => {
        classMap[c.type] = {
          count: Number(c.count || 0),
          amount: Number(c.amount || 0)
        };
      });

      const classEarnings = Object.values(classMap).reduce((sum, c) => sum + Number(c.amount || 0), 0);

      const totalEarnings = baseSalary + classEarnings + bonuses;
      if (isCustomRange) {
        netSalary = totalEarnings - totalPenaltyAmount;
      }

      const pdfBuffer = await fillPayslipPdf({
        templatePath,
        data: {
          period: periodLabel,
          name: teacher?.full_name || `Teacher ${payslip.teacher_id}`,
          position: 'Teacher',

          currency_code: currencyCode,
          currency_symbol: currencySymbol,
          classes_25: classMap['25_min']?.count || 0,
          amount_25: classMap['25_min']?.amount || 0,

          classes_40: classMap['40_min']?.count || 0,
          amount_40: classMap['40_min']?.amount || 0,

          classes_50: classMap['55_min']?.count || 0,
          amount_50: classMap['55_min']?.amount || 0,

          base_salary: baseSalary,
          total_earnings: totalEarnings,
          bonuses,

          late_penalty: totalPenaltyAmount || 0,
          employee_contribution: 0,
          loans: 0,

          total_deductions: totalPenaltyAmount,
          net_salary: netSalary
        }
      });

      const filename = `Payslip_Teacher_${payslip.teacher_id}.pdf`;
      archive.append(pdfBuffer, { name: filename });
    }

    /* -------------------- FINALIZE ZIP -------------------- */
    await archive.finalize();
  } catch (error) {
    console.error('Bulk Export Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to export payslips',
      success: false
    });
  }
};

const exportSinglePayslip = async (req, res) => {
  try {
    const { id } = req.params;
    const { custom, period_start, period_end } = req.query;
    const isCustomRange =
      custom === true || custom === "true" || custom === 1 || custom === "1";

    const payslip = await TeacherPayslip.findByPk(id, {
      include: [
        {
          model: TeacherSalaryProfile,
          as: 'salary_profile',
          include: [
            {
              model: CompensationGroup,
              as: 'compensation_group',
              attributes: ['currency_code']
            }
          ]
        },
        {
          association: 'teacher'
        }
      ]
    });


    if (!payslip) {
      return res.status(404).json({
        status: 'error',
        message: 'Payslip not found'
      });
    }

    if (isCustomRange && (!period_start || !period_end)) {
      return res.status(400).json({
        status: 'error',
        message: 'period_start and period_end are required for custom export'
      });
    }

    const teacher = payslip.teacher;

    const currencyCode =
      payslip.salary_profile?.compensation_group?.currency_code || "USD";

    const currencySymbol = getCurrencySymbol(currencyCode);


    let classes = parseJson(payslip.classes, []);
    let penalties = parseJson(payslip.penalties, []);
    let bonuses = Number(payslip.bonus_amount || 0);

    const baseSalary = Number(payslip.base_salary || 0);
    let totalPenaltyAmount = Number(payslip.penalty_amount) || 0;
    let netSalary = Number(payslip.total_amount || 0);
    let periodLabel = `${payslip.period_start} - ${payslip.period_end}`;

    if (isCustomRange) {
      const startDateStr = new Date(period_start).toISOString().slice(0, 10);
      const endDateStr = new Date(period_end).toISOString().slice(0, 10);

      const isDateStrInRange = (dateStr) =>
        dateStr >= startDateStr && dateStr <= endDateStr;

      const stats = parseJson(payslip.classes_stats, []);
      const filteredStats = Array.isArray(stats)
        ? stats.filter((entry) => {
            const dateStr = entry?.date;
            if (!dateStr) return false;
            return isDateStrInRange(dateStr);
          })
        : [];

      const classTotals = {};
      filteredStats.forEach((entry) => {
        const list = Array.isArray(entry?.classes) ? entry.classes : [];
        list.forEach((cls) => {
          const key = cls?.type;
          if (!key) return;
          if (!classTotals[key]) {
            classTotals[key] = { type: key, count: 0, amount: 0 };
          }
          classTotals[key].count += Number(cls?.count || 0);
          classTotals[key].amount += Number(cls?.amount || 0);
        });
      });

      classes = Object.values(classTotals);

      const isDateInRange = (value) => {
        if (!value) return false;
        const dateStr = new Date(value).toISOString().slice(0, 10);
        return isDateStrInRange(dateStr);
      };

      const bonusesArr = parseJson(payslip.bonuses, []);
      const penaltiesArr = parseJson(payslip.penalties, []);

      const filteredBonuses = Array.isArray(bonusesArr)
        ? bonusesArr.filter((b) =>
            b?.added_at ? isDateInRange(b.added_at) : true
          )
        : [];

      const filteredPenalties = Array.isArray(penaltiesArr)
        ? penaltiesArr.filter((p) => {
            if (p?.added_at) return isDateInRange(p.added_at);
            if (p?.penalty_month) {
              const monthDateStr = `${p.penalty_month}-01`;
              return isDateStrInRange(monthDateStr);
            }
            return true;
          })
        : [];

      bonuses = filteredBonuses.reduce(
        (sum, b) => sum + Number(b.amount || 0),
        0
      );
      totalPenaltyAmount = filteredPenalties.reduce(
        (sum, p) => sum + Number(p.amount || 0),
        0
      );
      penalties = filteredPenalties;
      periodLabel = `${period_start} - ${period_end}`;
    }

    const classMap = {};
    classes.forEach((c) => {
      classMap[c.type] = {
        count: Number(c.count || 0),
        amount: Number(c.amount || 0)
      };
    });

    const classEarnings = Object.values(classMap).reduce(
      (sum, c) => sum + Number(c?.amount || 0),
      0
    );

    const totalEarnings = baseSalary + classEarnings + bonuses;
    if (isCustomRange) {
      netSalary = totalEarnings - totalPenaltyAmount;
    }


    const templatePath = path.join(
      __dirname,
      '../../templates/Blue and White Corporate Employee Payslip A4.pdf'
    );

    const pdfBuffer = await fillPayslipPdf({
      templatePath,
      data: {
        period: periodLabel,
        name: teacher?.full_name || 'Teacher',
        position: 'Teacher',

        currency_code: currencyCode,
        currency_symbol: currencySymbol,

        classes_25: classMap['25_min']?.count || 0,
        amount_25: classMap['25_min']?.amount || 0,

        classes_40: classMap['40_min']?.count || 0,
        amount_40: classMap['40_min']?.amount || 0,

        classes_50: classMap['55_min']?.count || 0,
        amount_50: classMap['55_min']?.amount || 0,



        base_salary: Number(payslip.base_salary),
        total_earnings:
          totalEarnings,
        bonuses,

        late_penalty: totalPenaltyAmount || 0,
        employee_contribution: 0,
        loans: 0,

        total_deductions: Number(totalPenaltyAmount),
        net_salary: netSalary
      }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Payslip_${payslip.teacher_id}.pdf"`
    );

    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Single payslip export error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to export payslip'
    });
  }
};

const bulkExportTeacherPayslips = async (req, res) => {
  try {
    const { teacher_id } = req.query;

    if (!teacher_id) {
      return res.status(400).json({
        status: "error",
        message: "teacher_id is required",
      });
    }

    /* -------------------- FETCH PAYSLIPS -------------------- */
    const payslips = await TeacherPayslip.findAll({
      where: { teacher_id },
      include: [
        {
          model: TeacherSalaryProfile,
          as: 'salary_profile',
          include: [
            {
              model: CompensationGroup,
              as: 'compensation_group',
              attributes: ['currency_code']
            }
          ]
        },
        {
          association: 'teacher'
        }
      ],
      order: [["period_start", "DESC"]],
    });


    if (!payslips.length) {
      return res.status(404).json({
        status: "error",
        message: "No payslips found for this teacher",
      });
    }

    const templatePath = path.join(
      __dirname,
      "../../templates/Blue and White Corporate Employee Payslip A4.pdf"
    );

    /* -------------------- ZIP STREAM SETUP -------------------- */
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Teacher_${teacher_id}_Payslips.zip"`
    );

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    /* -------------------- GENERATE & APPEND PDFs -------------------- */
    for (const payslip of payslips) {
      const teacher = payslip.teacher;

      const classes = parseJson(payslip.classes, []);
      const penalties = parseJson(payslip.penalties, []);
      const bonuses = Number(payslip.bonus_amount, []);

      const currencyCode =
        payslip.salary_profile?.compensation_group?.currency_code || "USD";

      const currencySymbol = getCurrencySymbol(currencyCode);


      const classMap = {};
      classes.forEach((c) => {
        classMap[c.type] = {
          count: Number(c.count || 0),
          amount: Number(c.amount || 0),
        };
      });

      const classEarnings = Object.values(classMap).reduce(
        (sum, c) => sum + Number(c.amount || 0),
        0
      );

      const baseSalary = Number(payslip.base_salary || 0);
      const totalEarnings = baseSalary + classEarnings + bonuses;

      const totalPenaltyAmount = Number(payslip.penalty_amount) || 0

      const pdfBuffer = await fillPayslipPdf({
        templatePath,
        data: {
          period: `${payslip.period_start} - ${payslip.period_end}`,
          name: teacher?.full_name || `Teacher ${teacher_id}`,
          position: "Teacher",

          currency_code: currencyCode,
          currency_symbol: currencySymbol,

          classes_25: classMap["25_min"]?.count || 0,
          amount_25: classMap["25_min"]?.amount || 0,

          classes_40: classMap["40_min"]?.count || 0,
          amount_40: classMap["40_min"]?.amount || 0,

          classes_50: classMap["55_min"]?.count || 0,
          amount_50: classMap["55_min"]?.amount || 0,

          base_salary: baseSalary,
          total_earnings: totalEarnings,
          bonuses,

          late_penalty: totalPenaltyAmount || 0,
          employee_contribution: 0,
          loans: 0,

          total_deductions: totalPenaltyAmount,
          net_salary: Number(payslip.total_amount || 0),
        },
      });

      const filename = `Payslip_${new Date(
        payslip.period_start
      ).toISOString().slice(0, 7)}.pdf`;

      archive.append(pdfBuffer, { name: filename });
    }

    /* -------------------- FINALIZE ZIP -------------------- */
    await archive.finalize();
  } catch (error) {
    console.error("Teacher Bulk Export Error:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to export teacher payslips",
    });
  }
};


module.exports = { bulkExportPayslips, exportSinglePayslip,bulkExportTeacherPayslips };



