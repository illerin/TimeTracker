'use strict';

const ExcelJS = require('exceljs');

/**
 * Generates an .xlsx file with one row per date+project combination.
 *
 * Column order: Date | Descriptions | Project1 | Project2 | ...
 * Each data row represents a single project on a single date.
 * Only that project's column is filled; all other project columns are 0.
 *
 * @param {Array<{ date: string, project: string, hours: number, descriptions: string[] }>} rows
 * @returns {Promise<Buffer>}
 */
async function generateXlsx(rows) {
  // Collect all distinct projects (sorted) for the header
  const projectSet = new Set();
  for (const row of rows) projectSet.add(row.project);
  const projects = [...projectSet].sort();

  // Sort rows by date ascending, then project ascending
  const sorted = [...rows].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    return dateCmp !== 0 ? dateCmp : a.project.localeCompare(b.project);
  });

  const workbook = new ExcelJS.Workbook();
  const sheet    = workbook.addWorksheet('Time Tracker');

  // Header row: Date, Descriptions, ...projects
  sheet.addRow(['Date', 'Descriptions', ...projects]);

  // One data row per date+project entry
  for (const row of sorted) {
    const descriptions = Array.isArray(row.descriptions) && row.descriptions.length > 0
      ? row.descriptions.join('; ')
      : '';

    // Build project cells: only this row's project gets its hours, rest are 0
    const cells = projects.map(p => p === row.project ? row.hours : 0);

    sheet.addRow([row.date, descriptions, ...cells]);
  }

  return workbook.xlsx.writeBuffer();
}

module.exports = { generateXlsx };
