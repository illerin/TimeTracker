# Implementation Plan: Time Tracker

## Overview

Implement a single-user, locally hosted, Dockerized web application for tracking work hours by project. The stack is Node.js + Express (backend), SQLite via `better-sqlite3` (persistence), and vanilla HTML/CSS/JS (frontend). Implementation proceeds from project scaffolding through database setup, backend modules, REST API, frontend pages, and finally tests — each step wiring into the previous one.

## Tasks

- [x] 1. Scaffold project structure and Docker configuration
  - Create `Dockerfile` using a Node.js base image; copy source, install dependencies, expose port 3000, set `CMD ["node", "server/index.js"]`
  - Create `docker-compose.yml` with a single service, port mapping `3000:3000`, and a named volume mounted at `/data`
  - Create `package.json` with `name`, `version`, `main`, `scripts` (`start`, `test`), and dependencies: `express`, `better-sqlite3`, `exceljs`; devDependencies: `jest`, `fast-check`, `supertest`
  - Create the full directory skeleton: `server/routes/`, `server/lib/`, `server/__tests__/`, `public/js/`
  - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 2. Implement database connection and schema initialization
  - [x] 2.1 Create `server/db.js`
    - Implement `getDb()` returning a singleton `better-sqlite3` connection to `/data/timetracker.db` (path configurable via `DB_PATH` env var for tests)
    - Implement `initSchema()` running `CREATE TABLE IF NOT EXISTS time_entries` with columns `id`, `date`, `project`, `start_time`, `end_time`, `created_at` and both indexes (`idx_entries_date`, `idx_entries_project`)
    - Call `initSchema()` on module load
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 3. Implement the Normalizer module
  - [x] 3.1 Create `server/lib/normalizer.js`
    - Implement `roundToNearest15(timeStr)`: parse `HH:MM`, round minutes to nearest 15 (ties round up), return `HH:MM` string; handle midnight rollover
    - Implement `normalizeProjectName(name)`: return `name.trim().toLowerCase()`
    - _Requirements: 2.1, 3.1, 5.2_

  - [x]* 3.2 Write property tests for Normalizer (P1, P4) in `server/__tests__/normalizer.test.js`
    - **Property 1: Time Normalization** — for any `HH:MM`, result minutes ∈ `{0,15,30,45}` and rounding error ≤ 7 minutes
      - `// Feature: time-tracker, Property 1: Time normalization`
      - Arbitraries: `fc.integer({min:0,max:23})` × `fc.integer({min:0,max:59})`
      - **Validates: Requirements 2.1, 5.2**
    - **Property 4: Project Name Normalization** — for any string, result equals `result.toLowerCase()` and has no leading/trailing whitespace
      - `// Feature: time-tracker, Property 4: Project name normalization`
      - Arbitraries: `fc.string()` with mixed case and whitespace
      - **Validates: Requirements 3.1**
    - Add example-based unit tests: exact tie cases (07:07 → 07:00, 07:08 → 07:15), midnight rollover (23:53 → 00:00), empty string and whitespace-only project names

- [x] 4. Implement the Validator module
  - [x] 4.1 Create `server/lib/validator.js`
    - Implement `checkMinDuration(entry)`: return `true` if `(end_time - start_time)` in minutes ≥ 15 (using already-rounded times)
    - Implement `checkNoOverlap(entries)`: return `{ valid, conflicts: [[i,j],...] }` using standard interval overlap (`startA < endB && startB < endA`)
    - Implement `validateEntries(entries)`: run both checks, collect all errors with `{ row, message }`, return `{ valid, errors }`
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

  - [x]* 4.2 Write property tests for Validator (P2, P3) in `server/__tests__/validator.test.js`
    - **Property 2: Minimum Duration Validation** — for any entry where rounded duration < 15 min, `validateEntries` returns `valid: false` with an error identifying the row
      - `// Feature: time-tracker, Property 2: Minimum duration validation`
      - Generate entries where `end_time - start_time < 15` after rounding
      - **Validates: Requirements 2.2, 2.3, 5.3**
    - **Property 3: Overlap Validation** — for any two entries with overlapping slots, `validateEntries` returns `valid: false` with an error identifying conflicting rows
      - `// Feature: time-tracker, Property 3: Overlap validation`
      - Generate overlapping entry pairs via `fc.integer` time offsets
      - **Validates: Requirements 2.4, 2.5, 5.3**
    - Add example-based unit tests: exactly 15-minute entry (valid), 14-minute entry (invalid), adjacent non-overlapping entries (valid), entries sharing only an endpoint (valid boundary)

- [x] 5. Implement the Aggregator module
  - [x] 5.1 Create `server/lib/aggregator.js`
    - Implement `roundToQuarter(hours)`: round a decimal hours value to nearest 0.25
    - Implement `aggregateByProject(entries)`: return `Map<projectName, totalHours>` where each value is the sum of `(end_time - start_time)` in hours, rounded via `roundToQuarter`
    - _Requirements: 7.1, 7.2_

  - [x]* 5.2 Write property tests for Aggregator (P8, P9, P10) in `server/__tests__/aggregator.test.js`
    - **Property 8: Aggregation Correctness and Quarter Rounding** — total hours equals sum of durations and is a multiple of 0.25
      - `// Feature: time-tracker, Property 8: Aggregation correctness and quarter rounding`
      - Arbitraries: `fc.array` of valid entry records with non-overlapping times
      - **Validates: Requirements 7.1, 7.2**
    - **Property 9: Summary Descending Date Order** — summary results are in strictly descending chronological order
      - `// Feature: time-tracker, Property 9: Summary descending date order`
      - Arbitraries: `fc.array` of distinct ISO date strings
      - **Validates: Requirements 7.3**
    - **Property 10: Hours Format String** — formatted hours string matches `/^\d+(\.\d+)? hrs$/`
      - `// Feature: time-tracker, Property 10: Hours format string`
      - Arbitraries: `fc.float({min:0, max:24})` multiples of 0.25
      - **Validates: Requirements 7.4**
    - Add example-based unit tests: single entry, multiple entries same project, multiple projects, zero-duration edge case

- [x] 6. Implement the Exporter module
  - [x] 6.1 Create `server/lib/exporter.js`
    - Implement `generateXlsx(rows)` using `exceljs`: build a workbook with a header row of project names (sorted), one row per date (ascending), cells = aggregated hours or `0` for missing combinations; return a `Buffer`
    - _Requirements: 8.2, 8.3, 8.4_

  - [x]* 6.2 Write property tests for Exporter (P11) in `server/__tests__/exporter.test.js`
    - **Property 11: xlsx Pivot Structure** — workbook rows = dates ascending, columns = distinct projects, cells = aggregated hours or 0
      - `// Feature: time-tracker, Property 11: xlsx pivot structure`
      - Arbitraries: `fc.array` of `AggregatedRow` records with varied dates and projects
      - Parse returned `Buffer` with `exceljs` to verify structure
      - **Validates: Requirements 8.2, 8.3, 8.4**
    - Add example-based unit tests: single date single project, multiple dates multiple projects, missing date-project combinations produce 0

- [x] 7. Checkpoint — Ensure all module tests pass
  - Run `jest server/__tests__/normalizer.test.js server/__tests__/validator.test.js server/__tests__/aggregator.test.js server/__tests__/exporter.test.js` and confirm all pass; ask the user if questions arise.

- [x] 8. Implement the Express server entry point and API routes
  - [x] 8.1 Create `server/index.js`
    - Initialize Express app; mount `express.json()` and `express.static('public')`
    - Register route modules: `/api/workday` → `routes/entries.js`, `/api/entries` → `routes/entries.js`, `/api/projects` → `routes/projects.js`, `/api/export` → `routes/export.js`, `/api/summary` → `routes/export.js`
    - Add global error handler returning `{ message: "An unexpected error occurred." }` with status 500; log error to `stderr`
    - Start listening on `process.env.PORT || 3000`
    - _Requirements: 10.1–10.7, 12.2_

  - [x] 8.2 Create `server/routes/entries.js` — workday and entry CRUD endpoints
    - `POST /api/workday`: validate request body (`date`, `entries[]`); normalize each entry via Normalizer; validate via Validator; batch-insert into DB; return `201 { inserted }` or `422 { errors }`
    - `GET /api/entries`: require `date` query param (validate format); query DB; return `200 []`
    - `PUT /api/entries/:id`: normalize and validate updated entry in context of all entries for that date; update DB row; return `200 { entry }` or `404` / `422`
    - `DELETE /api/entries/:id`: delete DB row; return `204` or `404`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.7, 2.1–2.6, 5.1–5.5, 6.1_

  - [x] 8.3 Create `server/routes/projects.js` — project list endpoint
    - `GET /api/projects`: query `SELECT DISTINCT project FROM time_entries ORDER BY project`; return `200 [string]`
    - _Requirements: 10.5, 3.4_

  - [x] 8.4 Create `server/routes/export.js` — summary and export endpoints
    - `GET /api/summary`: require `start` and `end` query params; fetch entries in range; aggregate via Aggregator; sort dates descending; return `200` summary array
    - `GET /api/export`: require `start` and `end` query params; fetch entries in range; aggregate; call `generateXlsx`; set `Content-Type` and `Content-Disposition` headers; pipe buffer to response
    - _Requirements: 10.6, 7.1–7.4, 8.2–8.6_

- [x] 9. Write API integration tests (P5, P6, P7, P12) in `server/__tests__/api.test.js`
  - [x] 9.1 Set up test harness
    - Use `supertest` against the Express app; configure `DB_PATH` to a temp in-memory or temp-file SQLite for isolation; reset DB between tests
    - _Requirements: 10.1–10.7_

  - [x]* 9.2 Write property test for new project round-trip (P5)
    - **Property 5: New Project Round-Trip** — after inserting an entry, `GET /api/projects` includes the normalized project name
      - `// Feature: time-tracker, Property 5: New project round-trip`
      - Arbitraries: `fc.string({minLength:1})` for project names
      - **Validates: Requirements 3.3**

  - [x]* 9.3 Write property test for distinct project list (P6)
    - **Property 6: Distinct Project List** — `GET /api/projects` returns each project name exactly once regardless of how many entries share it
      - `// Feature: time-tracker, Property 6: Distinct project list`
      - Arbitraries: `fc.array(fc.string({minLength:1}))` with intentional duplicates
      - **Validates: Requirements 3.4**

  - [x]* 9.4 Write property test for entry CRUD round-trips (P7)
    - **Property 7: Entry CRUD Round-Trips** — insert → fetch, update → fetch, delete → fetch all hold
      - `// Feature: time-tracker, Property 7: Entry CRUD round-trips`
      - Arbitraries: `fc.record` with valid `date`, `project`, `start_time`, `end_time`
      - **Validates: Requirements 4.1, 5.5, 6.1**

  - [x]* 9.5 Write property test for API error responses (P12)
    - **Property 12: API Error Responses** — any endpoint receiving invalid input returns a `4xx` status and a JSON body with `errors` or `message`
      - `// Feature: time-tracker, Property 12: API error responses`
      - Generate malformed dates, missing fields, unknown IDs per endpoint
      - **Validates: Requirements 10.7**

  - [x]* 9.6 Write example-based API contract tests
    - Each endpoint returns correct HTTP status and response shape for valid inputs
    - Export endpoint returns correct `Content-Type` and `Content-Disposition` headers
    - Data persistence: insert entries, reconnect DB, verify entries still present
    - End-to-end export: insert entries, call export, parse xlsx buffer and verify pivot structure
    - _Requirements: 10.1–10.6, 8.5, 8.6, 9.2_

- [x] 10. Checkpoint — Ensure all backend and API tests pass
  - Run `jest` and confirm all test suites pass; ask the user if questions arise.

- [x] 11. Implement the frontend — Main page
  - [x] 11.1 Create `public/index.html`
    - Render page title, three navigation buttons: "Add Workday", "View Summary", "Export Data"
    - Include the Add Workday modal markup: date picker, dynamic entry table (columns: Project, Start Time, End Time, Remove), "+ Add Row" button, Done and Cancel buttons, error banner placeholder
    - Link to `public/js/main.js`
    - _Requirements: 11.1, 11.2, 1.1_

  - [x] 11.2 Create `public/js/main.js`
    - Wire "View Summary" → navigate to `summary.html`; "Export Data" → navigate to `export.html`
    - Wire "Add Workday" → open modal; "Cancel" → close modal without saving
    - Implement calendar date picker defaulting to current month with previous-month navigation
    - Implement "+ Add Row" appending an empty row; "Remove" removing its row
    - Implement project name autocomplete: on input, fetch `GET /api/projects` and filter suggestions
    - On "Done": collect entries, `POST /api/workday`, display inline errors in banner on `422`, close modal on `201`
    - _Requirements: 1.1–1.7, 3.2, 11.1–11.4_

- [x] 12. Implement the frontend — Daily Editor (inline editing)
  - Extend `public/js/main.js` (or extract to a shared module) to support the Daily Editor view embedded in the main page
  - On date selection, fetch `GET /api/entries?date=...` and render the entry table; show empty-state message when array is empty
  - Activate inline editing per row on click; on save call `PUT /api/entries/:id` with normalized values; on `422` display inline error and restore previous values
  - Wire Delete button to `DELETE /api/entries/:id`; on `204` remove the row from the DOM
  - _Requirements: 4.1–4.3, 5.1–5.5, 6.1–6.2_

- [x] 13. Implement the frontend — Summary View
  - [x] 13.1 Create `public/summary.html`
    - Render page title, back-navigation link, and a container for the summary list
    - Link to `public/js/summary.js`
    - _Requirements: 7.3, 11.3_

  - [x] 13.2 Create `public/js/summary.js`
    - On page load, fetch `GET /api/summary` (default to a broad date range or all-time)
    - Render results grouped by date descending; each date shows project → hours in `"X hrs"` format
    - _Requirements: 7.1–7.4_

- [x] 14. Implement the frontend — Export UI
  - [x] 14.1 Create `public/export.html`
    - Render page title, back-navigation link, Start Date picker, End Date picker, Export button, and an error alert placeholder
    - Link to `public/js/export.js`
    - _Requirements: 8.1, 11.4_

  - [x] 14.2 Create `public/js/export.js`
    - On Export click: validate that start ≤ end; navigate to `/api/export?start=...&end=...` to trigger browser download
    - On error (e.g., missing dates): display page-level alert
    - _Requirements: 8.1, 8.5_

- [x] 15. Final checkpoint — Full integration verification
  - Run `jest --runInBand` and confirm all test suites pass (unit, property, integration)
  - Verify `Dockerfile` and `docker-compose.yml` are syntactically valid (`docker compose config`)
  - Ask the user if questions arise before considering the implementation complete.

## Notes

- Sub-tasks marked with `*` are optional and can be skipped for a faster MVP; all 12 correctness properties are covered by these optional tasks
- Each task references specific requirements for traceability
- Checkpoints (tasks 7, 10, 15) ensure incremental validation at natural boundaries
- Property tests use `fast-check` with a minimum of 100 iterations per property; each is tagged with `// Feature: time-tracker, Property N: ...`
- Unit and integration tests use Jest + Supertest; the test DB uses a temp path via `DB_PATH` env var to avoid touching `/data`
- The `exceljs` buffer returned by `generateXlsx` can be parsed back by `exceljs` in tests to verify pivot structure without writing to disk
