'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join('/data', 'timetracker.db');

let _db = null;

/**
 * Returns the singleton better-sqlite3 database connection.
 * @returns {Database}
 */
function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
  }
  return _db;
}

/**
 * Initialises the database schema (idempotent).
 * Uses ALTER TABLE to add new columns to existing databases without data loss.
 */
function initSchema() {
  const db = getDb();

  // Core tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL UNIQUE,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT    NOT NULL,
      project     TEXT    NOT NULL,
      start_time  TEXT    NOT NULL,
      end_time    TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT    NOT NULL,
      project     TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      amount      REAL    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recurring_expenses (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project         TEXT    NOT NULL,
      description     TEXT    NOT NULL DEFAULT '',
      amount          REAL    NOT NULL,
      frequency       TEXT    NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
      start_date      TEXT    NOT NULL,
      expiration_date TEXT,
      paused          INTEGER NOT NULL DEFAULT 0,
      stopped         INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_entries_date
      ON time_entries(date);

    CREATE INDEX IF NOT EXISTS idx_entries_project
      ON time_entries(project);

    CREATE INDEX IF NOT EXISTS idx_expenses_date
      ON expenses(date);

    CREATE INDEX IF NOT EXISTS idx_expenses_project
      ON expenses(project);

    CREATE INDEX IF NOT EXISTS idx_recurring_expenses_active
      ON recurring_expenses(paused, stopped);

    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoice_profiles (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT NOT NULL CHECK (kind IN ('from', 'to')),
      label      TEXT NOT NULL,
      details    TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS standard_rates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      label       TEXT NOT NULL,
      amount      REAL NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS signatures (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      label       TEXT NOT NULL,
      mime_type   TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      signature_x REAL NOT NULL DEFAULT 0,
      signature_y REAL NOT NULL DEFAULT -62,
      signature_width REAL NOT NULL DEFAULT 180,
      signature_height REAL NOT NULL DEFAULT 55,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Add description column if it doesn't exist yet (migration for existing DBs)
  const cols = db.prepare("PRAGMA table_info(time_entries)").all();
  const hasDescription = cols.some(c => c.name === 'description');
  if (!hasDescription) {
    db.exec("ALTER TABLE time_entries ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }

  const expenseCols = db.prepare("PRAGMA table_info(expenses)").all();
  if (!expenseCols.some(c => c.name === 'recurring_expense_id')) {
    db.exec("ALTER TABLE expenses ADD COLUMN recurring_expense_id INTEGER");
  }
  if (!expenseCols.some(c => c.name === 'recurring_instance_date')) {
    db.exec("ALTER TABLE expenses ADD COLUMN recurring_instance_date TEXT");
  }

  // Add hidden column to projects if it doesn't exist yet
  const projCols = db.prepare("PRAGMA table_info(projects)").all();
  const hasHidden = projCols.some(c => c.name === 'hidden');
  if (!hasHidden) {
    db.exec("ALTER TABLE projects ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
  }
  const hasHourlyRate = projCols.some(c => c.name === 'hourly_rate');
  if (!hasHourlyRate) {
    db.exec("ALTER TABLE projects ADD COLUMN hourly_rate REAL NOT NULL DEFAULT 0");
  }

  const signatureCols = db.prepare("PRAGMA table_info(signatures)").all();
  if (!signatureCols.some(c => c.name === 'signature_x')) {
    db.exec("ALTER TABLE signatures ADD COLUMN signature_x REAL NOT NULL DEFAULT 0");
  }
  if (!signatureCols.some(c => c.name === 'signature_y')) {
    db.exec("ALTER TABLE signatures ADD COLUMN signature_y REAL NOT NULL DEFAULT -62");
  }
  if (!signatureCols.some(c => c.name === 'signature_width')) {
    db.exec("ALTER TABLE signatures ADD COLUMN signature_width REAL NOT NULL DEFAULT 180");
  }
  if (!signatureCols.some(c => c.name === 'signature_height')) {
    db.exec("ALTER TABLE signatures ADD COLUMN signature_height REAL NOT NULL DEFAULT 55");
  }

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  insertSetting.run('time_window_start', '07');
  insertSetting.run('time_window_end', '22');
  insertSetting.run('rate_mode', 'project');
}

// Initialise schema on module load
initSchema();

module.exports = { getDb, initSchema };
