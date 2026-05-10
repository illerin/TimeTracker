'use strict';

const fc = require('fast-check');
const { roundToNearest15, normalizeProjectName } = require('../lib/normalizer');

// ─── Property Tests ───────────────────────────────────────────────────────────

// Feature: time-tracker, Property 1: Time normalization
describe('Property 1: Time normalization', () => {
  test('result minutes are in {0,15,30,45} and rounding error ≤ 7 minutes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (hour, minute) => {
          const input = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
          const result = roundToNearest15(input);
          const [rh, rm] = result.split(':').map(Number);

          // Minutes must be on a 15-minute boundary
          expect([0, 15, 30, 45]).toContain(rm);

          // Rounding error must be ≤ 7 minutes (half of 15-min interval)
          // Convert both to total minutes for comparison, accounting for midnight rollover
          const inputTotal = hour * 60 + minute;
          const resultTotal = rh * 60 + rm;

          // Handle midnight rollover: 23:53 → 00:00 means resultTotal = 0, inputTotal = 1433
          const diff = Math.abs(resultTotal - inputTotal);
          const wrappedDiff = Math.min(diff, 24 * 60 - diff);
          expect(wrappedDiff).toBeLessThanOrEqual(7);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: time-tracker, Property 4: Project name normalization
describe('Property 4: Project name normalization', () => {
  test('result equals result.toLowerCase() and has no leading/trailing whitespace', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (name) => {
          const result = normalizeProjectName(name);
          expect(result).toBe(result.toLowerCase());
          expect(result).toBe(result.trim());
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Example-Based Unit Tests ─────────────────────────────────────────────────

describe('roundToNearest15 — example cases', () => {
  test.each([
    // [input, expected]
    ['07:07', '07:00'],  // 7 min past boundary → round down (remainder 7 < 8)
    ['07:08', '07:15'],  // 8 min past boundary → round up (remainder 8 ≥ 8)
    ['23:53', '00:00'],  // midnight rollover
    ['00:00', '00:00'],  // already on boundary
    ['12:15', '12:15'],  // already on boundary
    ['12:30', '12:30'],  // already on boundary
    ['12:45', '12:45'],  // already on boundary
    ['09:01', '09:00'],  // round down
    ['09:14', '09:15'],  // round up
    ['23:45', '23:45'],  // already on boundary
    ['23:52', '23:45'],  // 52 mod 15 = 7 < 8 → round down to 45
    ['23:53', '00:00'],  // 53 mod 15 = 8 ≥ 8 → round up to 60 → next hour → 24:00 → 00:00
  ])('roundToNearest15("%s") === "%s"', (input, expected) => {
    expect(roundToNearest15(input)).toBe(expected);
  });
});

describe('normalizeProjectName — example cases', () => {
  test('converts to lowercase', () => {
    expect(normalizeProjectName('ProjectAlpha')).toBe('projectalpha');
  });

  test('trims leading whitespace', () => {
    expect(normalizeProjectName('  alpha')).toBe('alpha');
  });

  test('trims trailing whitespace', () => {
    expect(normalizeProjectName('alpha  ')).toBe('alpha');
  });

  test('trims both sides', () => {
    expect(normalizeProjectName('  Alpha Beta  ')).toBe('alpha beta');
  });

  test('empty string stays empty', () => {
    expect(normalizeProjectName('')).toBe('');
  });

  test('whitespace-only string becomes empty', () => {
    expect(normalizeProjectName('   ')).toBe('');
  });
});
