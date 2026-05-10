'use strict';

const fc = require('fast-check');
const { checkMinDuration, checkNoOverlap, validateEntries } = require('../lib/validator');

/** Convert total minutes to "HH:MM" */
function fromMinutes(total) {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Arbitrary for a valid 15-minute-aligned start time (0..23:45) */
const alignedMinutes = fc.integer({ min: 0, max: 95 }).map(n => n * 15); // 0..1425 (23:45)

// ─── Property Tests ───────────────────────────────────────────────────────────

// Feature: time-tracker, Property 2: Minimum duration validation
describe('Property 2: Minimum duration validation', () => {
  test('entry with duration < 15 min causes validateEntries to return valid:false with row error', () => {
    fc.assert(
      fc.property(
        // start anywhere from 00:00 to 23:45
        fc.integer({ min: 0, max: 95 }).map(n => n * 15),
        // duration: 0 to 14 minutes (but must be on 15-min boundary, so only 0 is valid here)
        // We use 0 to represent a zero-duration entry (start === end)
        (startMin) => {
          // Use start === end (0 duration) which is < 15 min
          const entry = {
            project: 'test',
            start_time: fromMinutes(startMin),
            end_time: fromMinutes(startMin) // same time = 0 duration
          };
          const result = validateEntries([entry]);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
          expect(result.errors[0].row).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: time-tracker, Property 3: Overlap validation
describe('Property 3: Overlap validation', () => {
  test('two entries with overlapping slots cause validateEntries to return valid:false', () => {
    fc.assert(
      fc.property(
        // Entry A: start at some aligned time, duration at least 30 min
        fc.integer({ min: 0, max: 80 }).map(n => n * 15), // start 0..20:00
        fc.integer({ min: 2, max: 4 }).map(n => n * 15),  // duration 30..60 min
        // Entry B starts inside Entry A's range
        fc.integer({ min: 1, max: 1 }),                    // offset multiplier (1 slot inside)
        (startA, durationA, offsetMult) => {
          const endA = startA + durationA;
          // B starts 15 min after A starts (inside A)
          const startB = startA + 15 * offsetMult;
          const endB = startB + 30; // 30 min duration

          // Only run if B actually overlaps A
          if (startB >= endA) return; // skip non-overlapping cases

          const entries = [
            { project: 'alpha', start_time: fromMinutes(startA), end_time: fromMinutes(endA) },
            { project: 'beta',  start_time: fromMinutes(startB), end_time: fromMinutes(endB) }
          ];
          const result = validateEntries(entries);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.message.includes('overlaps'))).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Example-Based Unit Tests ─────────────────────────────────────────────────

describe('checkMinDuration', () => {
  test('exactly 15 minutes is valid', () => {
    expect(checkMinDuration({ start_time: '09:00', end_time: '09:15' })).toBe(true);
  });

  test('14 minutes is invalid', () => {
    // Note: after rounding, times are on 15-min boundaries, so 14 min gap is not possible
    // but we test the raw function with non-rounded times
    expect(checkMinDuration({ start_time: '09:00', end_time: '09:14' })).toBe(false);
  });

  test('30 minutes is valid', () => {
    expect(checkMinDuration({ start_time: '09:00', end_time: '09:30' })).toBe(true);
  });

  test('0 minutes (same time) is invalid', () => {
    expect(checkMinDuration({ start_time: '10:00', end_time: '10:00' })).toBe(false);
  });
});

describe('checkNoOverlap', () => {
  test('adjacent non-overlapping entries are valid', () => {
    const entries = [
      { start_time: '09:00', end_time: '10:00' },
      { start_time: '10:00', end_time: '11:00' }
    ];
    const result = checkNoOverlap(entries);
    expect(result.valid).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  test('entries sharing only an endpoint are valid (boundary)', () => {
    const entries = [
      { start_time: '08:00', end_time: '09:00' },
      { start_time: '09:00', end_time: '10:00' }
    ];
    const result = checkNoOverlap(entries);
    expect(result.valid).toBe(true);
  });

  test('overlapping entries are invalid', () => {
    const entries = [
      { start_time: '09:00', end_time: '10:30' },
      { start_time: '10:00', end_time: '11:00' }
    ];
    const result = checkNoOverlap(entries);
    expect(result.valid).toBe(false);
    expect(result.conflicts).toContainEqual([0, 1]);
  });

  test('single entry has no conflicts', () => {
    const entries = [{ start_time: '09:00', end_time: '10:00' }];
    const result = checkNoOverlap(entries);
    expect(result.valid).toBe(true);
  });
});

describe('validateEntries', () => {
  test('valid entries return valid:true with no errors', () => {
    const entries = [
      { project: 'alpha', start_time: '09:00', end_time: '10:00' },
      { project: 'beta',  start_time: '10:00', end_time: '11:30' }
    ];
    const result = validateEntries(entries);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('short duration entry returns error with row index', () => {
    const entries = [
      { project: 'alpha', start_time: '09:00', end_time: '09:00' }
    ];
    const result = validateEntries(entries);
    expect(result.valid).toBe(false);
    expect(result.errors[0].row).toBe(0);
  });

  test('overlapping entries return error mentioning overlap', () => {
    const entries = [
      { project: 'alpha', start_time: '09:00', end_time: '10:30' },
      { project: 'beta',  start_time: '10:00', end_time: '11:00' }
    ];
    const result = validateEntries(entries);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('overlaps'))).toBe(true);
  });

  test('empty entries array is valid', () => {
    const result = validateEntries([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
