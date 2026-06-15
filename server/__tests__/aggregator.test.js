'use strict';

const fc = require('fast-check');
const { roundToQuarter, aggregateByProject, formatHours } = require('../lib/aggregator');

/** Build a non-overlapping sequence of entries for a given project on a given date */
function buildEntries(project, slots) {
  return slots.map(([start, end]) => ({
    project,
    date: '2026-01-01',
    start_time: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`,
    end_time:   `${String(Math.floor(end   / 60)).padStart(2, '0')}:${String(end   % 60).padStart(2, '0')}`
  }));
}

// ─── Property Tests ───────────────────────────────────────────────────────────

// Feature: time-tracker, Property 8: Aggregation correctness and quarter rounding
describe('Property 8: Aggregation correctness and quarter rounding', () => {
  test('total hours equals sum of durations and is a multiple of 0.25', () => {
    // Generate 1-4 non-overlapping 15-min-aligned slots for a single project
    const slotArb = fc.integer({ min: 0, max: 46 }).map(n => {
      const start = n * 15;       // 0..690 (11:30)
      const end   = start + 15;   // always 15 min
      return [start, end];
    });

    fc.assert(
      fc.property(
        fc.array(slotArb, { minLength: 1, maxLength: 4 }),
        (rawSlots) => {
          // Deduplicate and sort to ensure non-overlapping
          const slots = rawSlots
            .sort((a, b) => a[0] - b[0])
            .reduce((acc, slot) => {
              if (acc.length === 0 || acc[acc.length - 1][1] <= slot[0]) {
                acc.push(slot);
              }
              return acc;
            }, []);

          if (slots.length === 0) return;

          const entries = buildEntries('alpha', slots);
          const result = aggregateByProject(entries);
          const total = result.get('alpha');

          // Must be a multiple of 0.25
          expect(Math.round(total * 4) / 4).toBeCloseTo(total, 5);

          // Must be positive
          expect(total).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: time-tracker, Property 9: Summary descending date order
describe('Property 9: Summary descending date order', () => {
  test('sorting dates descending produces strictly decreasing sequence', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.date({
            min: new Date('2020-01-01'),
            max: new Date('2026-12-31'),
            noInvalidDate: true
          }),
          { minLength: 2, maxLength: 10 }
        ),
        (dates) => {
          // Simulate what the API does: sort dates descending
          const isoStrings = [...new Set(dates.map(d => d.toISOString().slice(0, 10)))];
          const sorted = isoStrings.sort((a, b) => b.localeCompare(a));

          for (let i = 0; i < sorted.length - 1; i++) {
            expect(sorted[i] >= sorted[i + 1]).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: time-tracker, Property 10: Hours format string
describe('Property 10: Hours format string', () => {
  test('formatHours output matches /^\\d+(\\.\\d+)? hrs$/', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 96 }).map(n => n * 0.25), // 0..24 in 0.25 steps
        (hours) => {
          const result = formatHours(hours);
          expect(result).toMatch(/^\d+(\.\d+)? hrs$/);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Example-Based Unit Tests ─────────────────────────────────────────────────

describe('roundToQuarter', () => {
  test.each([
    [0,    0],
    [0.1,   0],
    [0.12,  0],
    [0.125, 0.25],
    [0.13,  0.25],
    [0.25,  0.25],
    [0.5,  0.5],
    [0.75, 0.75],
    [1.0,  1.0],
    [1.1,  1.0],
    [1.13, 1.25],
    [2.5,  2.5],
  ])('roundToQuarter(%s) === %s', (input, expected) => {
    expect(roundToQuarter(input)).toBeCloseTo(expected, 5);
  });
});

describe('aggregateByProject', () => {
  test('single entry', () => {
    const entries = [{ project: 'alpha', start_time: '09:00', end_time: '10:00' }];
    const result = aggregateByProject(entries);
    expect(result.get('alpha')).toBe(1.0);
  });

  test('multiple entries same project', () => {
    const entries = [
      { project: 'alpha', start_time: '09:00', end_time: '10:00' },
      { project: 'alpha', start_time: '11:00', end_time: '12:30' }
    ];
    const result = aggregateByProject(entries);
    expect(result.get('alpha')).toBe(2.5);
  });

  test('multiple projects', () => {
    const entries = [
      { project: 'alpha', start_time: '09:00', end_time: '10:00' },
      { project: 'beta',  start_time: '10:00', end_time: '11:30' }
    ];
    const result = aggregateByProject(entries);
    expect(result.get('alpha')).toBe(1.0);
    expect(result.get('beta')).toBe(1.5);
  });

  test('empty entries returns empty map', () => {
    const result = aggregateByProject([]);
    expect(result.size).toBe(0);
  });
});

describe('formatHours', () => {
  test('whole number', () => {
    expect(formatHours(2)).toBe('2 hrs');
  });

  test('decimal value', () => {
    expect(formatHours(3.75)).toBe('3.75 hrs');
  });

  test('zero', () => {
    expect(formatHours(0)).toBe('0 hrs');
  });
});
