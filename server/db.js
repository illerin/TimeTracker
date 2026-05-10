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

    CREATE INDEX IF NOT EXISTS idx_entries_date
      ON time_entries(date);

    CREATE INDEX IF NOT EXISTS idx_entries_project
      ON time_entries(project);
  `);

  // Add description column if it doesn't exist yet (migration for existing DBs)
  const cols = db.prepare("PRAGMA table_info(time_entries)").all();
  const hasDescription = cols.some(c => c.name === 'description');
  if (!hasDescription) {
    db.exec("ALTER TABLE time_entries ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }

  // Add hidden column to projects if it doesn't exist yet
  const projCols = db.prepare("PRAGMA table_info(projects)").all();
  const hasHidden = projCols.some(c => c.name === 'hidden');
  if (!hasHidden) {
    db.exec("ALTER TABLE projects ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
  }
}

// Initialise schema on module load
initSchema();

module.exports = { getDb, initSchema };
