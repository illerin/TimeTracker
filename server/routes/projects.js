'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { normalizeProjectName } = require('../lib/normalizer');

function isValidStartHour(value) {
  return typeof value === 'string' && /^\d{2}$/.test(value) && Number(value) >= 0 && Number(value) <= 23;
}

function isValidEndHour(value) {
  return typeof value === 'string' && /^\d{2}$/.test(value) && Number(value) >= 0 && Number(value) <= 24;
}

function parseRate(value) {
  if (value === undefined || value === null || value === '') return 0;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}

function cleanProfile(body) {
  const kind = typeof body.kind === 'string' ? body.kind.trim().toLowerCase() : '';
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const details = typeof body.details === 'string' ? body.details.trim() : '';
  if (!['from', 'to'].includes(kind)) return { error: 'kind must be from or to.' };
  if (!label) return { error: 'label is required.' };
  return { kind, label, details };
}

// ─── GET /api/projects ────────────────────────────────────────────────────────
// Returns all managed project names, sorted. Includes hidden flag.
// Optional ?activeOnly=1 to return only non-hidden projects.
router.get('/projects', (req, res, next) => {
  try {
    const db = getDb();
    const activeOnly = req.query.activeOnly === '1';
    const sql = activeOnly
      ? 'SELECT id, name, hidden, hourly_rate FROM projects WHERE hidden = 0 ORDER BY name'
      : 'SELECT id, name, hidden, hourly_rate FROM projects ORDER BY name';
    const rows = db.prepare(sql).all();
    return res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/projects ───────────────────────────────────────────────────────
router.post('/projects', (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ message: 'name is required.' });
    }
    const normalized = normalizeProjectName(name);
    const db = getDb();

    // Check for duplicate (case-insensitive uniqueness)
    const existing = db.prepare('SELECT id, name, hidden, hourly_rate FROM projects WHERE name = ? COLLATE NOCASE').get(normalized);
    if (existing) {
      return res.status(409).json({ message: 'Project already exists.', project: existing });
    }

    const result = db.prepare('INSERT INTO projects (name) VALUES (?)').run(normalized);
    const created = db.prepare('SELECT id, name, hidden, hourly_rate FROM projects WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/projects/:id ────────────────────────────────────────────────────
router.put('/projects/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid project id.' });

    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ message: 'name is required.' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id, name, hidden, hourly_rate FROM projects WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ message: 'Project not found.' });

    const normalized = normalizeProjectName(name);

    // Check for name collision with another project (case-insensitive)
    const collision = db.prepare('SELECT id FROM projects WHERE name = ? COLLATE NOCASE AND id != ?').get(normalized, id);
    if (collision) return res.status(409).json({ message: 'Another project with that name already exists.' });

    // Update project name and cascade to time_entries
    db.transaction(() => {
      db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(normalized, id);
      db.prepare('UPDATE time_entries SET project = ? WHERE project = ?').run(normalized, existing.name);
    })();

    const updated = db.prepare('SELECT id, name, hidden, hourly_rate FROM projects WHERE id = ?').get(id);
    return res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/projects/:id/hidden ──────────────────────────────────────────
// Toggle the hidden flag. Body: { hidden: true|false }
router.patch('/projects/:id/hidden', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid project id.' });

    const { hidden } = req.body;
    if (typeof hidden !== 'boolean') {
      return res.status(400).json({ message: 'hidden must be a boolean.' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ message: 'Project not found.' });

    db.prepare('UPDATE projects SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id);
    const updated = db.prepare('SELECT id, name, hidden, hourly_rate FROM projects WHERE id = ?').get(id);
    return res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/projects/:id ─────────────────────────────────────────────────
router.delete('/projects/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid project id.' });

    const db = getDb();
    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ message: 'Project not found.' });

    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// PATCH /api/projects/:id/rate
router.patch('/projects/:id/rate', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid project id.' });

    const rate = parseRate(req.body.hourly_rate);
    if (rate === null) return res.status(400).json({ message: 'hourly_rate must be a non-negative number.' });

    const db = getDb();
    const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ message: 'Project not found.' });

    db.prepare('UPDATE projects SET hourly_rate = ? WHERE id = ?').run(rate, id);
    const updated = db.prepare('SELECT id, name, hidden, hourly_rate FROM projects WHERE id = ?').get(id);
    return res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

// GET /api/invoice-profiles?kind=from|to
router.get('/invoice-profiles', (req, res, next) => {
  try {
    const { kind } = req.query;
    const db = getDb();
    const rows = ['from', 'to'].includes(kind)
      ? db.prepare('SELECT id, kind, label, details FROM invoice_profiles WHERE kind = ? ORDER BY label').all(kind)
      : db.prepare('SELECT id, kind, label, details FROM invoice_profiles ORDER BY kind, label').all();
    return res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/invoice-profiles', (req, res, next) => {
  try {
    const profile = cleanProfile(req.body);
    if (profile.error) return res.status(400).json({ message: profile.error });

    const db = getDb();
    const result = db.prepare(
      'INSERT INTO invoice_profiles (kind, label, details) VALUES (?, ?, ?)'
    ).run(profile.kind, profile.label, profile.details);
    const created = db.prepare('SELECT id, kind, label, details FROM invoice_profiles WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put('/invoice-profiles/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid profile id.' });

    const profile = cleanProfile(req.body);
    if (profile.error) return res.status(400).json({ message: profile.error });

    const db = getDb();
    const existing = db.prepare('SELECT id FROM invoice_profiles WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ message: 'Profile not found.' });

    db.prepare('UPDATE invoice_profiles SET kind = ?, label = ?, details = ? WHERE id = ?')
      .run(profile.kind, profile.label, profile.details, id);
    const updated = db.prepare('SELECT id, kind, label, details FROM invoice_profiles WHERE id = ?').get(id);
    return res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/invoice-profiles/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid profile id.' });

    const db = getDb();
    const result = db.prepare('DELETE FROM invoice_profiles WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ message: 'Profile not found.' });
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/settings/time-window
router.get('/settings/time-window', (req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT key, value FROM settings WHERE key IN ('time_window_start', 'time_window_end')"
    ).all();
    const settings = Object.fromEntries(rows.map(row => [row.key, row.value]));
    return res.status(200).json({
      start: settings.time_window_start || '07',
      end: settings.time_window_end || '22'
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/time-window
router.put('/settings/time-window', (req, res, next) => {
  try {
    const { start, end } = req.body;
    if (!isValidStartHour(start) || !isValidEndHour(end)) {
      return res.status(400).json({ message: 'start must be 00-23 and end must be 00-24.' });
    }
    if (Number(start) > Number(end)) {
      return res.status(400).json({ message: 'start must be before or equal to end.' });
    }

    const db = getDb();
    const upsert = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `);
    db.transaction(() => {
      upsert.run('time_window_start', start);
      upsert.run('time_window_end', end);
    })();

    return res.status(200).json({ start, end });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
