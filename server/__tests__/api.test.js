'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const request = require('supertest');
const ExcelJS = require('exceljs');

const TEST_DB = path.join(os.tmpdir(), `timetracker-test-${process.pid}.db`);
process.env.DB_PATH = TEST_DB;

const app = require('../index');
const { getDb } = require('../db');

function resetDb() {
  const db = getDb();
  db.prepare('DELETE FROM time_entries').run();
  db.prepare('DELETE FROM expenses').run();
  db.prepare('DELETE FROM recurring_expenses').run();
  db.prepare('DELETE FROM projects').run();
  db.prepare('DELETE FROM invoice_profiles').run();
  db.prepare('DELETE FROM standard_rates').run();
  db.prepare('DELETE FROM signatures').run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name='time_entries'").run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name='expenses'").run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name='recurring_expenses'").run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name='projects'").run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name='invoice_profiles'").run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name='standard_rates'").run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name='signatures'").run();
  db.prepare("UPDATE settings SET value = 'project' WHERE key = 'rate_mode'").run();
}

async function createProject(name) {
  return request(app).post('/api/projects').send({ name });
}

async function createProfile(kind, label) {
  return request(app).post('/api/invoice-profiles').send({
    kind,
    label,
    details: `${label}\nEmail: ${kind}@example.com`
  });
}

async function insertWorkday(date, entries) {
  return request(app).post('/api/workday').send({ date, entries });
}

async function parseXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const rows = [];
  workbook.worksheets[0].eachRow(row => rows.push(row.values.slice(1)));
  return rows;
}

afterEach(resetDb);

afterAll(() => {
  try { fs.unlinkSync(TEST_DB); } catch (_) {}
});

describe('API contracts', () => {
  test('POST /api/workday requires existing projects', async () => {
    const res = await insertWorkday('2026-01-15', [
      { project: 'alpha', start_time: '09:00', end_time: '10:00' }
    ]);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Unknown project');
  });

  test('POST /api/workday replaces entries for the selected date', async () => {
    await createProject('alpha');
    await createProject('beta');

    const first = await insertWorkday('2026-01-15', [
      { project: 'alpha', start_time: '09:00', end_time: '10:00' }
    ]);
    expect(first.status).toBe(201);

    const second = await insertWorkday('2026-01-15', [
      { project: 'beta', start_time: '11:00', end_time: '12:00' }
    ]);
    expect(second.status).toBe(201);

    const entries = await request(app).get('/api/entries?date=2026-01-15');
    expect(entries.status).toBe(200);
    expect(entries.body).toHaveLength(1);
    expect(entries.body[0].project).toBe('beta');
  });

  test('PUT /api/entries/:id requires an existing project', async () => {
    await createProject('alpha');
    await insertWorkday('2026-01-15', [
      { project: 'alpha', start_time: '09:00', end_time: '10:00' }
    ]);

    const entries = await request(app).get('/api/entries?date=2026-01-15');
    const res = await request(app).put(`/api/entries/${entries.body[0].id}`).send({
      project: 'missing',
      start_time: '10:00',
      end_time: '11:00'
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Unknown project');
  });

  test('allows an end time of 24:00 for logging to midnight', async () => {
    await createProject('alpha');

    const res = await insertWorkday('2026-01-15', [
      { project: 'alpha', start_time: '23:00', end_time: '24:00' }
    ]);

    expect(res.status).toBe(201);
  });

  test('GET /api/export returns invoice xlsx and honors selected projects', async () => {
    const alpha = await createProject('alpha');
    const beta = await createProject('beta');
    await request(app).patch(`/api/projects/${alpha.body.id}/rate`).send({ hourly_rate: 45 });
    await request(app).patch(`/api/projects/${beta.body.id}/rate`).send({ hourly_rate: 50 });
    const from = await createProfile('from', 'My Business');
    const to = await createProfile('to', 'Client');
    await insertWorkday('2026-01-15', [
      { project: 'alpha', start_time: '09:00', end_time: '10:00', description: 'A' },
      { project: 'beta', start_time: '10:00', end_time: '12:00', description: 'B' }
    ]);
    await request(app).post('/api/expenses').send({
      date: '2026-01-15',
      project: 'beta',
      description: 'Materials',
      amount: 12.5
    });

    const res = await request(app)
      .get(`/api/export?start=2026-01-15&end=2026-01-15&projects=beta&fromProfileId=${from.body.id}&toProfileId=${to.body.id}&invoiceNumber=230&invoiceDate=2026-05-06`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const rows = await parseXlsx(res.body);
    expect(rows).toContainEqual(['INVOICE #: ', '230']);
    expect(rows).toContainEqual(['DATE', 'DESCRIPTION', 'beta']);
    expect(rows).toContainEqual(['2026-01-15', 'B', 2]);
    expect(rows).toContainEqual(['RATE', '', 50]);
    expect(rows).not.toContainEqual(['2026-01-15', 'beta', 'Materials', 12.5]);

    const withExpenses = await request(app)
      .get(`/api/export?start=2026-01-15&end=2026-01-15&projects=beta&fromProfileId=${from.body.id}&toProfileId=${to.body.id}&invoiceNumber=230&invoiceDate=2026-05-06&includeExpenses=1`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(withExpenses.status).toBe(200);
    const expenseRows = await parseXlsx(withExpenses.body);
    expect(expenseRows).toContainEqual(['2026-01-15', 'beta', 'Materials', 12.5]);
    expect(expenseRows).toContainEqual(['TOTAL EXPENSES', 12.5]);
  });

  test('GET /api/export can return invoice pdf', async () => {
    await createProject('alpha');
    const from = await createProfile('from', 'My Business');
    const to = await createProfile('to', 'Client');
    await insertWorkday('2026-01-15', [
      { project: 'alpha', start_time: '09:00', end_time: '10:00', description: 'A' }
    ]);

    const res = await request(app)
      .get(`/api/export?format=pdf&start=2026-01-15&end=2026-01-15&projects=alpha&fromProfileId=${from.body.id}&toProfileId=${to.body.id}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('pdf');
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('GET /api/export allows blank from and to profiles', async () => {
    await createProject('alpha');
    await insertWorkday('2026-01-15', [
      { project: 'alpha', start_time: '09:00', end_time: '10:00', description: 'A' }
    ]);

    const res = await request(app)
      .get('/api/export?start=2026-01-15&end=2026-01-15&projects=alpha&invoiceNumber=231')
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const rows = await parseXlsx(res.body);
    expect(rows).toContainEqual(['INVOICE #: ', '231']);
    expect(rows).toContainEqual(['2026-01-15', 'A', 1]);
  });

  test('GET /api/export can use a selected standard rate', async () => {
    await createProject('alpha');
    await request(app).put('/api/settings/rate-mode').send({ mode: 'standard' });
    const rate = await request(app).post('/api/standard-rates').send({ label: 'Shop Rate', amount: 95 });
    await insertWorkday('2026-01-15', [
      { project: 'alpha', start_time: '09:00', end_time: '11:00', description: 'A' }
    ]);

    const res = await request(app)
      .get(`/api/export?start=2026-01-15&end=2026-01-15&projects=alpha&rateMode=standard&standardRateId=${rate.body.id}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const rows = await parseXlsx(res.body);
    expect(rows).not.toContainEqual(['RATE', '', 95]);
    expect(rows).toContainEqual(['RATE', 95]);
    expect(rows).toContainEqual(['TOTAL FEE THIS PERIOD', 190]);
  });

  test('GET /api/export can preview invoice pdf inline', async () => {
    await createProject('alpha');
    const from = await createProfile('from', 'My Business');
    const to = await createProfile('to', 'Client');
    await insertWorkday('2026-01-15', [
      { project: 'alpha', start_time: '09:00', end_time: '10:00', description: 'A' }
    ]);

    const res = await request(app)
      .get(`/api/export?format=pdf&preview=1&start=2026-01-15&end=2026-01-15&projects=alpha&fromProfileId=${from.body.id}&toProfileId=${to.body.id}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('inline');
    expect(res.headers['content-type']).toContain('pdf');
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('recurring expenses can be reported, paused, and stopped', async () => {
    await createProject('alpha');

    const created = await request(app).post('/api/recurring-expenses').send({
      project: 'alpha',
      description: 'Hosting',
      amount: 20,
      frequency: 'weekly',
      start_date: '2026-01-01',
      expiration_date: '2026-01-15'
    });
    expect(created.status).toBe(201);

    const report = await request(app).get('/api/expenses/report?start=2026-01-01&end=2026-01-31&sort=date');
    expect(report.status).toBe(200);
    expect(report.body.rows.map(row => row.date)).toEqual(['2026-01-01', '2026-01-08', '2026-01-15']);
    expect(report.body.total).toBe(60);

    const paused = await request(app)
      .patch(`/api/recurring-expenses/${created.body.id}`)
      .send({ paused: true });
    expect(paused.status).toBe(200);
    expect(paused.body.paused).toBe(1);

    const stopped = await request(app)
      .patch(`/api/recurring-expenses/${created.body.id}`)
      .send({ stopped: true });
    expect(stopped.status).toBe(200);
    expect(stopped.body.stopped).toBe(1);
  });

  test('export includes recurring expenses only when requested', async () => {
    await createProject('alpha');
    const from = await createProfile('from', 'My Business');
    const to = await createProfile('to', 'Client');
    await insertWorkday('2026-01-01', [
      { project: 'alpha', start_time: '09:00', end_time: '10:00', description: 'A' }
    ]);
    await request(app).post('/api/recurring-expenses').send({
      project: 'alpha',
      description: 'License',
      amount: 15,
      frequency: 'weekly',
      start_date: '2026-01-01',
      expiration_date: '2026-01-08'
    });

    const res = await request(app)
      .get(`/api/export?start=2026-01-01&end=2026-01-08&projects=alpha&fromProfileId=${from.body.id}&toProfileId=${to.body.id}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    const rows = await parseXlsx(res.body);
    expect(rows).not.toContainEqual(['2026-01-01', 'alpha', 'License', 15]);

    const withExpenses = await request(app)
      .get(`/api/export?start=2026-01-01&end=2026-01-08&projects=alpha&fromProfileId=${from.body.id}&toProfileId=${to.body.id}&includeExpenses=1`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    const expenseRows = await parseXlsx(withExpenses.body);
    expect(expenseRows).toContainEqual(['2026-01-01', 'alpha', 'License', 15]);
    expect(expenseRows).toContainEqual(['2026-01-08', 'alpha', 'License', 15]);
    expect(expenseRows).toContainEqual(['TOTAL EXPENSES', 30]);
  });

  test('backup includes all user saved data', async () => {
    const created = await createProject('alpha');
    await request(app).patch(`/api/projects/${created.body.id}/hidden`).send({ hidden: true });
    await createProfile('from', 'My Business');
    await createProfile('to', 'Client');
    await request(app).put('/api/settings/time-window').send({ start: '06', end: '23' });
    await request(app).put('/api/settings/rate-mode').send({ mode: 'standard' });
    await request(app).post('/api/standard-rates').send({ label: 'Shop Rate', amount: 95 });
    await request(app).post('/api/signatures').send({
      label: 'Default',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo='
    });

    const res = await request(app).get('/api/backup');
    expect(res.status).toBe(200);

    const backup = JSON.parse(res.text);
    expect(backup.projects[0]).toMatchObject({ name: 'alpha', hidden: 1, hourly_rate: 0 });
    expect(Array.isArray(backup.expenses)).toBe(true);
    expect(Array.isArray(backup.recurring_expenses)).toBe(true);
    expect(backup.settings).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'time_window_start', value: '06' }),
      expect.objectContaining({ key: 'time_window_end', value: '23' }),
      expect.objectContaining({ key: 'rate_mode', value: 'standard' })
    ]));
    expect(backup.invoice_profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'from', label: 'My Business' }),
      expect.objectContaining({ kind: 'to', label: 'Client' })
    ]));
    expect(backup.standard_rates).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Shop Rate', amount: 95 })
    ]));
    expect(backup.signatures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Default',
        mime_type: 'image/png',
        data_base64: 'iVBORw0KGgo=',
        signature_x: 0,
        signature_y: -62,
        signature_width: 180,
        signature_height: 55
      })
    ]));
  });

  test('expense CRUD requires existing projects', async () => {
    let res = await request(app).post('/api/expenses').send({
      date: '2026-01-15',
      project: 'missing',
      description: 'Materials',
      amount: 10
    });
    expect(res.status).toBe(400);

    await createProject('alpha');
    res = await request(app).post('/api/expenses').send({
      date: '2026-01-15',
      project: 'alpha',
      description: 'Materials',
      amount: 10
    });
    expect(res.status).toBe(201);

    const list = await request(app).get('/api/expenses?date=2026-01-15');
    expect(list.body).toHaveLength(1);

    const update = await request(app).put(`/api/expenses/${res.body.id}`).send({
      project: 'alpha',
      description: 'Updated',
      amount: 12.25
    });
    expect(update.status).toBe(200);
    expect(update.body.amount).toBe(12.25);

    const del = await request(app).delete(`/api/expenses/${res.body.id}`);
    expect(del.status).toBe(204);
  });

  test('time window settings can be read and updated', async () => {
    const update = await request(app)
      .put('/api/settings/time-window')
      .send({ start: '00', end: '24' });
    expect(update.status).toBe(200);

    const read = await request(app).get('/api/settings/time-window');
    expect(read.body).toEqual({ start: '00', end: '24' });
  });

  test('rate settings and signatures can be saved', async () => {
    const mode = await request(app).put('/api/settings/rate-mode').send({ mode: 'standard' });
    expect(mode.status).toBe(200);

    const rate = await request(app).post('/api/standard-rates').send({ label: 'Field Rate', amount: 80 });
    expect(rate.status).toBe(201);

    const sig = await request(app).post('/api/signatures').send({
      label: 'Default',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      placement: { x: 12, y: -70, width: 190, height: 60 }
    });
    expect(sig.status).toBe(201);

    const rates = await request(app).get('/api/standard-rates');
    const signatures = await request(app).get('/api/signatures');
    expect(rates.body[0]).toMatchObject({ label: 'Field Rate', amount: 80 });
    expect(signatures.body[0]).toMatchObject({
      label: 'Default',
      mime_type: 'image/png',
      signature_x: 12,
      signature_y: -70,
      signature_width: 190,
      signature_height: 60
    });
  });
});
