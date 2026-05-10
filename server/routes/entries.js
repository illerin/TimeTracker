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

function normalizeEntry(entry) {
  return {
    project:     entry.project.trim(),
    start_time:  roundToNearest15(entry.start_time),
    end_time:    roundToNearest15(entry.end_time),
    description: typeof entry.description === 'string' ? entry.description.trim() : ''
  };
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
      if (!e.start_time || !TIME_RE.test(e.start_time)) {
        return res.status(400).json({ message: `Row ${i + 1}: start_time must be HH:MM.` });
      }
      if (!e.end_time || !TIME_RE.test(e.end_time)) {
        return res.status(400).json({ message: `Row ${i + 1}: end_time must be HH:MM.` });
      }
    }

    const normalized = entries.map(normalizeEntry);

    const { valid, errors } = validateEntries(normalized);
    if (!valid) {
      return res.status(422).json({ errors });
    }

    const db = getDb();
    const insert = db.prepare(
      'INSERT INTO time_entries (date, project, start_time, end_time, description) VALUES (?, ?, ?, ?, ?)'
    );
    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        insert.run(date, row.project, row.start_time, row.end_time, row.description);
      }
    });
    insertMany(normalized);

    return res.status(201).json({ inserted: normalized.length });
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
    if (!start_time || !TIME_RE.test(start_time)) {
      return res.status(400).json({ message: 'start_time must be HH:MM.' });
    }
    if (!end_time || !TIME_RE.test(end_time)) {
      return res.status(400).json({ message: 'end_time must be HH:MM.' });
    }

    const updated = normalizeEntry({ project, start_time, end_time, description });

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

module.exports = router;
