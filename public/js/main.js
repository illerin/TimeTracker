'use strict';

// ─── Navigation ───────────────────────────────────────────────────────────────
document.getElementById('btn-view-summary').addEventListener('click', () => {
  window.location.href = 'summary.html';
});
document.getElementById('btn-export').addEventListener('click', () => {
  window.location.href = 'export.html';
});

// ─── Shared helpers ───────────────────────────────────────────────────────────
const today = new Date();
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const DAYS_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function pad(n) { return String(n).padStart(2, '0'); }
function toIso(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function todayIso() { return toIso(today.getFullYear(), today.getMonth(), today.getDate()); }

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert "HH:MM" (24-hr) to "H:MM AM/PM" for display */
function to12hr(timeStr) {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const period = h < 12 ? 'AM' : 'PM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${period}`;
}

// ─── Time dropdown helpers ────────────────────────────────────────────────────
// Hours 07–22. 07–12 = AM (light blue), 13–22 = PM (dark blue).
// Displayed as 7–12 for AM, 1–10 for PM.
const HOUR_OPTS = [
  { value: '07', label: '7',  period: 'am' },
  { value: '08', label: '8',  period: 'am' },
  { value: '09', label: '9',  period: 'am' },
  { value: '10', label: '10', period: 'am' },
  { value: '11', label: '11', period: 'am' },
  { value: '12', label: '12', period: 'am' },
  { value: '13', label: '1',  period: 'pm' },
  { value: '14', label: '2',  period: 'pm' },
  { value: '15', label: '3',  period: 'pm' },
  { value: '16', label: '4',  period: 'pm' },
  { value: '17', label: '5',  period: 'pm' },
  { value: '18', label: '6',  period: 'pm' },
  { value: '19', label: '7',  period: 'pm' },
  { value: '20', label: '8',  period: 'pm' },
  { value: '21', label: '9',  period: 'pm' },
  { value: '22', label: '10', period: 'pm' },
];
const MINUTES = ['00', '15', '30', '45'];

function buildTimeSelects(cssClass, value, ariaLabel) {
  const [initH, initM] = value ? value.split(':') : ['', ''];
  const wrapper = document.createElement('span');
  wrapper.className = `time-selects ${cssClass}`;

  const hSel = document.createElement('select');
  hSel.className = 'hour-sel';
  hSel.setAttribute('aria-label', `${ariaLabel} hour`);

  const blankOpt = document.createElement('option');
  blankOpt.value = '';
  blankOpt.textContent = 'HH';
  hSel.appendChild(blankOpt);

  for (const opt of HOUR_OPTS) {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    el.style.background = opt.period === 'am' ? '#bfdbfe' : '#1e40af';
    el.style.color       = opt.period === 'am' ? '#1e3a5f' : '#fff';
    if (opt.value === initH) el.selected = true;
    hSel.appendChild(el);
  }

  // Style the select itself based on current selection
  function updateHourStyle() {
    const selected = HOUR_OPTS.find(o => o.value === hSel.value);
    if (selected) {
      hSel.style.background = selected.period === 'am' ? '#bfdbfe' : '#1e40af';
      hSel.style.color       = selected.period === 'am' ? '#1e3a5f' : '#fff';
    } else {
      hSel.style.background = '';
      hSel.style.color = '';
    }
  }
  hSel.addEventListener('change', updateHourStyle);
  updateHourStyle();

  const colon = document.createElement('span');
  colon.textContent = ':';
  colon.style.padding = '0 2px';

  const mSel = document.createElement('select');
  mSel.className = 'min-sel';
  mSel.setAttribute('aria-label', `${ariaLabel} minute`);
  // Default to '00' — no blank option
  mSel.innerHTML = MINUTES.map(m =>
    `<option value="${m}"${(initM || '00') === m ? ' selected' : ''}>${m}</option>`
  ).join('');

  wrapper.appendChild(hSel);
  wrapper.appendChild(colon);
  wrapper.appendChild(mSel);
  return wrapper;
}

function readTimeSelects(wrapper) {
  const h = wrapper.querySelector('.hour-sel').value;
  const m = wrapper.querySelector('.min-sel').value;
  return h ? `${h}:${m}` : '';
}

/**
 * Wire start-selects → end-selects so end-time hides hours before start hour.
 * Call after both wrappers are in the DOM.
 */
function wireStartEndSync(startWrapper, endWrapper) {
  function filterEndHours() {
    const startH = startWrapper.querySelector('.hour-sel').value;
    const endHSel = endWrapper.querySelector('.hour-sel');
    const currentEnd = endHSel.value;

    // Remove all options except blank, then re-add filtered ones
    endHSel.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'HH';
    endHSel.appendChild(blank);

    for (const opt of HOUR_OPTS) {
      // Hide hours that are strictly before the start hour (same hour is allowed)
      if (startH && opt.value < startH) continue;
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      el.style.background = opt.period === 'am' ? '#bfdbfe' : '#1e40af';
      el.style.color       = opt.period === 'am' ? '#1e3a5f' : '#fff';
      if (opt.value === currentEnd) el.selected = true;
      endHSel.appendChild(el);
    }

    // Re-apply colour styling
    const selected = HOUR_OPTS.find(o => o.value === endHSel.value);
    if (selected) {
      endHSel.style.background = selected.period === 'am' ? '#bfdbfe' : '#1e40af';
      endHSel.style.color       = selected.period === 'am' ? '#1e3a5f' : '#fff';
    } else {
      endHSel.style.background = '';
      endHSel.style.color = '';
    }
  }

  startWrapper.querySelector('.hour-sel').addEventListener('change', filterEndHours);
  // Run once on init to apply any pre-filled start value
  filterEndHours();
}

// ─── Projects (managed list) ──────────────────────────────────────────────────
let allProjects = []; // [{ id, name, hidden }] — all projects including hidden

async function fetchProjects() {
  try {
    const res = await fetch('/api/projects');
    if (res.ok) allProjects = await res.json();
  } catch (_) {}
}
fetchProjects();

// ─── Heat-map calendars ───────────────────────────────────────────────────────
let dailyTotals   = {};
let heatmapOffset = 0; // 0 = current+prev month, -1 = one more month back, etc.

function hourClass(hours) {
  if (!hours || hours <= 0) return '';
  if (hours <= 4)           return 'h-red';
  if (hours <= 6)           return 'h-orange';
  if (hours <= 7.5)         return 'h-yellow';
  if (hours <= 8.25)        return 'h-green';
  return 'h-blue';
}

function buildHeatmapMonth(year, month) {
  const card = document.createElement('div');
  card.className = 'heatmap-cal';

  const heading = document.createElement('h3');
  heading.textContent = `${MONTHS[month]} ${year}`;
  card.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'cal-grid';

  DAYS_SHORT.forEach(d => {
    const el = document.createElement('div');
    el.className = 'dh';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'dc empty';
    grid.appendChild(el);
  }

  const tIso = todayIso();
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = toIso(year, month, d);
    const el  = document.createElement('div');
    el.className = 'dc';
    el.textContent = d;
    el.setAttribute('title', iso);
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', iso);
    el.setAttribute('tabindex', '0');

    const hc = hourClass(dailyTotals[iso]);
    if (hc) el.classList.add(hc);
    if (iso === tIso) el.classList.add('today');

    // Single click → load daily editor
    el.addEventListener('click', () => {
      document.getElementById('date-picker').value = iso;
      loadDailyEntries(iso);
      document.getElementById('daily-editor').scrollIntoView({ behavior: 'smooth' });
    });

    // Double click → open Add Workday modal pre-set to that date
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      openModal(iso);
    });

    grid.appendChild(el);
  }

  card.appendChild(grid);
  return card;
}

async function loadHeatmap() {
  // Calculate the two months to show based on offset from today
  // offset 0  → prev month + current month
  // offset -1 → 2 months ago + prev month
  // etc.
  const rightDate = new Date(today.getFullYear(), today.getMonth() + heatmapOffset, 1);
  const leftDate  = new Date(rightDate.getFullYear(), rightDate.getMonth() - 1, 1);

  const start = toIso(leftDate.getFullYear(),  leftDate.getMonth(),  1);
  const lastDay = new Date(rightDate.getFullYear(), rightDate.getMonth() + 1, 0).getDate();
  const end   = toIso(rightDate.getFullYear(), rightDate.getMonth(), lastDay);

  try {
    const res = await fetch(`/api/daily-totals?start=${start}&end=${end}`);
    if (res.ok) dailyTotals = await res.json();
  } catch (_) {}

  const row = document.getElementById('heatmap-row');
  row.innerHTML = '';
  row.appendChild(buildHeatmapMonth(leftDate.getFullYear(),  leftDate.getMonth()));
  row.appendChild(buildHeatmapMonth(rightDate.getFullYear(), rightDate.getMonth()));

  // Update label
  document.getElementById('heatmap-range-label').textContent =
    `${MONTHS[leftDate.getMonth()]} ${leftDate.getFullYear()} – ${MONTHS[rightDate.getMonth()]} ${rightDate.getFullYear()}`;

  // Disable "Next" when we're already at the most recent pair
  document.getElementById('heatmap-next').disabled = heatmapOffset >= 0;
}

loadHeatmap();

// Heatmap navigation
document.getElementById('heatmap-prev').addEventListener('click', () => {
  heatmapOffset--;
  loadHeatmap();
});
document.getElementById('heatmap-next').addEventListener('click', () => {
  if (heatmapOffset < 0) {
    heatmapOffset++;
    loadHeatmap();
  }
});

// ─── Modal calendar state ─────────────────────────────────────────────────────
let calYear      = today.getFullYear();
let calMonth     = today.getMonth();
let selectedDate = null;

function renderModalCalendar() {
  document.getElementById('cal-month-label').textContent = `${MONTHS[calMonth]} ${calYear}`;
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  DAYS_SHORT.forEach(d => {
    const el = document.createElement('div');
    el.className = 'day-header';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay    = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'day empty';
    grid.appendChild(el);
  }

  const tIso = todayIso();
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = toIso(calYear, calMonth, d);
    const el  = document.createElement('div');
    el.className = 'day';
    el.textContent = d;
    el.setAttribute('role', 'gridcell');
    el.setAttribute('aria-label', iso);
    if (iso === tIso) el.classList.add('today');
    if (iso === selectedDate) el.classList.add('selected');
    el.addEventListener('click', () => {
      selectedDate = iso;
      document.getElementById('selected-date-label').textContent = `Selected: ${iso}`;
      renderModalCalendar();
    });
    grid.appendChild(el);
  }
}

document.getElementById('cal-prev').addEventListener('click', () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderModalCalendar();
});
document.getElementById('cal-next').addEventListener('click', () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderModalCalendar();
});

// ─── Modal open/close ─────────────────────────────────────────────────────────
const overlay = document.getElementById('modal-overlay');

/**
 * Open the Add Workday modal.
 * @param {string|null} preselectedDate - ISO date to pre-select, or null for none
 */
async function openModal(preselectedDate = null) {
  // Set calendar to the month of the preselected date, or today
  if (preselectedDate) {
    const parts = preselectedDate.split('-');
    calYear  = parseInt(parts[0], 10);
    calMonth = parseInt(parts[1], 10) - 1;
    selectedDate = preselectedDate;
    document.getElementById('selected-date-label').textContent = `Selected: ${preselectedDate}`;
  } else {
    calYear  = today.getFullYear();
    calMonth = today.getMonth();
    selectedDate = null;
    document.getElementById('selected-date-label').textContent = '';
  }

  renderModalCalendar();
  document.getElementById('modal-entry-tbody').innerHTML = '';
  hideModalError();
  modalLoadedEntryIds = [];

  // If a date is pre-selected, load any existing entries for that day
  if (preselectedDate) {
    try {
      const res = await fetch(`/api/entries?date=${preselectedDate}`);
      if (res.ok) {
        const existing = await res.json();
        if (existing.length > 0) {
          for (const e of existing) {
            modalLoadedEntryIds.push(e.id);
            addModalRow(e.project, e.start_time, e.end_time, e.description || '', e.id);
          }
        } else {
          addModalRow();
        }
      } else {
        addModalRow();
      }
    } catch (_) {
      addModalRow();
    }
  } else {
    addModalRow();
  }

  overlay.classList.add('open');
}

function closeModal() {
  overlay.classList.remove('open');
}

document.getElementById('btn-add-workday').addEventListener('click', () => openModal());
document.getElementById('btn-modal-cancel').addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

// ─── Autocomplete ─────────────────────────────────────────────────────────────
function wireAutocomplete(input, listEl) {
  input.addEventListener('input', () => {
    const val = input.value.toLowerCase();
    const matches = allProjects.filter(p => p.name.includes(val) && val.length > 0);
    listEl.innerHTML = '';
    if (matches.length > 0) {
      matches.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.name;
        li.setAttribute('role', 'option');
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = p.name;
          listEl.classList.remove('open');
        });
        listEl.appendChild(li);
      });
      listEl.classList.add('open');
    } else {
      listEl.classList.remove('open');
    }
  });
  input.addEventListener('blur', () => setTimeout(() => listEl.classList.remove('open'), 150));
}

/** Build a project <select> dropdown from allProjects.
 *  Only shows non-hidden projects, UNLESS selectedName is hidden
 *  (in which case it's included so existing entries can still be edited). */
function buildProjectSelect(selectedName = '') {
  const sel = document.createElement('select');
  sel.className = 'project-select';
  sel.setAttribute('aria-label', 'Project');

  // Include all non-hidden projects, plus the currently selected one even if hidden
  const visibleProjects = allProjects.filter(p =>
    !p.hidden || p.name === selectedName
  );

  sel.innerHTML = '<option value="">— select project —</option>' +
    visibleProjects.map(p =>
      `<option value="${escHtml(p.name)}"${p.name === selectedName ? ' selected' : ''}>${escHtml(p.name)}${p.hidden ? ' (hidden)' : ''}</option>`
    ).join('');

  // When project changes, update description placeholder if description is still the default
  sel.addEventListener('change', () => {
    const tr = sel.closest('tr');
    if (!tr) return;
    const descEl = tr.querySelector('.description-input');
    if (!descEl) return;
    const prevProject = sel.dataset.prevValue || '';
    if (descEl.value === '' || descEl.value === prevProject) {
      descEl.value = sel.value;
    }
    sel.dataset.prevValue = sel.value;
  });

  return sel;
}

// ─── Modal entry rows ─────────────────────────────────────────────────────────
// Track which entry IDs were loaded when the modal opened (for delete detection)
let modalLoadedEntryIds = [];

function addModalRow(project = '', startTime = '', endTime = '', description = '', entryId = null) {
  const tbody = document.getElementById('modal-entry-tbody');

  // Determine default start time
  let defaultStart = startTime;
  if (!defaultStart) {
    const existingRows = tbody.querySelectorAll('tr');
    if (existingRows.length === 0) {
      defaultStart = '09:00';
    } else {
      const lastRow     = existingRows[existingRows.length - 1];
      const lastEndWrap = lastRow.querySelector('.end-selects');
      defaultStart = lastEndWrap ? readTimeSelects(lastEndWrap) : '09:00';
    }
  }

  const tr = document.createElement('tr');
  // Store the existing entry ID so Done knows whether to PUT or POST
  if (entryId !== null) tr.dataset.entryId = String(entryId);

  // Project cell — dropdown
  const projectTd  = document.createElement('td');
  const projectSel = buildProjectSelect(project);
  projectSel.dataset.prevValue = project;
  projectTd.appendChild(projectSel);

  // Start time cell
  const startTd = document.createElement('td');
  const startWrap = buildTimeSelects('start-selects', defaultStart, 'Start time');
  startTd.appendChild(startWrap);

  // End time cell
  const endTd = document.createElement('td');
  const endWrap = buildTimeSelects('end-selects', endTime, 'End time');
  endTd.appendChild(endWrap);

  // Description cell — defaults to project name
  const descTd    = document.createElement('td');
  const descInput = document.createElement('textarea');
  descInput.className = 'description-input';
  descInput.setAttribute('aria-label', 'Description');
  descInput.rows = 1;
  descInput.value = description || project;
  descTd.appendChild(descInput);

  // Remove button cell
  const removeTd  = document.createElement('td');
  const removeBtn = document.createElement('button');
  removeBtn.className = 'danger small remove-btn';
  removeBtn.type = 'button';
  removeBtn.setAttribute('aria-label', 'Remove row');
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => tr.remove());
  removeTd.appendChild(removeBtn);

  tr.appendChild(projectTd);
  tr.appendChild(startTd);
  tr.appendChild(endTd);
  tr.appendChild(descTd);
  tr.appendChild(removeTd);
  tbody.appendChild(tr);

  // Wire start→end filtering after both are in the DOM
  wireStartEndSync(startWrap, endWrap);
}

document.getElementById('btn-add-row').addEventListener('click', () => addModalRow());

// ─── Modal error ──────────────────────────────────────────────────────────────
function showModalError(msg) {
  const el = document.getElementById('modal-error');
  el.textContent = msg;
  el.classList.add('visible');
}
function hideModalError() {
  const el = document.getElementById('modal-error');
  el.textContent = '';
  el.classList.remove('visible');
}

// ─── Done / Save ──────────────────────────────────────────────────────────────
document.getElementById('btn-modal-done').addEventListener('click', async () => {
  hideModalError();

  if (!selectedDate) {
    showModalError('Please select a date.');
    return;
  }

  const rows = document.querySelectorAll('#modal-entry-tbody tr');
  if (rows.length === 0) {
    showModalError('Please add at least one time entry.');
    return;
  }

  // Collect and validate all rows
  const toUpdate = []; // { id, project, start_time, end_time, description }
  const toInsert = []; // { project, start_time, end_time, description }

  for (const row of rows) {
    const project     = row.querySelector('.project-select').value;
    const startWrap   = row.querySelector('.start-selects');
    const endWrap     = row.querySelector('.end-selects');
    const start_time  = readTimeSelects(startWrap);
    const end_time    = readTimeSelects(endWrap);
    const description = row.querySelector('.description-input').value.trim();

    if (!project) {
      showModalError('All rows must have a project selected.');
      return;
    }
    if (!start_time || !end_time) {
      showModalError('All rows must have a start time and end time.');
      return;
    }

    const entryId = row.dataset.entryId ? parseInt(row.dataset.entryId, 10) : null;
    if (entryId !== null) {
      toUpdate.push({ id: entryId, project, start_time, end_time, description });
    } else {
      toInsert.push({ project, start_time, end_time, description });
    }
  }

  // IDs that were loaded but are no longer in the table → user removed them
  const remainingIds = new Set(toUpdate.map(e => e.id));
  const toDelete = modalLoadedEntryIds.filter(id => !remainingIds.has(id));

  try {
    // 1. Update existing entries
    for (const entry of toUpdate) {
      const res = await fetch(`/api/entries/${entry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project:     entry.project,
          start_time:  entry.start_time,
          end_time:    entry.end_time,
          description: entry.description
        })
      });
      if (!res.ok) {
        const data = await res.json();
        showModalError(data.errors
          ? data.errors.map(e => e.message).join('\n')
          : (data.message || 'Failed to update an entry.'));
        return;
      }
    }

    // 2. Delete removed entries
    for (const id of toDelete) {
      await fetch(`/api/entries/${id}`, { method: 'DELETE' });
    }

    // 3. Insert new entries
    if (toInsert.length > 0) {
      const res = await fetch('/api/workday', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, entries: toInsert })
      });
      if (!res.ok) {
        const data = await res.json();
        showModalError(data.errors
          ? data.errors.map(e => e.message).join('\n')
          : (data.message || 'Failed to save new entries.'));
        return;
      }
    }

    closeModal();
    await loadHeatmap();
    const datePicker = document.getElementById('date-picker');
    if (datePicker.value === selectedDate) loadDailyEntries(selectedDate);

  } catch (_) {
    showModalError('Network error. Please try again.');
  }
});

// ─── Daily Editor ─────────────────────────────────────────────────────────────
const datePicker = document.getElementById('date-picker');
const container  = document.getElementById('daily-entries-container');

datePicker.addEventListener('change', () => {
  if (datePicker.value) loadDailyEntries(datePicker.value);
});

async function loadDailyEntries(date) {
  container.innerHTML = '';
  try {
    const res = await fetch(`/api/entries?date=${date}`);
    if (!res.ok) { container.innerHTML = '<p class="empty-state">Failed to load entries.</p>'; return; }
    const entries = await res.json();

    if (entries.length === 0) {
      container.innerHTML = '<p class="empty-state">No entries recorded for this date.</p>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'entry-table';
    table.innerHTML = `
      <thead><tr>
        <th>Project</th><th>Start</th><th>End</th><th>Description</th><th></th>
      </tr></thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');
    for (const entry of entries) tbody.appendChild(buildEditorRow(entry, date));
    container.appendChild(table);
  } catch (_) {
    container.innerHTML = '<p class="empty-state">Failed to load entries.</p>';
  }
}

function buildEditorRow(entry, date) {
  const tr = document.createElement('tr');
  tr.dataset.id = entry.id;

  function renderView() {
    tr.innerHTML = `
      <td>${escHtml(entry.project)}</td>
      <td>${escHtml(to12hr(entry.start_time))}</td>
      <td>${escHtml(to12hr(entry.end_time))}</td>
      <td>${escHtml(entry.description || '')}</td>
      <td>
        <button class="secondary small edit-btn" aria-label="Edit row">Edit</button>
        <button class="danger small delete-btn" aria-label="Delete row">Delete</button>
      </td>
    `;
    tr.querySelector('.edit-btn').addEventListener('click', renderEdit);
    tr.querySelector('.delete-btn').addEventListener('click', () => deleteEntry(entry.id, tr, date));
  }

  function renderEdit() {
    tr.innerHTML = '';

    // Project dropdown
    const projectTd  = document.createElement('td');
    const projectSel = buildProjectSelect(entry.project);
    projectSel.dataset.prevValue = entry.project;
    projectTd.appendChild(projectSel);

    // Start time
    const startTd   = document.createElement('td');
    const startWrap = buildTimeSelects('start-selects', entry.start_time, 'Start time');
    startTd.appendChild(startWrap);

    // End time
    const endTd   = document.createElement('td');
    const endWrap = buildTimeSelects('end-selects', entry.end_time, 'End time');
    endTd.appendChild(endWrap);

    // Description
    const descTd    = document.createElement('td');
    const descInput = document.createElement('textarea');
    descInput.className = 'description-input';
    descInput.setAttribute('aria-label', 'Description');
    descInput.rows = 1;
    descInput.value = entry.description || '';
    descTd.appendChild(descInput);

    // Actions
    const actionTd  = document.createElement('td');
    const saveBtn   = document.createElement('button');
    saveBtn.className = 'small save-btn';
    saveBtn.textContent = 'Save';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'secondary small';
    cancelBtn.textContent = 'Cancel';
    const errDiv    = document.createElement('div');
    errDiv.className = 'inline-error';
    errDiv.setAttribute('role', 'alert');
    actionTd.appendChild(saveBtn);
    actionTd.appendChild(cancelBtn);
    actionTd.appendChild(errDiv);

    tr.appendChild(projectTd);
    tr.appendChild(startTd);
    tr.appendChild(endTd);
    tr.appendChild(descTd);
    tr.appendChild(actionTd);

    // Wire start→end filtering
    wireStartEndSync(startWrap, endWrap);

    cancelBtn.addEventListener('click', renderView);
    saveBtn.addEventListener('click', async () => {
      const project     = projectSel.value;
      const start_time  = readTimeSelects(startWrap);
      const end_time    = readTimeSelects(endWrap);
      const description = descInput.value.trim();
      errDiv.textContent = '';

      if (!project || !start_time || !end_time) {
        errDiv.textContent = 'Project, start time, and end time are required.';
        return;
      }

      try {
        const res = await fetch(`/api/entries/${entry.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project, start_time, end_time, description })
        });

        if (res.ok) {
          const updated    = await res.json();
          entry.project     = updated.project;
          entry.start_time  = updated.start_time;
          entry.end_time    = updated.end_time;
          entry.description = updated.description;
          await loadHeatmap();
          renderView();
        } else {
          const data = await res.json();
          errDiv.textContent = data.errors
            ? data.errors.map(e => e.message).join(' ')
            : (data.message || 'Save failed.');
        }
      } catch (_) {
        errDiv.textContent = 'Network error.';
      }
    });
  }

  renderView();
  return tr;
}

async function deleteEntry(id, tr, date) {
  if (!confirm('Delete this entry?')) return;
  try {
    const res = await fetch(`/api/entries/${id}`, { method: 'DELETE' });
    if (res.status === 204) {
      tr.remove();
      await loadHeatmap();
      if (container.querySelectorAll('tbody tr').length === 0) {
        container.innerHTML = '<p class="empty-state">No entries recorded for this date.</p>';
      }
    }
  } catch (_) {}
}

// ─── Settings Modal ───────────────────────────────────────────────────────────
const settingsOverlay = document.getElementById('settings-overlay');

document.getElementById('btn-settings').addEventListener('click', async () => {
  await fetchProjects();
  renderProjectsList();
  document.getElementById('new-project-input').value = '';
  document.getElementById('settings-error').textContent = '';
  document.getElementById('settings-error').classList.remove('visible');
  settingsOverlay.classList.add('open');
});

document.getElementById('btn-settings-close').addEventListener('click', () => {
  settingsOverlay.classList.remove('open');
});
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.remove('open');
});

function showSettingsError(msg) {
  const el = document.getElementById('settings-error');
  el.textContent = msg;
  el.classList.add('visible');
}

function renderProjectsList() {
  const tbody = document.getElementById('projects-tbody');
  tbody.innerHTML = '';

  if (allProjects.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" style="color:#6b7280;font-style:italic;">No projects yet.</td></tr>';
    return;
  }

  for (const project of allProjects) {
    const tr = document.createElement('tr');

    function renderProjView() {
      const hiddenStyle = project.hidden ? 'color:#9ca3af;text-decoration:line-through;' : '';
      tr.innerHTML = `
        <td style="${hiddenStyle}">${escHtml(project.name)}${project.hidden ? ' <span style="font-size:0.75rem;color:#9ca3af;">(hidden)</span>' : ''}</td>
        <td style="white-space:nowrap;">
          <button class="secondary small proj-edit-btn" aria-label="Edit ${escHtml(project.name)}">Edit</button>
          <button class="secondary small proj-hide-btn" aria-label="${project.hidden ? 'Show' : 'Hide'} ${escHtml(project.name)}">${project.hidden ? 'Show' : 'Hide'}</button>
          <button class="danger small proj-delete-btn" aria-label="Delete ${escHtml(project.name)}">Delete</button>
        </td>
      `;
      tr.querySelector('.proj-edit-btn').addEventListener('click', renderProjEdit);
      tr.querySelector('.proj-delete-btn').addEventListener('click', () => deleteProject(project.id, tr));
      tr.querySelector('.proj-hide-btn').addEventListener('click', () => toggleProjectHidden(project));
    }

    function renderProjEdit() {
      tr.innerHTML = `
        <td><input type="text" class="proj-name-input" value="${escHtml(project.name)}" style="width:100%;padding:0.3rem 0.4rem;border:1px solid #d1d5db;border-radius:4px;" /></td>
        <td>
          <button class="small proj-save-btn">Save</button>
          <button class="secondary small proj-cancel-btn">Cancel</button>
        </td>
      `;
      tr.querySelector('.proj-cancel-btn').addEventListener('click', renderProjView);
      tr.querySelector('.proj-save-btn').addEventListener('click', async () => {
        const newName = tr.querySelector('.proj-name-input').value.trim();
        if (!newName) return;
        try {
          const res = await fetch(`/api/projects/${project.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
          });
          if (res.ok) {
            const updated = await res.json();
            project.name = updated.name;
            await fetchProjects();
            renderProjectsList();
          } else {
            const data = await res.json();
            showSettingsError(data.message || 'Failed to update project.');
          }
        } catch (_) {
          showSettingsError('Network error.');
        }
      });
    }

    renderProjView();
    tbody.appendChild(tr);
  }
}

async function toggleProjectHidden(project) {
  try {
    const res = await fetch(`/api/projects/${project.id}/hidden`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: !project.hidden })
    });
    if (res.ok) {
      const updated = await res.json();
      project.hidden = updated.hidden;
      await fetchProjects();
      renderProjectsList();
    } else {
      const data = await res.json();
      showSettingsError(data.message || 'Failed to update project.');
    }
  } catch (_) {
    showSettingsError('Network error.');
  }
}

async function deleteProject(id, tr) {
  if (!confirm('Delete this project? This will not delete existing time entries.')) return;
  try {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (res.status === 204) {
      await fetchProjects();
      renderProjectsList();
    } else {
      const data = await res.json();
      showSettingsError(data.message || 'Failed to delete project.');
    }
  } catch (_) {
    showSettingsError('Network error.');
  }
}

document.getElementById('btn-add-project').addEventListener('click', async () => {
  const input = document.getElementById('new-project-input');
  const name  = input.value.trim();
  if (!name) return;

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (res.status === 201 || res.status === 409) {
      input.value = '';
      await fetchProjects();
      renderProjectsList();
    } else {
      const data = await res.json();
      showSettingsError(data.message || 'Failed to add project.');
    }
  } catch (_) {
    showSettingsError('Network error.');
  }
});

// Allow Enter key in new project input
document.getElementById('new-project-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-add-project').click();
});

// ─── Backup & Restore ─────────────────────────────────────────────────────────

// Download backup — just navigate to the endpoint
document.getElementById('btn-backup').addEventListener('click', () => {
  window.location.href = '/api/backup';
});

// Restore — pick a file, read it, POST to /api/restore
document.getElementById('btn-restore-pick').addEventListener('click', () => {
  document.getElementById('restore-file-input').click();
});

document.getElementById('restore-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('restore-status');
  statusEl.style.display = 'block';
  statusEl.style.color   = '#6b7280';
  statusEl.textContent   = `Reading ${file.name}…`;

  let backup;
  try {
    const text = await file.text();
    backup = JSON.parse(text);
  } catch (_) {
    statusEl.style.color = '#dc2626';
    statusEl.textContent = 'Could not parse file. Make sure it is a valid JSON backup.';
    e.target.value = '';
    return;
  }

  statusEl.textContent = 'Uploading…';

  try {
    const res = await fetch('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup)
    });
    const data = await res.json();

    if (res.ok) {
      statusEl.style.color = '#15803d';
      statusEl.textContent =
        `✓ ${data.message} ` +
        `Added ${data.projectsAdded} project(s), ` +
        `${data.entriesAdded} entry/entries. ` +
        `${data.entriesSkipped} skipped (already exist).`;
      // Refresh projects list and heatmap
      await fetchProjects();
      renderProjectsList();
      await loadHeatmap();
    } else {
      statusEl.style.color = '#dc2626';
      statusEl.textContent = data.message || 'Restore failed.';
    }
  } catch (_) {
    statusEl.style.color = '#dc2626';
    statusEl.textContent = 'Network error during restore.';
  }

  // Reset file input so the same file can be re-selected if needed
  e.target.value = '';
});
