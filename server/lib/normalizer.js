'use strict';

/**
 * Rounds a time string "HH:MM" to the nearest 15-minute interval.
 * Ties (e.g. :07 or :22 or :37 or :52) round up.
 * Handles midnight rollover (e.g. 23:53 → 00:00).
 *
 * @param {string} timeStr - Time in "HH:MM" format (24-hour)
 * @returns {string} Rounded time in "HH:MM" format
 */
function roundToNearest15(timeStr) {
  const [hourStr, minStr] = timeStr.split(':');
  let hours = parseInt(hourStr, 10);
  let minutes = parseInt(minStr, 10);

  // Round minutes to nearest 15; ties round up
  const remainder = minutes % 15;
  if (remainder === 0) {
    // already on a boundary — no change
  } else if (remainder < 8) {
    // round down
    minutes = minutes - remainder;
  } else {
    // round up
    minutes = minutes + (15 - remainder);
  }

  // Handle overflow (e.g. 59 min rounds up to 60 → next hour)
  if (minutes === 60) {
    minutes = 0;
    hours += 1;
  }

  // Handle midnight rollover (24:00 → 00:00)
  if (hours === 24) {
    hours = 0;
  }

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Normalises a project name: trims whitespace only. Case is preserved.
 *
 * @param {string} name
 * @returns {string}
 */
function normalizeProjectName(name) {
  return name.trim();
}

module.exports = { roundToNearest15, normalizeProjectName };
