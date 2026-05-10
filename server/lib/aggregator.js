'use strict';

/**
 * Rounds a decimal hours value to the nearest 0.25 hours.
 * @param {number} hours
 * @returns {number}
 */
function roundToQuarter(hours) {
  return Math.round(hours * 4) / 4;
}

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
 * Aggregates total hours per project from an array of time entries.
 * Each entry must have { project, start_time, end_time }.
 * Returns a Map<projectName, totalHours> where totalHours is rounded to 0.25.
 *
 * @param {Array<{ project: string, start_time: string, end_time: string }>} entries
 * @returns {Map<string, number>}
 */
function aggregateByProject(entries) {
  const totals = new Map();

  for (const entry of entries) {
    const durationHours = (toMinutes(entry.end_time) - toMinutes(entry.start_time)) / 60;
    const current = totals.get(entry.project) || 0;
    totals.set(entry.project, current + durationHours);
  }

  // Round each total to nearest 0.25
  for (const [project, hours] of totals) {
    totals.set(project, roundToQuarter(hours));
  }

  return totals;
}

/**
 * Formats an aggregated hours value as a display string, e.g. "3.75 hrs".
 * @param {number} hours
 * @returns {string}
 */
function formatHours(hours) {
  // Remove trailing zeros after decimal point where possible
  const str = hours % 1 === 0 ? String(hours) : String(hours);
  return `${str} hrs`;
}

module.exports = { roundToQuarter, aggregateByProject, formatHours, toMinutes };
