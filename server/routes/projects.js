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

function cleanStandardRate(body) {
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const amount = parseRate(body.amount);
  if (!label) return { error: 'label is required.' };
  if (amount === null) return { error: 'amount must be a non-negative number.' };
  return { label, amount };
}

function cleanSignature(body) {
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl.trim() : '';
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!label) return { error: 'label is required.' };
  if (!match) return { error: 'signature must be a PNG, JPG, or WebP image.' };
  const placement = body.placement && typeof body.placement === 'object' ? body.placement : {};
  const signature_x = Number.isFinite(Number(placement.x)) ? Number(placement.x) : 0;
  const signature_y = Number.isFinite(Number(placement.y)) ? Number(placement.y) : -62;
  const signature_width = Number.isFinite(Number(placement.width)) && Number(placement.width) > 0 ? Number(placement.width) : 180;
  const signature_height = Number.isFinite(Number(placement.height)) && Number(placement.height) > 0 ? Number(placement.height) : 55;
  return { label, mime_type: match[1], data_base64: match[2], signature_x, signature_y, signature_width, signature_height };
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

router.get('/settings/rate-mode', (req, res, next) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'rate_mode'").get();
    const mode = row && ['project', 'standard'].includes(row.value) ? row.value : 'project';
    return res.status(200).json({ mode });
  } catch (err) {
    next(err);
  }
});

router.put('/settings/rate-mode', (req, res, next) => {
  try {
    const mode = typeof req.body.mode === 'string' ? req.body.mode : '';
    if (!['project', 'standard'].includes(mode)) {
      return res.status(400).json({ message: 'mode must be project or standard.' });
    }

    const db = getDb();
    db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('rate_mode', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(mode);
    return res.status(200).json({ mode });
  } catch (err) {
    next(err);
  }
});

router.get('/standard-rates', (req, res, next) => {
  try {
    const rows = getDb().prepare('SELECT id, label, amount FROM standard_rates ORDER BY label').all();
    return res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/standard-rates', (req, res, next) => {
  try {
    const rate = cleanStandardRate(req.body);
    if (rate.error) return res.status(400).json({ message: rate.error });

    const db = getDb();
    const result = db.prepare('INSERT INTO standard_rates (label, amount) VALUES (?, ?)').run(rate.label, rate.amount);
    const created = db.prepare('SELECT id, label, amount FROM standard_rates WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put('/standard-rates/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid rate id.' });
    const rate = cleanStandardRate(req.body);
    if (rate.error) return res.status(400).json({ message: rate.error });

    const db = getDb();
    const result = db.prepare('UPDATE standard_rates SET label = ?, amount = ? WHERE id = ?').run(rate.label, rate.amount, id);
    if (result.changes === 0) return res.status(404).json({ message: 'Standard rate not found.' });
    const updated = db.prepare('SELECT id, label, amount FROM standard_rates WHERE id = ?').get(id);
    return res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/standard-rates/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid rate id.' });
    const result = getDb().prepare('DELETE FROM standard_rates WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ message: 'Standard rate not found.' });
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get('/signatures', (req, res, next) => {
  try {
    const rows = getDb().prepare('SELECT id, label, mime_type, signature_x, signature_y, signature_width, signature_height FROM signatures ORDER BY label').all();
    return res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/signatures', (req, res, next) => {
  try {
    const signature = cleanSignature(req.body);
    if (signature.error) return res.status(400).json({ message: signature.error });

    const db = getDb();
    const result = db.prepare(
      'INSERT INTO signatures (label, mime_type, data_base64, signature_x, signature_y, signature_width, signature_height) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      signature.label,
      signature.mime_type,
      signature.data_base64,
      signature.signature_x,
      signature.signature_y,
      signature.signature_width,
      signature.signature_height
    );
    const created = db.prepare('SELECT id, label, mime_type, signature_x, signature_y, signature_width, signature_height FROM signatures WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.delete('/signatures/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid signature id.' });
    const result = getDb().prepare('DELETE FROM signatures WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ message: 'Signature not found.' });
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
