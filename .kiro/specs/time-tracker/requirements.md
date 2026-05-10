# Requirements Document

## Introduction

A single-user, locally hosted web application (Dockerized) for tracking work hours by project.
The system enables users to log workdays with multiple time entries, edit existing entries, view
a clean daily summary of hours worked per project, and export time data to Excel in a pivoted
format. All data is stored locally in a SQLite database persisted via a Docker-mounted volume.
No authentication or multi-user support is required.

---

## Glossary

- **App**: The Time Tracking web application described in this document.
- **Workday**: A single calendar date for which one or more Time Entries are recorded.
- **Time Entry**: A single record consisting of a Project Name, a Start Time, and an End Time within a Workday.
- **Project Name**: A normalized (lowercase) text label identifying the work project for a Time Entry.
- **Time Slot**: The interval between a Start Time and an End Time within a Time Entry.
- **Validator**: The backend component responsible for enforcing data rules before persisting data.
- **Normalizer**: The component responsible for rounding times and normalizing project names on input.
- **Aggregator**: The component responsible for computing total hours per project per day.
- **Exporter**: The component responsible for generating the Excel (.xlsx) export file.
- **API**: The backend HTTP interface exposing endpoints consumed by the frontend.
- **Database**: The SQLite database storing all Time Entries, persisted in a Docker-mounted volume.
- **Summary View**: The UI page displaying aggregated hours per project per day.
- **Daily Editor**: The UI view displaying and allowing inline editing of Time Entries for a selected date.
- **Export UI**: The UI component for selecting a date range and triggering an Excel export.

---

## Requirements

### Requirement 1: Add a Workday with Multiple Time Entries

**User Story:** As a user, I want to add a full workday with multiple time entries in a single flow, so that I can record all work done on a given day at once.

#### Acceptance Criteria

1. WHEN the user clicks "Add Workday", THE App SHALL open a modal containing a calendar date picker and a dynamic table for entering Time Entries.
2. WHEN the Add Workday modal opens, THE App SHALL default the calendar to the current month with the previous month accessible via navigation.
3. WHEN the user selects a date in the calendar, THE App SHALL allow the user to add one or more Time Entries for that date, each consisting of a Project Name, a Start Time, and an End Time.
4. WHEN the user clicks "+ Add Row", THE App SHALL append a new empty Time Entry row to the dynamic table.
5. WHEN the user clicks "Remove" on a Time Entry row, THE App SHALL remove that row from the dynamic table.
6. WHEN the user clicks "Done", THE App SHALL validate all Time Entries and, if valid, save the entire Workday as a batch to the Database.
7. WHEN the user clicks "Cancel", THE App SHALL close the modal without saving any data.

---

### Requirement 2: Time Entry Validation

**User Story:** As a user, I want the system to enforce time rules automatically, so that my data remains consistent and free of overlapping or invalid entries.

#### Acceptance Criteria

1. WHEN a Time Entry is submitted, THE Normalizer SHALL round the Start Time and End Time to the nearest 15-minute interval before validation.
2. WHEN a Time Entry is submitted, THE Validator SHALL verify that the duration between Start Time and End Time is at least 15 minutes.
3. IF the duration of a Time Entry is less than 15 minutes after rounding, THEN THE Validator SHALL reject the submission and return a descriptive error message identifying the offending row.
4. WHEN a Workday is submitted, THE Validator SHALL verify that no two Time Entries within the same Workday have overlapping Time Slots.
5. IF two or more Time Entries within the same Workday have overlapping Time Slots, THEN THE Validator SHALL reject the submission and return a descriptive error message identifying the conflicting rows.
6. WHEN validation fails, THE App SHALL display the error message to the user without closing the Add Workday modal.

---

### Requirement 3: Project Name Handling and Autocomplete

**User Story:** As a user, I want project names to be normalized and suggested via autocomplete, so that I can enter project names quickly and consistently without duplicates caused by case differences.

#### Acceptance Criteria

1. WHEN a Project Name is saved, THE Normalizer SHALL convert the Project Name to lowercase before storing it in the Database.
2. WHEN the user types in a Project Name input field, THE App SHALL display autocomplete suggestions drawn from the list of existing Project Names stored in the Database.
3. WHEN the user submits a Project Name that does not match any existing Project Name, THE App SHALL add the new Project Name to the Database automatically.
4. THE API SHALL expose an endpoint that returns the list of all distinct Project Names stored in the Database, for use by the autocomplete feature.

---

### Requirement 4: Fetch and Display Entries for a Date

**User Story:** As a user, I want to select a date and view all time entries recorded for that day, so that I can review what was logged.

#### Acceptance Criteria

1. WHEN the user selects a date in the Daily Editor, THE API SHALL return all Time Entries stored for that date.
2. WHEN Time Entries are returned for a date, THE App SHALL display them in a table with columns: Project, Start Time, End Time, and a Delete action.
3. WHEN no Time Entries exist for the selected date, THE App SHALL display an empty state message indicating no entries are recorded for that day.

---

### Requirement 5: Inline Editing of Time Entries

**User Story:** As a user, I want to edit existing time entries inline, so that I can correct mistakes without re-entering an entire workday.

#### Acceptance Criteria

1. WHEN the user activates inline editing on a Time Entry row in the Daily Editor, THE App SHALL allow the user to modify the Project Name, Start Time, and End Time fields directly in the table.
2. WHEN the user saves an inline edit, THE Normalizer SHALL round the Start Time and End Time to the nearest 15-minute interval.
3. WHEN the user saves an inline edit, THE Validator SHALL apply the same overlap and minimum-duration rules as defined in Requirement 2.
4. IF validation of an inline edit fails, THEN THE App SHALL display a descriptive error message and retain the previous valid values for the edited entry.
5. WHEN an inline edit passes validation, THE API SHALL update the Time Entry in the Database and THE App SHALL reflect the updated values in the table.

---

### Requirement 6: Delete a Time Entry

**User Story:** As a user, I want to delete individual time entries, so that I can remove incorrect or unwanted records.

#### Acceptance Criteria

1. WHEN the user clicks the Delete button on a Time Entry row in the Daily Editor, THE API SHALL delete that Time Entry from the Database.
2. WHEN a Time Entry is deleted, THE App SHALL remove the corresponding row from the Daily Editor table without requiring a page reload.

---

### Requirement 7: Summary View

**User Story:** As a user, I want to view a clean summary of hours worked per project per day, so that I can quickly understand how my time was distributed.

#### Acceptance Criteria

1. WHEN the user navigates to the Summary View, THE Aggregator SHALL compute total hours worked per Project Name per Workday from the Time Entries stored in the Database.
2. WHEN displaying aggregated hours, THE Aggregator SHALL round each total to the nearest 0.25 hours.
3. WHEN the Summary View is rendered, THE App SHALL display results grouped by date in descending order, with each date showing a list of Project Names and their corresponding aggregated hours.
4. THE App SHALL display aggregated hours in the format "X hrs" (e.g., "3.75 hrs") without showing raw Start Time or End Time values.

---

### Requirement 8: Excel Export

**User Story:** As a user, I want to export my time data to an Excel file for a selected date range, so that I can share or analyze my hours outside the application.

#### Acceptance Criteria

1. WHEN the user opens the Export UI, THE App SHALL present a Start Date picker, an End Date picker, and an Export button.
2. WHEN the user clicks Export, THE Exporter SHALL generate a .xlsx file covering all Workdays within the selected date range (inclusive).
3. THE Exporter SHALL structure the .xlsx file with dates as rows and Project Names as columns, with cell values representing total hours worked (aggregated and rounded to the nearest 0.25 hours).
4. WHEN a Project Name has no hours recorded for a given date within the export range, THE Exporter SHALL write 0 as the cell value for that date-project combination.
5. WHEN the .xlsx file is ready, THE App SHALL trigger a file download in the user's browser.
6. THE API SHALL expose an endpoint that accepts a start date and end date and returns the .xlsx file as a downloadable response.

---

### Requirement 9: Persistent Local Storage via Docker

**User Story:** As a user, I want my data to persist across container restarts, so that I never lose recorded time entries.

#### Acceptance Criteria

1. THE Database SHALL be a SQLite file stored at a path within a Docker-mounted volume (e.g., `/data`).
2. WHEN the Docker container is restarted, THE App SHALL reconnect to the existing SQLite Database file and all previously stored Time Entries SHALL remain accessible.
3. THE App SHALL require no external database services or network dependencies beyond the Docker container itself.

---

### Requirement 10: API Endpoints

**User Story:** As a developer, I want a well-defined set of API endpoints, so that the frontend and backend are cleanly separated and each operation is explicitly supported.

#### Acceptance Criteria

1. THE API SHALL expose an endpoint to add a Workday as a batch of Time Entries for a single date.
2. THE API SHALL expose an endpoint to fetch all Time Entries for a specified date.
3. THE API SHALL expose an endpoint to update a single Time Entry by its identifier.
4. THE API SHALL expose an endpoint to delete a single Time Entry by its identifier.
5. THE API SHALL expose an endpoint to fetch the list of all distinct Project Names.
6. THE API SHALL expose an endpoint to export time data as a .xlsx file for a specified date range.
7. WHEN any API endpoint receives invalid input, THE API SHALL return a descriptive error response with an appropriate HTTP status code.

---

### Requirement 11: Main Page Navigation

**User Story:** As a user, I want a simple main page with clear navigation options, so that I can access all features of the application from one place.

#### Acceptance Criteria

1. THE App SHALL display a main page containing the following controls: an "Add Workday" button, a "View Summary" button, and an "Export Data" button.
2. WHEN the user clicks "Add Workday", THE App SHALL open the Add Workday modal as described in Requirement 1.
3. WHEN the user clicks "View Summary", THE App SHALL navigate to the Summary View as described in Requirement 7.
4. WHEN the user clicks "Export Data", THE App SHALL navigate to or open the Export UI as described in Requirement 8.

---

### Requirement 12: Docker Deployment

**User Story:** As a user, I want to run the application via Docker with a single command, so that setup is simple and requires no local dependencies beyond Docker.

#### Acceptance Criteria

1. THE App SHALL be deployable using Docker with a single `docker compose up` command (or equivalent).
2. WHEN the container starts, THE App SHALL be accessible via a web browser on a locally exposed port.
3. THE App SHALL require no external dependencies beyond the Docker container (no external databases, no cloud services, no internet access at runtime).
4. THE App SHALL persist all data in a Docker-mounted volume so that data survives container restarts and removals.
