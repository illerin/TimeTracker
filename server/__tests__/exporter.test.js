'use strict';

const fc = require('fast-check');
const ExcelJS = require('exceljs');
const { generateXlsx } = require('../lib/exporter');

/**
 * Parse an xlsx Buffer back into a 2D array of cell values.
 * @param {Buffer} buffer
 * @returns {Promise<Array<Array<any>>>}
 */
async function parseXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  const rows = [];
  sheet.eachRow(row => {
    rows.push(row.values.slice(1)); // slice(1) removes the 1-based index placeholder
  });
  return rows;
}

// ─── Property Tests ───────────────────────────────────────────────────────────

// Feature: time-tracker, Property 11: xlsx pivot structure
describe('Property 11: xlsx pivot structure', () => {
  test('workbook rows = dates ascending, columns = distinct projects, cells = hours or 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            date:    fc.constantFrom('2026-01-01', '2026-01-02', '2026-01-03'),
            project: fc.constantFrom('alpha', 'beta', 'gamma'),
            hours:   fc.integer({ min: 1, max: 8 }).map(n => n * 0.25)
          }),
          { minLength: 1, maxLength: 9 }
        ),
        async (rawRows) => {
          // Merge duplicate date+project combinations (sum hours)
          const merged = new Map();
          for (const row of rawRows) {
            const key = `${row.date}|${row.project}`;
            merged.set(key, (merged.get(key) || 0) + row.hours);
          }
          const rows = [...merged.entries()].map(([key, hours]) => {
            const [date, project] = key.split('|');
            return { date, project, hours };
          });

          const buffer = await generateXlsx(rows);
          const parsed = await parseXlsx(buffer);

          // Collect expected dates and projects
          const expectedDates = [...new Set(rows.map(r => r.date))].sort();
          const expectedProjects = [...new Set(rows.map(r => r.project))].sort();

          // Header row
          const header = parsed[0];
          expect(header[0]).toBe('Date');
          expectedProjects.forEach((p, i) => {
            expect(header[i + 1]).toBe(p);
          });

          // Data rows: dates in ascending order
          const dataRows = parsed.slice(1);
          expect(dataRows.map(r => r[0])).toEqual(expectedDates);

          // Cell values: correct hours or 0
          for (let ri = 0; ri < dataRows.length; ri++) {
            const date = dataRows[ri][0];
            for (let ci = 0; ci < expectedProjects.length; ci++) {
              const project = expectedProjects[ci];
              const expected = rows.find(r => r.date === date && r.project === project)?.hours || 0;
              expect(dataRows[ri][ci + 1]).toBeCloseTo(expected, 5);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Example-Based Unit Tests ─────────────────────────────────────────────────

describe('generateXlsx — example cases', () => {
  test('single date, single project', async () => {
    const rows = [{ date: '2026-01-01', project: 'alpha', hours: 4.0 }];
    const buffer = await generateXlsx(rows);
    const parsed = await parseXlsx(buffer);

    expect(parsed[0]).toEqual(['Date', 'alpha']);
    expect(parsed[1]).toEqual(['2026-01-01', 4.0]);
  });

  test('multiple dates, multiple projects', async () => {
    const rows = [
      { date: '2026-01-01', project: 'alpha', hours: 4.0 },
      { date: '2026-01-01', project: 'beta',  hours: 2.5 },
      { date: '2026-01-02', project: 'alpha', hours: 3.75 },
      { date: '2026-01-02', project: 'beta',  hours: 4.25 }
    ];
    const buffer = await generateXlsx(rows);
    const parsed = await parseXlsx(buffer);

    // Header
    expect(parsed[0]).toEqual(['Date', 'alpha', 'beta']);
    // Dates ascending
    expect(parsed[1][0]).toBe('2026-01-01');
    expect(parsed[2][0]).toBe('2026-01-02');
    // Values
    expect(parsed[1][1]).toBeCloseTo(4.0);
    expect(parsed[1][2]).toBeCloseTo(2.5);
    expect(parsed[2][1]).toBeCloseTo(3.75);
    expect(parsed[2][2]).toBeCloseTo(4.25);
  });

  test('missing date-project combinations produce 0', async () => {
    const rows = [
      { date: '2026-01-01', project: 'alpha', hours: 4.0 },
      { date: '2026-01-02', project: 'beta',  hours: 2.0 }
    ];
    const buffer = await generateXlsx(rows);
    const parsed = await parseXlsx(buffer);

    // alpha on 2026-01-02 should be 0
    expect(parsed[2][1]).toBe(0); // alpha col
    // beta on 2026-01-01 should be 0
    expect(parsed[1][2]).toBe(0); // beta col
  });

  test('empty rows produces header-only workbook', async () => {
    const buffer = await generateXlsx([]);
    const parsed = await parseXlsx(buffer);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(['Date']);
  });
});
