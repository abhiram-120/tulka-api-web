const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const formatMoney = (value, currencyCode = '') => {
  const amount = Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  return currencyCode ? `${currencyCode} ${amount}` : amount;
};

const fillPayslipPdf = async ({ templatePath, data }) => {
  const existingPdfBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(existingPdfBytes);
  const currencyCode = data.currency_code || '';

  const page = pdfDoc.getPages()[0];

  // Fonts
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const drawText = (text, x, y, { size = 12, bold = false, align = 'left' } = {}) => {
    const font = bold ? fontBold : fontRegular;
    const value = String(text ?? '');
    let drawX = x;

    if (align === 'right') {
      drawX = x - font.widthOfTextAtSize(value, size);
    }

    page.drawText(value, {
      x: drawX,
      y,
      size,
      font,
      color: rgb(0, 0, 0)
    });
  };

  /* ================= HEADER ================= */
  drawText(data.period, 215, 658, { size: 13 });
  drawText(data.name, 215, 633, { size: 14, bold: true });
  drawText(data.position, 215, 608, { size: 12 });

  /* ================= EARNINGS ================= */
  const CENTER_X = 285;
  const AMOUNT_X = 500;

  drawText(String(data.classes_25 || 0), CENTER_X, 525, { size: 11, align: 'center' });
  drawText(formatMoney(data.amount_25, currencyCode), AMOUNT_X, 525, { size: 11, align: 'right' });

  drawText(String(data.classes_40 || 0), CENTER_X, 505, { size: 11, align: 'center' });
  drawText(formatMoney(data.amount_40, currencyCode), AMOUNT_X, 505, { size: 11, align: 'right' });

  drawText(String(data.classes_50 || 0), CENTER_X, 485, { size: 11, align: 'center' });
  drawText(formatMoney(data.amount_50, currencyCode), AMOUNT_X, 485, { size: 11, align: 'right' });

  drawText(formatMoney(data.bonuses, currencyCode), AMOUNT_X, 465, {
    size: 11,
    align: 'right'
  });

  drawText(formatMoney(data.base_salary, currencyCode), AMOUNT_X, 442, {
    size: 12,
    align: 'right'
  });

  drawText(formatMoney(data.total_earnings, currencyCode), AMOUNT_X, 407, {
    size: 14,
    bold: true,
    align: 'right'
  });
  

  /* ================= DEDUCTIONS ================= */
  drawText(formatMoney(data.late_penalty, currencyCode), AMOUNT_X, 340, { size: 12, align: 'right' });
  // drawText(formatMoney(data.employee_contribution, currencyCode), AMOUNT_X, 320, { size: 12, align: 'right' });
  // drawText(formatMoney(data.loans, currencyCode), AMOUNT_X, 295, { size: 12, align: 'right' });

  drawText(formatMoney(data.total_deductions, currencyCode), AMOUNT_X, 300, {
    size: 14,
    bold: true,
    align: 'right'
  });

  /* ================= NET SALARY ================= */
  drawText(formatMoney(data.net_salary, currencyCode), AMOUNT_X, 200, {
    size: 18,
    bold: true,
    align: 'right'
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes); // ✅ THIS IS THE KEY FIX
};

module.exports = fillPayslipPdf;
