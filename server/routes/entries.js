'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { roundToNearest15 } = require('../lib/normalizer');
const { validateEntries } = require('../lib/validator');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function isValidDate(str) {
  if (!DATE_RE.test(str)) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

function isValidStartTime(str) {
  if (!TIME_RE.test(str)) return false;
  const [hours, minutes] = str.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function isValidEndTime(str) {
  if (!TIME_RE.test(str)) return false;
  const [hours, minutes] = str.split(':').map(Number);
  if (hours === 24) return minutes === 0;
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function normalizeEntry(entry) {
  return {
    project:     entry.project.trim(),
    start_time:  roundToNearest15(entry.start_time),
    end_time:    roundToNearest15(entry.end_time),
    description: typeof entry.description === 'string' ? entry.description.trim() : ''
  };
}

function getCanonicalProjectMap(db, projectNames) {
  const findProject = db.prepare('SELECT name FROM projects WHERE name = ? COLLATE NOCASE');
  const map = new Map();
  const missing = [];

  for (const rawName of projectNames) {
    const name = rawName.trim();
    if (map.has(name.toLowerCase())) continue;

    const project = findProject.get(name);
    if (!project) {
      missing.push(name);
    } else {
      map.set(name.toLowerCase(), project.name);
    }
  }

  return { map, missing };
}

function isValidAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0;
}

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

function addInterval(date, frequency) {
  const next = new Date(`${date}T00:00:00`);
  if (frequency === 'weekly') next.setDate(next.getDate() + 7);
  else if (frequency === 'biweekly') next.setDate(next.getDate() + 14);
  else next.setMonth(next.getMonth() + 1);
  return toIsoDate(next);
}

function materializeRecurringExpenses(db, throughDate = toIsoDate(new Date())) {
  const rules = db.prepare(`
    SELECT id, project, description, amount, frequency, start_date, expiration_date
    FROM recurring_expenses
    WHERE paused = 0 AND stopped = 0
  `).all();
  const findExisting = db.prepare(
    'SELECT id FROM expenses WHERE recurring_expense_id = ? AND recurring_instance_date = ?'
  );
  const insertExpense = db.prepare(`
    INSERT INTO expenses (date, project, description, amount, recurring_expense_id, recurring_instance_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction(() => {
    for (const rule of rules) {
      const endDate = rule.expiration_date && rule.expiration_date < throughDate
        ? rule.expiration_date
        : throughDate;
      let date = rule.start_date;
      while (date <= endDate) {
        if (!findExisting.get(rule.id, date)) {
          insertExpense.run(date, rule.project, rule.description, rule.amount, rule.id, date);
        }
        date = addInterval(date, rule.frequency);
      }
    }
  });
  insertMany();
}

// ─── POST /api/workday ────────────────────────────────────────────────────────
router.post('/workday', (req, res, next) => {
  try {
    const { date, entries } = req.body;

    if (!date || !isValidDate(date)) {
      return res.status(400).json({ message: 'Invalid or missing date. Expected YYYY-MM-DD.' });
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ message: 'entries must be a non-empty array.' });
    }

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e.project || typeof e.project !== 'string' || e.project.trim() === '') {
        return res.status(400).json({ message: `Row ${i + 1}: project is required.` });
      }
      if (!e.start_time || !isValidStartTime(e.start_time)) {
        return res.status(400).json({ message: `Row ${i + 1}: start_time must be HH:MM from 00:00 to 23:59.` });
      }
      if (!e.end_time || !isValidEndTime(e.end_time)) {
        return res.status(400).json({ message: `Row ${i + 1}: end_time must be HH:MM from 00:00 to 24:00.` });
      }
    }

    const normalized = entries.map(normalizeEntry);
    const db = getDb();
    const { map: projectMap, missing } = getCanonicalProjectMap(
      db,
      normalized.map(e => e.project)
    );
    if (missing.length > 0) {
      return res.status(400).json({ message: `Unknown project: ${missing[0]}. Add it in Settings first.` });
    }

    for (const entry of normalized) {
      entry.project = projectMap.get(entry.project.toLowerCase());
    }

    const { valid, errors } = validateEntries(normalized);
    if (!valid) {
      return res.status(422).json({ errors });
    }

    const deleteForDate = db.prepare('DELETE FROM time_entries WHERE date = ?');
    const insert = db.prepare(
      'INSERT INTO time_entries (date, project, start_time, end_time, description) VALUES (?, ?, ?, ?, ?)'
    );
    const insertMany = db.transaction((rows) => {
      deleteForDate.run(date);
      for (const row of rows) {
        insert.run(date, row.project, row.start_time, row.end_time, row.description);
      }
    });
    insertMany(normalized);

    return res.status(201).json({ inserted: normalized.length, replacedDate: date });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/entries?date=YYYY-MM-DD ─────────────────────────────────────────
router.get('/entries', (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date || !isValidDate(date)) {
      return res.status(400).json({ message: 'Invalid or missing date. Expected YYYY-MM-DD.' });
    }

    const db = getDb();
    const rows = db.prepare(
      'SELECT id, date, project, start_time, end_time, description FROM time_entries WHERE date = ? ORDER BY start_time'
    ).all(date);

    return res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/entries/:id ─────────────────────────────────────────────────────
router.put('/entries/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid entry id.' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ message: 'Entry not found.' });
    }

    const { project, start_time, end_time, description } = req.body;
    if (!project || typeof project !== 'string' || project.trim() === '') {
      return res.status(400).json({ message: 'project is required.' });
    }
    if (!start_time || !isValidStartTime(start_time)) {
      return res.status(400).json({ message: 'start_time must be HH:MM from 00:00 to 23:59.' });
    }
    if (!end_time || !isValidEndTime(end_time)) {
      return res.status(400).json({ message: 'end_time must be HH:MM from 00:00 to 24:00.' });
    }

    const updated = normalizeEntry({ project, start_time, end_time, description });
    const { map: projectMap, missing } = getCanonicalProjectMap(db, [updated.project]);
    if (missing.length > 0) {
      return res.status(400).json({ message: `Unknown project: ${missing[0]}. Add it in Settings first.` });
    }
    updated.project = projectMap.get(updated.project.toLowerCase());

    const others = db.prepare(
      'SELECT project, start_time, end_time FROM time_entries WHERE date = ? AND id != ?'
    ).all(existing.date, id);

    const allEntries = [...others, updated];
    const { valid, errors } = validateEntries(allEntries);
    if (!valid) {
      return res.status(422).json({ errors });
    }

    db.prepare(
      'UPDATE time_entries SET project = ?, start_time = ?, end_time = ?, description = ? WHERE id = ?'
    ).run(updated.project, updated.start_time, updated.end_time, updated.description, id);

    const result = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/entries/:id ──────────────────────────────────────────────────
router.delete('/entries/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid entry id.' });
    }

    const db = getDb();
    const result = db.prepare('DELETE FROM time_entries WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ message: 'Entry not found.' });
    }

    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/expenses?date=YYYY-MM-DD
router.get('/expenses', (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date || !isValidDate(date)) {
      return res.status(400).json({ message: 'Invalid or missing date. Expected YYYY-MM-DD.' });
    }

    const db = getDb();
    materializeRecurringExpenses(db, date);
    const rows = db.prepare(
      'SELECT id, date, project, description, amount FROM expenses WHERE date = ? ORDER BY project, id'
    ).all(date);
    return res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/expenses/report?start=YYYY-MM-DD&end=YYYY-MM-DD&sort=date|project|amount
router.get('/expenses/report', (req, res, next) => {
  try {
    const { start, end } = req.query;
    const sort = ['date', 'project', 'amount'].includes(req.query.sort) ? req.query.sort : 'date';
    if (!start || !isValidDate(start)) {
      return res.status(400).json({ message: 'Invalid or missing start date. Expected YYYY-MM-DD.' });
    }
    if (!end || !isValidDate(end)) {
      return res.status(400).json({ message: 'Invalid or missing end date. Expected YYYY-MM-DD.' });
    }
    if (start > end) {
      return res.status(400).json({ message: 'start date must be on or before end date.' });
    }

    const db = getDb();
    materializeRecurringExpenses(db, end);
    const orderBy = {
      date: 'date, project, id',
      project: 'project, date, id',
      amount: 'amount DESC, date, project'
    }[sort];
    const rows = db.prepare(`
      SELECT id, date, project, description, amount, recurring_expense_id
      FROM expenses
      WHERE date >= ? AND date <= ?
      ORDER BY ${orderBy}
    `).all(start, end);
    const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return res.status(200).json({ rows, total });
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses
router.post('/expenses', (req, res, next) => {
  try {
    const { date, project, description, amount } = req.body;
    if (!date || !isValidDate(date)) {
      return res.status(400).json({ message: 'Invalid or missing date. Expected YYYY-MM-DD.' });
    }
    if (!project || typeof project !== 'string' || project.trim() === '') {
      return res.status(400).json({ message: 'project is required.' });
    }
    if (!isValidAmount(amount)) {
      return res.status(400).json({ message: 'amount must be a non-negative number.' });
    }

    const db = getDb();
    const normalizedProject = project.trim();
    const { map, missing } = getCanonicalProjectMap(db, [normalizedProject]);
    if (missing.length > 0) {
      return res.status(400).json({ message: `Unknown project: ${missing[0]}. Add it in Settings first.` });
    }

    const result = db.prepare(
      'INSERT INTO expenses (date, project, description, amount) VALUES (?, ?, ?, ?)'
    ).run(
      date,
      map.get(normalizedProject.toLowerCase()),
      typeof description === 'string' ? description.trim() : '',
      Number(amount)
    );
    const created = db.prepare(
      'SELECT id, date, project, description, amount FROM expenses WHERE id = ?'
    ).get(result.lastInsertRowid);
    return res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/expenses/:id
router.put('/expenses/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid expense id.' });

    const { project, description, amount } = req.body;
    if (!project || typeof project !== 'string' || project.trim() === '') {
      return res.status(400).json({ message: 'project is required.' });
    }
    if (!isValidAmount(amount)) {
      return res.status(400).json({ message: 'amount must be a non-negative number.' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM expenses WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ message: 'Expense not found.' });

    const normalizedProject = project.trim();
    const { map, missing } = getCanonicalProjectMap(db, [normalizedProject]);
    if (missing.length > 0) {
      return res.status(400).json({ message: `Unknown project: ${missing[0]}. Add it in Settings first.` });
    }

    db.prepare(
      'UPDATE expenses SET project = ?, description = ?, amount = ? WHERE id = ?'
    ).run(
      map.get(normalizedProject.toLowerCase()),
      typeof description === 'string' ? description.trim() : '',
      Number(amount),
      id
    );
    const updated = db.prepare(
      'SELECT id, date, project, description, amount FROM expenses WHERE id = ?'
    ).get(id);
    return res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/expenses/:id
router.delete('/expenses/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid expense id.' });

    const db = getDb();
    const result = db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ message: 'Expense not found.' });
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get('/recurring-expenses', (req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, project, description, amount, frequency, start_date, expiration_date, paused, stopped
      FROM recurring_expenses
      ORDER BY stopped, paused, project, description
    `).all();
    return res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/recurring-expenses', (req, res, next) => {
  try {
    const { project, description, amount, frequency, start_date, expiration_date } = req.body;
    if (!project || typeof project !== 'string' || project.trim() === '') {
      return res.status(400).json({ message: 'project is required.' });
    }
    if (!isValidAmount(amount)) return res.status(400).json({ message: 'amount must be a non-negative number.' });
    if (!['weekly', 'biweekly', 'monthly'].includes(frequency)) {
      return res.status(400).json({ message: 'frequency must be weekly, biweekly, or monthly.' });
    }
    if (!start_date || !isValidDate(start_date)) {
      return res.status(400).json({ message: 'Invalid or missing start_date. Expected YYYY-MM-DD.' });
    }
    if (expiration_date && !isValidDate(expiration_date)) {
      return res.status(400).json({ message: 'Invalid expiration_date. Expected YYYY-MM-DD.' });
    }

    const db = getDb();
    const normalizedProject = project.trim();
    const { map, missing } = getCanonicalProjectMap(db, [normalizedProject]);
    if (missing.length > 0) {
      return res.status(400).json({ message: `Unknown project: ${missing[0]}. Add it in Settings first.` });
    }

    const result = db.prepare(`
      INSERT INTO recurring_expenses (project, description, amount, frequency, start_date, expiration_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      map.get(normalizedProject.toLowerCase()),
      typeof description === 'string' ? description.trim() : '',
      Number(amount),
      frequency,
      start_date,
      expiration_date || null
    );
    materializeRecurringExpenses(db);
    const created = db.prepare('SELECT * FROM recurring_expenses WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.patch('/recurring-expenses/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid recurring expense id.' });
    const updates = [];
    const values = [];
    if (typeof req.body.paused === 'boolean') {
      updates.push('paused = ?');
      values.push(req.body.paused ? 1 : 0);
    }
    if (typeof req.body.stopped === 'boolean') {
      updates.push('stopped = ?');
      values.push(req.body.stopped ? 1 : 0);
    }
    if (updates.length === 0) return res.status(400).json({ message: 'No supported fields to update.' });

    const db = getDb();
    values.push(id);
    const result = db.prepare(`UPDATE recurring_expenses SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    if (result.changes === 0) return res.status(404).json({ message: 'Recurring expense not found.' });
    if (req.body.paused === false || req.body.stopped === false) materializeRecurringExpenses(db);
    const updated = db.prepare('SELECT * FROM recurring_expenses WHERE id = ?').get(id);
    return res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = { router, materializeRecurringExpenses };
