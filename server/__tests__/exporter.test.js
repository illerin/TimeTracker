'use strict';

const ExcelJS = require('exceljs');
const { generateInvoiceXlsx, generateInvoicePdf } = require('../lib/exporter');

const invoice = {
  number: '230',
  date: '2026-05-06',
  from: { label: 'From Set', details: 'Example Sender\nEmail: sender@example.com' },
  to: { label: 'To Set', details: 'Client\nEmail: client@example.com' },
  projects: [
    { name: 'alpha', hourly_rate: 45 },
    { name: 'beta', hourly_rate: 50 }
  ],
  expenses: [
    { date: '2026-01-02', project: 'beta', description: 'Materials', amount: 12.5 }
  ],
  lines: [
    { date: '2026-01-01', description: 'Build', hoursByProject: { alpha: 2.5 } },
    { date: '2026-01-02', description: 'Support', hoursByProject: { beta: 1 } }
  ]
};

async function parseXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const rows = [];
  workbook.worksheets[0].eachRow(row => rows.push(row.values.slice(1)));
  return rows;
}

describe('invoice exporters', () => {
  test('xlsx includes invoice metadata, project columns, totals, and rates', async () => {
    const rows = await parseXlsx(await generateInvoiceXlsx(invoice));

    expect(rows[0]).toEqual(['INVOICE #: ', '230']);
    expect(rows).toContainEqual(['TO:', 'To Set']);
    expect(rows).toContainEqual(['FROM:', 'From Set']);
    expect(rows).toContainEqual(['DATE', 'DESCRIPTION', 'alpha', 'beta']);
    expect(rows).toContainEqual(['2026-01-01', 'Build', 2.5, '']);
    expect(rows).toContainEqual(['TOTAL HOURS BY PROJECT', '', 2.5, 1]);
    expect(rows).toContainEqual(['RATE', '', 45, 50]);
    expect(rows).toContainEqual(['TOTAL FEE THIS PERIOD', 162.5]);
    expect(rows).toContainEqual(['2026-01-02', 'beta', 'Materials', 12.5]);
    expect(rows).toContainEqual(['TOTAL EXPENSES', 12.5]);
    expect(rows).toContainEqual(['GRAND TOTAL THIS PERIOD', 175]);
    expect(rows).toContainEqual(['SIGNATURE', '____________________________']);
  });

  test('xlsx omits grand total when there are no expenses', async () => {
    const rows = await parseXlsx(await generateInvoiceXlsx({ ...invoice, expenses: [] }));
    expect(rows).toContainEqual(['TOTAL FEE THIS PERIOD', 162.5]);
    expect(rows).not.toContainEqual(['GRAND TOTAL THIS PERIOD', 162.5]);
  });

  test('xlsx shows standard rate only in the bottom summary', async () => {
    const standardInvoice = {
      ...invoice,
      rate_mode: 'standard',
      standard_rate: 60,
      projects: invoice.projects.map(project => ({ ...project, hourly_rate: 60 }))
    };
    const rows = await parseXlsx(await generateInvoiceXlsx(standardInvoice));

    expect(rows).toContainEqual(['TOTAL HOURS BY PROJECT', '', 2.5, 1]);
    expect(rows).not.toContainEqual(['RATE', '', 60, 60]);
    expect(rows).not.toContainEqual(['TOTAL FEE', '', 150, 60]);
    expect(rows).toContainEqual(['RATE', 60]);
    expect(rows).toContainEqual(['TOTAL FEE THIS PERIOD', 210]);
  });

  test('pdf returns a PDF buffer', async () => {
    const buffer = await generateInvoicePdf(invoice);
    expect(buffer.slice(0, 4).toString()).toBe('%PDF');
  });
});
