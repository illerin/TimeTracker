'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

function money(value) {
  return `$${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function hours(value) {
  const rounded = Math.round(Number(value || 0) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function timeCell(value) {
  return Number(value || 0) === 0 ? '' : value;
}

function profileLines(profile) {
  if (!profile) return [];
  return String(profile.details || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function projectTotal(invoice, projectName) {
  return invoice.lines.reduce((sum, line) => sum + (line.hoursByProject[projectName] || 0), 0);
}

function invoiceTotalHours(invoice) {
  return invoice.projects.reduce((sum, project) => sum + projectTotal(invoice, project.name), 0);
}

function invoiceTotalFee(invoice) {
  return invoice.projects.reduce((sum, project) => {
    return sum + projectTotal(invoice, project.name) * Number(project.hourly_rate || 0);
  }, 0);
}

function invoiceExpenseTotal(invoice) {
  return (invoice.expenses || []).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
}

function invoiceGrandTotal(invoice) {
  return invoiceTotalFee(invoice) + invoiceExpenseTotal(invoice);
}

function shouldShowGrandTotal(invoice) {
  return invoiceTotalFee(invoice) > 0 && invoiceExpenseTotal(invoice) > 0;
}

function usesStandardRate(invoice) {
  return invoice.rate_mode === 'standard';
}

function invoiceRate(invoice) {
  if (Number.isFinite(Number(invoice.standard_rate))) return Number(invoice.standard_rate);
  return Number(invoice.projects?.[0]?.hourly_rate || 0);
}

function addMetaRows(sheet, invoice) {
  sheet.addRow(['INVOICE #: ', invoice.number || '']);
  sheet.addRow(['DATE:', invoice.date || '']);
  sheet.addRow([]);
  sheet.addRow(['TO:', invoice.to?.label || '']);
  for (const line of profileLines(invoice.to)) sheet.addRow(['', line]);
  sheet.addRow([]);
  sheet.addRow(['FROM:', invoice.from?.label || '']);
  for (const line of profileLines(invoice.from)) sheet.addRow(['', line]);
  sheet.addRow([]);
}

async function generateInvoiceXlsx(invoice) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Invoice');

  addMetaRows(sheet, invoice);
  sheet.addRow(['DATE', 'DESCRIPTION', ...invoice.projects.map(p => p.name)]);

  for (const line of invoice.lines) {
    sheet.addRow([
      line.date,
      line.description,
      ...invoice.projects.map(project => timeCell(line.hoursByProject[project.name]))
    ]);
  }

  sheet.addRow([]);
  sheet.addRow(['TOTAL HOURS BY PROJECT', '', ...invoice.projects.map(p => projectTotal(invoice, p.name))]);
  if (!usesStandardRate(invoice)) {
    sheet.addRow(['RATE', '', ...invoice.projects.map(p => Number(p.hourly_rate || 0))]);
    sheet.addRow(['TOTAL FEE', '', ...invoice.projects.map(p => projectTotal(invoice, p.name) * Number(p.hourly_rate || 0))]);
  }
  if ((invoice.expenses || []).length > 0) {
    sheet.addRow([]);
    sheet.addRow(['EXPENSES']);
    sheet.addRow(['DATE', 'PROJECT', 'DESCRIPTION', 'AMOUNT']);
    for (const expense of invoice.expenses) {
      sheet.addRow([expense.date, expense.project, expense.description, Number(expense.amount || 0)]);
    }
    sheet.addRow(['TOTAL EXPENSES', invoiceExpenseTotal(invoice)]);
  }
  sheet.addRow([]);
  sheet.addRow(['TOTAL HOURS THIS PERIOD', invoiceTotalHours(invoice)]);
  if (usesStandardRate(invoice)) {
    sheet.addRow(['RATE', invoiceRate(invoice)]);
  }
  sheet.addRow(['TOTAL FEE THIS PERIOD', invoiceTotalFee(invoice)]);
  if (shouldShowGrandTotal(invoice)) {
    sheet.addRow(['GRAND TOTAL THIS PERIOD', invoiceGrandTotal(invoice)]);
  }
  sheet.addRow([]);
  sheet.addRow(['SIGNATURE', '____________________________']);

  sheet.columns.forEach((col, idx) => {
    col.width = idx === 1 ? 34 : 16;
  });
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 34;
  sheet.eachRow(row => {
    row.eachCell(cell => {
      cell.font = { name: 'Calibri', size: 11 };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
  });

  return workbook.xlsx.writeBuffer();
}

function drawTextBlock(doc, label, profile, x, y) {
  doc.font('Helvetica-Bold').fontSize(9).text(`${label}:`, x, y);
  doc.font('Helvetica').fontSize(9).text(profile?.label || '', x + 50, y);
  let lineY = y + 13;
  for (const line of profileLines(profile)) {
    doc.text(line, x + 50, lineY);
    lineY += 12;
  }
  return lineY;
}

function signatureBuffer(signature) {
  if (!signature?.data_base64) return null;
  try {
    return Buffer.from(signature.data_base64, 'base64');
  } catch (_) {
    return null;
  }
}

function generateInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(12).text('INVOICE FOR SERVICES', 50, 50);
    doc.fontSize(10).text(`INVOICE #: ${invoice.number || ''}`, 50, 82);
    doc.text(`DATE: ${invoice.date || ''}`, 50, 104);

    const toEnd = drawTextBlock(doc, 'TO', invoice.to, 50, 132);
    const fromEnd = drawTextBlock(doc, 'FROM', invoice.from, 50, Math.max(toEnd + 10, 205));
    let y = Math.max(fromEnd + 24, 285);

    doc.font('Helvetica-Bold').fontSize(10).text('SERVICES PROVIDED', 50, y);
    y += 18;

    const pageWidth = 512;
    const dateW = 58;
    const descW = 170;
    const projectW = Math.max(42, (pageWidth - dateW - descW) / Math.max(invoice.projects.length, 1));
    const rowH = 18;

    function ensurePage() {
      if (y < 720) return;
      doc.addPage();
      y = 50;
    }

    function drawRow(cells, bold = false) {
      ensurePage();
      let x = 50;
      const widths = [dateW, descW, ...invoice.projects.map(() => projectW)];
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      cells.forEach((cell, i) => {
        doc.rect(x, y, widths[i], rowH).stroke();
        doc.text(String(cell ?? ''), x + 3, y + 5, { width: widths[i] - 6, height: rowH - 4 });
        x += widths[i];
      });
      y += rowH;
    }

    drawRow(['DATE', 'DESCRIPTION', ...invoice.projects.map(p => p.name)], true);
    for (const line of invoice.lines) {
      drawRow([
        line.date,
        line.description,
        ...invoice.projects.map(project => {
          const value = timeCell(line.hoursByProject[project.name]);
          return value === '' ? '' : hours(value);
        })
      ]);
    }

    y += 10;
    drawRow(['', 'TOTAL HOURS BY PROJECT', ...invoice.projects.map(p => hours(projectTotal(invoice, p.name)))], true);
    if (!usesStandardRate(invoice)) {
      drawRow(['', 'RATE', ...invoice.projects.map(p => money(p.hourly_rate))], true);
      drawRow(['', 'TOTAL FEE', ...invoice.projects.map(p => money(projectTotal(invoice, p.name) * Number(p.hourly_rate || 0)))], true);
    }

    if ((invoice.expenses || []).length > 0) {
      y += 16;
      doc.font('Helvetica-Bold').fontSize(10).text('EXPENSES', 50, y);
      y += 18;
      const expenseWidths = [dateW, 100, 260, 94];
      function drawExpenseRow(cells, bold = false) {
        ensurePage();
        let x = 50;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        cells.forEach((cell, i) => {
          doc.rect(x, y, expenseWidths[i], rowH).stroke();
          doc.text(String(cell ?? ''), x + 3, y + 5, { width: expenseWidths[i] - 6, height: rowH - 4 });
          x += expenseWidths[i];
        });
        y += rowH;
      }
      drawExpenseRow(['DATE', 'PROJECT', 'DESCRIPTION', 'AMOUNT'], true);
      for (const expense of invoice.expenses) {
        drawExpenseRow([expense.date, expense.project, expense.description, money(expense.amount)]);
      }
      drawExpenseRow(['', '', 'TOTAL EXPENSES', money(invoiceExpenseTotal(invoice))], true);
    }

    y += 16;
    const summaryLabelX = 300;
    const summaryValueX = 455;
    function drawSummary(label, value) {
      doc.font('Helvetica-Bold').fontSize(10).text(label, summaryLabelX, y, { width: 150, align: 'right' });
      doc.text(value, summaryValueX, y, { width: 80, align: 'right' });
      y += 16;
    }
    drawSummary('TOTAL HOURS THIS PERIOD', hours(invoiceTotalHours(invoice)));
    if (usesStandardRate(invoice)) {
      drawSummary('RATE', money(invoiceRate(invoice)));
    }
    drawSummary('TOTAL FEE THIS PERIOD', money(invoiceTotalFee(invoice)));
    if (shouldShowGrandTotal(invoice)) {
      drawSummary('GRAND TOTAL THIS PERIOD', money(invoiceGrandTotal(invoice)));
    }

    y += 26;
    if (y > 690) {
      doc.addPage();
      y = 80;
    }
    const sig = signatureBuffer(invoice.signature);
    if (sig) {
      try {
        const sigX = Number.isFinite(Number(invoice.signature.signature_x)) ? Number(invoice.signature.signature_x) : 0;
        const sigY = Number.isFinite(Number(invoice.signature.signature_y)) ? Number(invoice.signature.signature_y) : -62;
        const sigW = Number.isFinite(Number(invoice.signature.signature_width)) ? Number(invoice.signature.signature_width) : 180;
        const sigH = Number.isFinite(Number(invoice.signature.signature_height)) ? Number(invoice.signature.signature_height) : 55;
        doc.image(sig, 50 + sigX, y + 34 + sigY, { fit: [sigW, sigH] });
      } catch (_) {}
    }
    doc.moveTo(50, y + 34).lineTo(260, y + 34).stroke();
    doc.font('Helvetica').fontSize(9).text('Signature', 50, y + 39);

    doc.end();
  });
}

module.exports = { generateInvoiceXlsx, generateInvoicePdf };
