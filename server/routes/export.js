'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { aggregateByProject, roundToQuarter } = require('../lib/aggregator');
const { generateXlsx } = require('../lib/exporter');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(str) {
  if (!DATE_RE.test(str)) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

/**
 * Fetch all entries in a date range and build aggregated summary rows.
 * Returns Array<{ date, projects: [{ project, hours }] }> sorted by date descending.
 */
function buildSummary(start, end) {
  const db = getDb();
  const entries = db.prepare(
    'SELECT date, project, start_time, end_time FROM time_entries WHERE date >= ? AND date <= ? ORDER BY date, start_time'
  ).all(start, end);

  // Group entries by date
  const byDate = new Map();
  for (const entry of entries) {
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date).push(entry);
  }

  // Aggregate per date
  const summary = [];
  for (const [date, dateEntries] of byDate) {
    const totals = aggregateByProject(dateEntries);
    const projects = [...totals.entries()].map(([project, hours]) => ({ project, hours }));
    projects.sort((a, b) => a.project.localeCompare(b.project));
    summary.push({ date, projects });
  }

  // Sort dates descending
  summary.sort((a, b) => b.date.localeCompare(a.date));
  return summary;
}

// ─── GET /api/summary?start=YYYY-MM-DD&end=YYYY-MM-DD ────────────────────────
router.get('/summary', (req, res, next) => {
  try {
    const { start, end } = req.query;

    if (!start || !isValidDate(start)) {
      return res.status(400).json({ message: 'Invalid or missing start date. Expected YYYY-MM-DD.' });
    }
    if (!end || !isValidDate(end)) {
      return res.status(400).json({ message: 'Invalid or missing end date. Expected YYYY-MM-DD.' });
    }
    if (start > end) {
      return res.status(400).json({ message: 'start date must be on or before end date.' });
    }

    const summary = buildSummary(start, end);
    return res.status(200).json(summary);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/export?start=YYYY-MM-DD&end=YYYY-MM-DD ─────────────────────────
router.get('/export', async (req, res, next) => {
  try {
    const { start, end } = req.query;

    if (!start || !isValidDate(start)) {
      return res.status(400).json({ message: 'Invalid or missing start date. Expected YYYY-MM-DD.' });
    }
    if (!end || !isValidDate(end)) {
      return res.status(400).json({ message: 'Invalid or missing end date. Expected YYYY-MM-DD.' });
    }
    if (start > end) {
      return res.status(400).json({ message: 'start date must be on or before end date.' });
    }

    // Fetch all entries in range and build flat aggregated rows for the exporter
    const db = getDb();
    const entries = db.prepare(
      'SELECT date, project, start_time, end_time, description FROM time_entries WHERE date >= ? AND date <= ? ORDER BY date, start_time'
    ).all(start, end);

    // Group by date+project: aggregate hours and collect descriptions
    const grouped = new Map();
    for (const entry of entries) {
      const key = `${entry.date}|${entry.project}`;
      if (!grouped.has(key)) {
        grouped.set(key, { date: entry.date, project: entry.project, totalMin: 0, descriptions: new Set() });
      }
      const g = grouped.get(key);
      const [h1, m1] = entry.start_time.split(':').map(Number);
      const [h2, m2] = entry.end_time.split(':').map(Number);
      g.totalMin += (h2 * 60 + m2) - (h1 * 60 + m1);
      if (entry.description && entry.description.trim()) {
        g.descriptions.add(entry.description.trim());
      }
    }

    const rows = [...grouped.values()].map(r => ({
      date:         r.date,
      project:      r.project,
      hours:        roundToQuarter(r.totalMin / 60),
      descriptions: [...r.descriptions]
    }));

    const buffer = await generateXlsx(rows);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="timetracker-export.xlsx"`);
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/daily-totals?start=YYYY-MM-DD&end=YYYY-MM-DD ──────────────────
// Returns { "YYYY-MM-DD": totalHours, ... } for all dates in range that have entries.
router.get('/daily-totals', (req, res, next) => {
  try {
    const { start, end } = req.query;
    if (!start || !isValidDate(start)) {
      return res.status(400).json({ message: 'Invalid or missing start date. Expected YYYY-MM-DD.' });
    }
    if (!end || !isValidDate(end)) {
      return res.status(400).json({ message: 'Invalid or missing end date. Expected YYYY-MM-DD.' });
    }

    const db = getDb();
    const entries = db.prepare(
      'SELECT date, start_time, end_time FROM time_entries WHERE date >= ? AND date <= ?'
    ).all(start, end);

    const totals = {};
    for (const entry of entries) {
      const [h1, m1] = entry.start_time.split(':').map(Number);
      const [h2, m2] = entry.end_time.split(':').map(Number);
      const hours = ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60;
      totals[entry.date] = (totals[entry.date] || 0) + hours;
    }

    return res.status(200).json(totals);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/backup ──────────────────────────────────────────────────────────
// Returns a full JSON backup of all projects and time entries.
router.get('/backup', (req, res, next) => {
  try {
    const db = getDb();
    const projects = db.prepare('SELECT id, name, created_at FROM projects ORDER BY id').all();
    const entries  = db.prepare(
      'SELECT id, date, project, start_time, end_time, description, created_at FROM time_entries ORDER BY id'
    ).all();

    const backup = {
      version:    1,
      exported_at: new Date().toISOString(),
      projects,
      time_entries: entries
    };

    const filename = `timetracker-backup-${new Date().toISOString().slice(0,10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(JSON.stringify(backup, null, 2));
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/restore ────────────────────────────────────────────────────────
// Accepts a JSON backup and merges it into the database.
// Projects are upserted by name (case-insensitive). Entries are inserted only
// if no entry with the same date+project+start_time already exists.
router.post('/restore', (req, res, next) => {
  try {
    const backup = req.body;

    if (!backup || backup.version !== 1) {
      return res.status(400).json({ message: 'Invalid backup file. Expected version 1 JSON.' });
    }
    if (!Array.isArray(backup.projects) || !Array.isArray(backup.time_entries)) {
      return res.status(400).json({ message: 'Backup must contain projects and time_entries arrays.' });
    }

    const db = getDb();

    const stats = db.transaction(() => {
      let projectsAdded  = 0;
      let entriesAdded   = 0;
      let entriesSkipped = 0;

      // Upsert projects (insert if name doesn't exist, case-insensitive)
      const findProject  = db.prepare('SELECT id FROM projects WHERE name = ? COLLATE NOCASE');
      const insertProject = db.prepare('INSERT INTO projects (name) VALUES (?)');

      for (const p of backup.projects) {
        if (!p.name || typeof p.name !== 'string') continue;
        const name = p.name.trim();
        if (!name) continue;
        const existing = findProject.get(name);
        if (!existing) {
          insertProject.run(name);
          projectsAdded++;
        }
      }

      // Insert entries that don't already exist (match on date + project + start_time)
      const findEntry = db.prepare(
        'SELECT id FROM time_entries WHERE date = ? AND project = ? AND start_time = ?'
      );
      const insertEntry = db.prepare(
        'INSERT INTO time_entries (date, project, start_time, end_time, description) VALUES (?, ?, ?, ?, ?)'
      );

      for (const e of backup.time_entries) {
        if (!e.date || !e.project || !e.start_time || !e.end_time) continue;
        const existing = findEntry.get(e.date, e.project, e.start_time);
        if (existing) {
          entriesSkipped++;
        } else {
          insertEntry.run(e.date, e.project, e.start_time, e.end_time, e.description || '');
          entriesAdded++;
        }
      }

      return { projectsAdded, entriesAdded, entriesSkipped };
    })();

    return res.status(200).json({
      message: `Restore complete.`,
      ...stats
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
