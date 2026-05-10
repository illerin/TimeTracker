'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const fc = require('fast-check');
const request = require('supertest');
const ExcelJS = require('exceljs');

// ─── Test DB Setup ────────────────────────────────────────────────────────────
// Use a unique temp file per test run so tests are isolated
const TEST_DB = path.join(os.tmpdir(), `timetracker-test-${process.pid}.db`);
process.env.DB_PATH = TEST_DB;

// Require app AFTER setting DB_PATH so db.js picks up the test path
const app = require('../index');
const { getDb } = require('../db');

function resetDb() {
  const db = getDb();
  db.prepare('DELETE FROM time_entries').run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name='time_entries'").run();
}

afterEach(() => {
  resetDb();
});

afterAll(() => {
  try { fs.unlinkSync(TEST_DB); } catch (_) {}
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function insertWorkday(date, entries) {
  return request(app).post('/api/workday').send({ date, entries });
}

const VALID_ENTRY = { project: 'alpha', start_time: '09:00', end_time: '10:00' };
const VALID_DATE  = '2026-01-15';

// ─── Property Tests ───────────────────────────────────────────────────────────

// Feature: time-tracker, Property 5: New project round-trip
describe('Property 5: New project round-trip', () => {
  test('after inserting an entry, GET /api/projects includes the normalized project name', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
        async (projectName) => {
          resetDb();
          const res = await insertWorkday(VALID_DATE, [
            { project: projectName, start_time: '09:00', end_time: '10:00' }
          ]);
          expect(res.status).toBe(201);

          const listRes = await request(app).get('/api/projects');
          expect(listRes.status).toBe(200);
          expect(listRes.body).toContain(projectName.trim().toLowerCase());
        }
      ),
      { numRuns: 20 } // reduced for API tests to keep runtime reasonable
    );
  });
});

// Feature: time-tracker, Property 6: Distinct project list
describe('Property 6: Distinct project list', () => {
  test('GET /api/projects returns each project name exactly once', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom('alpha', 'beta', 'gamma'),
          { minLength: 2, maxLength: 4 }
        ),
        async (projects) => {
          resetDb();
          // Insert multiple entries with potentially duplicate project names
          let start = 9 * 60; // 09:00 in minutes
          const entries = projects.map(project => {
            const s = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
            start += 60;
            const e = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
            return { project, start_time: s, end_time: e };
          });

          await insertWorkday(VALID_DATE, entries);

          const listRes = await request(app).get('/api/projects');
          expect(listRes.status).toBe(200);

          // No duplicates
          const names = listRes.body;
          expect(names.length).toBe(new Set(names).size);
        }
      ),
      { numRuns: 20 }
    );
  });
});

// Feature: time-tracker, Property 7: Entry CRUD round-trips
describe('Property 7: Entry CRUD round-trips', () => {
  test('insert → fetch round-trip', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('alpha', 'beta', 'gamma'),
        async (project) => {
          resetDb();
          const res = await insertWorkday(VALID_DATE, [
            { project, start_time: '09:00', end_time: '10:00' }
          ]);
          expect(res.status).toBe(201);

          const fetchRes = await request(app).get(`/api/entries?date=${VALID_DATE}`);
          expect(fetchRes.status).toBe(200);
          expect(fetchRes.body.some(e => e.project === project.toLowerCase())).toBe(true);
        }
      ),
      { numRuns: 20 }
    );
  });

  test('update → fetch round-trip', async () => {
    resetDb();
    await insertWorkday(VALID_DATE, [VALID_ENTRY]);
    const fetchRes = await request(app).get(`/api/entries?date=${VALID_DATE}`);
    const id = fetchRes.body[0].id;

    const updateRes = await request(app).put(`/api/entries/${id}`).send({
      project: 'updated-project',
      start_time: '11:00',
      end_time: '12:00'
    });
    expect(updateRes.status).toBe(200);

    const fetchRes2 = await request(app).get(`/api/entries?date=${VALID_DATE}`);
    expect(fetchRes2.body[0].project).toBe('updated-project');
    expect(fetchRes2.body[0].start_time).toBe('11:00');
  });

  test('delete → fetch round-trip', async () => {
    resetDb();
    await insertWorkday(VALID_DATE, [VALID_ENTRY]);
    const fetchRes = await request(app).get(`/api/entries?date=${VALID_DATE}`);
    const id = fetchRes.body[0].id;

    const delRes = await request(app).delete(`/api/entries/${id}`);
    expect(delRes.status).toBe(204);

    const fetchRes2 = await request(app).get(`/api/entries?date=${VALID_DATE}`);
    expect(fetchRes2.body.find(e => e.id === id)).toBeUndefined();
  });
});

// Feature: time-tracker, Property 12: API error responses
describe('Property 12: API error responses', () => {
  test('POST /api/workday with missing date returns 400', async () => {
    const res = await request(app).post('/api/workday').send({ entries: [VALID_ENTRY] });
    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });

  test('POST /api/workday with overlapping entries returns 422', async () => {
    const res = await insertWorkday(VALID_DATE, [
      { project: 'alpha', start_time: '09:00', end_time: '10:30' },
      { project: 'beta',  start_time: '10:00', end_time: '11:00' }
    ]);
    expect(res.status).toBe(422);
    expect(res.body.errors).toBeTruthy();
  });

  test('GET /api/entries with missing date returns 400', async () => {
    const res = await request(app).get('/api/entries');
    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });

  test('GET /api/entries with invalid date returns 400', async () => {
    const res = await request(app).get('/api/entries?date=not-a-date');
    expect(res.status).toBe(400);
  });

  test('PUT /api/entries/:id with unknown id returns 404', async () => {
    const res = await request(app).put('/api/entries/99999').send({
      project: 'alpha', start_time: '09:00', end_time: '10:00'
    });
    expect(res.status).toBe(404);
    expect(res.body.message).toBeTruthy();
  });

  test('DELETE /api/entries/:id with unknown id returns 404', async () => {
    const res = await request(app).delete('/api/entries/99999');
    expect(res.status).toBe(404);
    expect(res.body.message).toBeTruthy();
  });

  test('GET /api/summary with missing params returns 400', async () => {
    const res = await request(app).get('/api/summary');
    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });

  test('GET /api/export with missing params returns 400', async () => {
    const res = await request(app).get('/api/export');
    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });
});

// ─── Example-Based API Contract Tests ────────────────────────────────────────

describe('API contract — valid inputs', () => {
  test('POST /api/workday returns 201 with inserted count', async () => {
    const res = await insertWorkday(VALID_DATE, [VALID_ENTRY]);
    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(1);
  });

  test('GET /api/entries returns array for valid date', async () => {
    await insertWorkday(VALID_DATE, [VALID_ENTRY]);
    const res = await request(app).get(`/api/entries?date=${VALID_DATE}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
  });

  test('GET /api/entries returns empty array for date with no entries', async () => {
    const res = await request(app).get('/api/entries?date=2020-01-01');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('GET /api/projects returns array of strings', async () => {
    await insertWorkday(VALID_DATE, [VALID_ENTRY]);
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(typeof res.body[0]).toBe('string');
  });

  test('GET /api/summary returns grouped summary', async () => {
    await insertWorkday(VALID_DATE, [VALID_ENTRY]);
    const res = await request(app).get(`/api/summary?start=${VALID_DATE}&end=${VALID_DATE}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].date).toBe(VALID_DATE);
    expect(Array.isArray(res.body[0].projects)).toBe(true);
  });

  test('GET /api/export returns xlsx with correct headers', async () => {
    await insertWorkday(VALID_DATE, [VALID_ENTRY]);
    const res = await request(app).get(`/api/export?start=${VALID_DATE}&end=${VALID_DATE}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('.xlsx');
  });

  test('end-to-end export: insert entries, call export, verify xlsx pivot structure', async () => {
    await insertWorkday('2026-01-01', [
      { project: 'alpha', start_time: '09:00', end_time: '13:00' },
      { project: 'beta',  start_time: '14:00', end_time: '16:30' }
    ]);
    await insertWorkday('2026-01-02', [
      { project: 'alpha', start_time: '10:00', end_time: '13:45' }
    ]);

    const res = await request(app)
      .get('/api/export?start=2026-01-01&end=2026-01-02')
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);

    // Parse the xlsx buffer — use the raw Buffer directly
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    const sheet = workbook.worksheets[0];
    const rows = [];
    sheet.eachRow(row => rows.push(row.values.slice(1)));

    // Header: Date, alpha, beta
    expect(rows[0][0]).toBe('Date');
    expect(rows[0]).toContain('alpha');
    expect(rows[0]).toContain('beta');

    // Dates ascending
    expect(rows[1][0]).toBe('2026-01-01');
    expect(rows[2][0]).toBe('2026-01-02');
  });
});
