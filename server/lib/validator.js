'use strict';

/**
 * Converts a "HH:MM" time string to total minutes since midnight.
 * @param {string} timeStr
 * @returns {number}
 */
function toMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Checks that a single entry has a duration of at least 15 minutes.
 * Assumes start_time and end_time are already rounded to 15-minute boundaries.
 *
 * @param {{ start_time: string, end_time: string }} entry
 * @returns {boolean}
 */
function checkMinDuration(entry) {
  return toMinutes(entry.end_time) - toMinutes(entry.start_time) >= 15;
}

/**
 * Checks that no two entries in the array have overlapping time slots.
 * Two intervals [s1,e1) and [s2,e2) overlap iff s1 < e2 && s2 < e1.
 *
 * @param {Array<{ start_time: string, end_time: string }>} entries
 * @returns {{ valid: boolean, conflicts: Array<[number, number]> }}
 */
function checkNoOverlap(entries) {
  const conflicts = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const s1 = toMinutes(entries[i].start_time);
      const e1 = toMinutes(entries[i].end_time);
      const s2 = toMinutes(entries[j].start_time);
      const e2 = toMinutes(entries[j].end_time);
      if (s1 < e2 && s2 < e1) {
        conflicts.push([i, j]);
      }
    }
  }
  return { valid: conflicts.length === 0, conflicts };
}

/**
 * Validates a set of time entries for a single workday.
 * Runs both minimum-duration and overlap checks, collecting all errors.
 *
 * @param {Array<{ project: string, start_time: string, end_time: string }>} entries
 * @returns {{ valid: boolean, errors: Array<{ row: number, message: string }> }}
 */
function validateEntries(entries) {
  const errors = [];

  // Check minimum duration for each entry
  for (let i = 0; i < entries.length; i++) {
    if (!checkMinDuration(entries[i])) {
      errors.push({
        row: i,
        message: `Row ${i + 1}: Duration must be at least 15 minutes after rounding.`
      });
    }
  }

  // Check for overlapping time slots
  const { conflicts } = checkNoOverlap(entries);
  for (const [i, j] of conflicts) {
    errors.push({
      row: i,
      message: `Row ${i + 1} overlaps with row ${j + 1}.`
    });
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { checkMinDuration, checkNoOverlap, validateEntries, toMinutes };
