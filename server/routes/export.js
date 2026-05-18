'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { aggregateByProject, roundToQuarter } = require('../lib/aggregator');
const { generateInvoiceXlsx, generateInvoicePdf } = require('../lib/exporter');
const { materializeRecurringExpenses } = require('./entries');

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
    const { start, end, projects, format, fromProfileId, toProfileId, invoiceNumber, invoiceDate, includeExpenses, preview } = req.query;

    if (!start || !isValidDate(start)) {
      return res.status(400).json({ message: 'Invalid or missing start date. Expected YYYY-MM-DD.' });
    }
    if (!end || !isValidDate(end)) {
      return res.status(400).json({ message: 'Invalid or missing end date. Expected YYYY-MM-DD.' });
    }
    if (start > end) {
      return res.status(400).json({ message: 'start date must be on or before end date.' });
    }

    const requestedProjects = Array.isArray(projects)
      ? projects
      : (typeof projects === 'string' && projects.trim() ? projects.split(',') : []);
    const selectedProjects = requestedProjects.length > 0
      ? new Set(requestedProjects.map(p => p.trim().toLowerCase()).filter(Boolean))
      : null;

    const db = getDb();
    if (includeExpenses === '1') materializeRecurringExpenses(db, end);
    const profileById = db.prepare('SELECT id, kind, label, details FROM invoice_profiles WHERE id = ?');
    const fromProfile = fromProfileId ? profileById.get(fromProfileId) : null;
    const toProfile = toProfileId ? profileById.get(toProfileId) : null;
    if (fromProfileId && (!fromProfile || fromProfile.kind !== 'from')) {
      return res.status(400).json({ message: 'Invalid From profile.' });
    }
    if (toProfileId && (!toProfile || toProfile.kind !== 'to')) {
      return res.status(400).json({ message: 'Invalid To profile.' });
    }

    const projectRows = db.prepare(
      'SELECT name, hourly_rate FROM projects ORDER BY name'
    ).all();
    const invoiceProjects = projectRows.filter(project =>
      !selectedProjects || selectedProjects.has(project.name.toLowerCase())
    );

    const entries = db.prepare(
      'SELECT date, project, start_time, end_time, description FROM time_entries WHERE date >= ? AND date <= ? ORDER BY date, start_time'
    ).all(start, end);
    const expenses = includeExpenses === '1'
      ? db.prepare(
        'SELECT date, project, description, amount FROM expenses WHERE date >= ? AND date <= ? ORDER BY date, project, id'
      ).all(start, end)
      : [];

    const grouped = new Map();
    for (const entry of entries) {
      if (selectedProjects && !selectedProjects.has(entry.project.toLowerCase())) continue;
      const description = entry.description && entry.description.trim()
        ? entry.description.trim()
        : entry.project;
      const key = `${entry.date}|${description}`;
      if (!grouped.has(key)) {
        grouped.set(key, { date: entry.date, description, hoursByProject: {} });
      }
      const g = grouped.get(key);
      const [h1, m1] = entry.start_time.split(':').map(Number);
      const [h2, m2] = entry.end_time.split(':').map(Number);
      const hours = ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60;
      g.hoursByProject[entry.project] = (g.hoursByProject[entry.project] || 0) + hours;
    }

    const invoice = {
      number: typeof invoiceNumber === 'string' ? invoiceNumber.trim() : '',
      date: typeof invoiceDate === 'string' && invoiceDate.trim() ? invoiceDate.trim() : new Date().toISOString().slice(0, 10),
      from: fromProfile,
      to: toProfile,
      projects: invoiceProjects,
      expenses: expenses
        .filter(expense => !selectedProjects || selectedProjects.has(expense.project.toLowerCase()))
        .map(expense => ({
          date: expense.date,
          project: expense.project,
          description: expense.description || expense.project,
          amount: Number(expense.amount || 0)
        })),
      lines: [...grouped.values()]
        .map(line => {
          const rounded = {};
          for (const [project, value] of Object.entries(line.hoursByProject)) {
            rounded[project] = roundToQuarter(value);
          }
          return { ...line, hoursByProject: rounded };
        })
        .sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description))
    };

    const wantsPdf = format === 'pdf';
    const buffer = wantsPdf
      ? await generateInvoicePdf(invoice)
      : await generateInvoiceXlsx(invoice);

    res.setHeader(
      'Content-Type',
      wantsPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    const disposition = wantsPdf && preview === '1' ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="timetracker-invoice.${wantsPdf ? 'pdf' : 'xlsx'}"`);
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
    const projects = db.prepare('SELECT id, name, hidden, hourly_rate, created_at FROM projects ORDER BY id').all();
    const entries  = db.prepare(
      'SELECT id, date, project, start_time, end_time, description, created_at FROM time_entries ORDER BY id'
    ).all();
    const expenses = db.prepare(
      'SELECT id, date, project, description, amount, recurring_expense_id, recurring_instance_date, created_at FROM expenses ORDER BY id'
    ).all();
    const recurringExpenses = db.prepare(
      'SELECT id, project, description, amount, frequency, start_date, expiration_date, paused, stopped, created_at FROM recurring_expenses ORDER BY id'
    ).all();
    const settings = db.prepare('SELECT key, value, updated_at FROM settings ORDER BY key').all();
    const invoiceProfiles = db.prepare('SELECT id, kind, label, details, created_at FROM invoice_profiles ORDER BY id').all();

    const backup = {
      version:    1,
      exported_at: new Date().toISOString(),
      projects,
      time_entries: entries,
      expenses,
      recurring_expenses: recurringExpenses,
      settings,
      invoice_profiles: invoiceProfiles
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
      let expensesAdded = 0;
      let expensesSkipped = 0;
      let settingsUpdated = 0;

      // Upsert projects (insert if name doesn't exist, case-insensitive)
      const findProject   = db.prepare('SELECT id FROM projects WHERE name = ? COLLATE NOCASE');
      const insertProject = db.prepare('INSERT INTO projects (name, hidden, hourly_rate) VALUES (?, ?, ?)');
      const updateProject = db.prepare('UPDATE projects SET hidden = ?, hourly_rate = ? WHERE id = ?');

      for (const p of backup.projects) {
        if (!p.name || typeof p.name !== 'string') continue;
        const name = p.name.trim();
        if (!name) continue;
        const hidden = p.hidden ? 1 : 0;
        const hourlyRate = Number.isFinite(Number(p.hourly_rate)) ? Number(p.hourly_rate) : 0;
        const existing = findProject.get(name);
        if (!existing) {
          insertProject.run(name, hidden, hourlyRate);
          projectsAdded++;
        } else {
          updateProject.run(hidden, hourlyRate, existing.id);
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

      if (Array.isArray(backup.expenses)) {
        const findExpense = db.prepare(
          'SELECT id FROM expenses WHERE date = ? AND project = ? AND description = ? AND amount = ?'
        );
        const insertExpense = db.prepare(
          'INSERT INTO expenses (date, project, description, amount) VALUES (?, ?, ?, ?)'
        );
        for (const expense of backup.expenses) {
          if (!expense.date || !expense.project) continue;
          const description = expense.description || '';
          const amount = Number(expense.amount || 0);
          const existing = findExpense.get(expense.date, expense.project, description, amount);
          if (existing) {
            expensesSkipped++;
          } else {
            insertExpense.run(expense.date, expense.project, description, amount);
            expensesAdded++;
          }
        }
      }

      if (Array.isArray(backup.recurring_expenses)) {
        const findRecurring = db.prepare(`
          SELECT id FROM recurring_expenses
          WHERE project = ? AND description = ? AND amount = ? AND frequency = ? AND start_date = ?
        `);
        const insertRecurring = db.prepare(`
          INSERT INTO recurring_expenses (project, description, amount, frequency, start_date, expiration_date, paused, stopped)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const updateRecurring = db.prepare(
          'UPDATE recurring_expenses SET expiration_date = ?, paused = ?, stopped = ? WHERE id = ?'
        );
        for (const rule of backup.recurring_expenses) {
          if (!rule.project || !rule.frequency || !rule.start_date) continue;
          if (!['weekly', 'biweekly', 'monthly'].includes(rule.frequency)) continue;
          const description = rule.description || '';
          const amount = Number(rule.amount || 0);
          const existing = findRecurring.get(rule.project, description, amount, rule.frequency, rule.start_date);
          if (existing) {
            updateRecurring.run(rule.expiration_date || null, rule.paused ? 1 : 0, rule.stopped ? 1 : 0, existing.id);
          } else {
            insertRecurring.run(
              rule.project,
              description,
              amount,
              rule.frequency,
              rule.start_date,
              rule.expiration_date || null,
              rule.paused ? 1 : 0,
              rule.stopped ? 1 : 0
            );
          }
        }
      }

      if (Array.isArray(backup.settings)) {
        const upsertSetting = db.prepare(`
          INSERT INTO settings (key, value, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
        `);
        for (const setting of backup.settings) {
          if (!setting.key || typeof setting.key !== 'string') continue;
          if (typeof setting.value !== 'string') continue;
          upsertSetting.run(setting.key, setting.value);
          settingsUpdated++;
        }
      }

      if (Array.isArray(backup.invoice_profiles)) {
        const insertProfile = db.prepare(
          'INSERT INTO invoice_profiles (kind, label, details) VALUES (?, ?, ?)'
        );
        const findProfile = db.prepare(
          'SELECT id FROM invoice_profiles WHERE kind = ? AND label = ? COLLATE NOCASE'
        );
        const updateProfile = db.prepare(
          'UPDATE invoice_profiles SET details = ? WHERE id = ?'
        );
        for (const profile of backup.invoice_profiles) {
          if (!['from', 'to'].includes(profile.kind)) continue;
          if (!profile.label || typeof profile.label !== 'string') continue;
          const label = profile.label.trim();
          const details = typeof profile.details === 'string' ? profile.details : '';
          const existing = findProfile.get(profile.kind, label);
          if (existing) updateProfile.run(details, existing.id);
          else insertProfile.run(profile.kind, label, details);
        }
      }

      return { projectsAdded, entriesAdded, entriesSkipped, expensesAdded, expensesSkipped, settingsUpdated };
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
