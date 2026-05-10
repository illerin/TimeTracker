'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { normalizeProjectName } = require('../lib/normalizer');

// ─── GET /api/projects ────────────────────────────────────────────────────────
// Returns all managed project names, sorted. Includes hidden flag.
// Optional ?activeOnly=1 to return only non-hidden projects.
router.get('/projects', (req, res, next) => {
  try {
    const db = getDb();
    const activeOnly = req.query.activeOnly === '1';
    const sql = activeOnly
      ? 'SELECT id, name, hidden FROM projects WHERE hidden = 0 ORDER BY name'
      : 'SELECT id, name, hidden FROM projects ORDER BY name';
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
    const existing = db.prepare('SELECT id, name, hidden FROM projects WHERE name = ? COLLATE NOCASE').get(normalized);
    if (existing) {
      return res.status(409).json({ message: 'Project already exists.', project: existing });
    }

    const result = db.prepare('INSERT INTO projects (name) VALUES (?)').run(normalized);
    const created = db.prepare('SELECT id, name, hidden FROM projects WHERE id = ?').get(result.lastInsertRowid);
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
    const existing = db.prepare('SELECT id, name, hidden FROM projects WHERE id = ?').get(id);
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

    const updated = db.prepare('SELECT id, name, hidden FROM projects WHERE id = ?').get(id);
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
    const updated = db.prepare('SELECT id, name, hidden FROM projects WHERE id = ?').get(id);
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

module.exports = router;
