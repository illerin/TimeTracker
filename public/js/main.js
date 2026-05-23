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
const MINUTES = ['00', '15', '30', '45'];
let timeWindow = { start: '07', end: '22' };
let HOUR_OPTS = buildHourOptions(timeWindow.start, timeWindow.end);

function hourLabel(hour) {
  if (hour === 24) return '12 AM';
  const period = hour < 12 ? 'AM' : 'PM';
  let display = hour % 12;
  if (display === 0) display = 12;
  return `${display} ${period}`;
}

function buildHourOptions(start, end) {
  const opts = [];
  for (let hour = Number(start); hour <= Number(end); hour++) {
    opts.push({
      value: String(hour).padStart(2, '0'),
      label: hourLabel(hour),
      period: hour < 12 || hour === 24 ? 'am' : 'pm'
    });
  }
  return opts;
}

async function fetchTimeWindow() {
  try {
    const res = await fetch('/api/settings/time-window');
    if (!res.ok) return;
    timeWindow = await res.json();
    HOUR_OPTS = buildHourOptions(timeWindow.start, timeWindow.end);
  } catch (_) {}
}

fetchTimeWindow();

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

  let hourOpts = cssClass.includes('start')
    ? HOUR_OPTS.filter(opt => opt.value !== '24')
    : HOUR_OPTS;
  if (initH && !hourOpts.some(opt => opt.value === initH)) {
    hourOpts = [...hourOpts, {
      value: initH,
      label: hourLabel(Number(initH)),
      period: Number(initH) < 12 || Number(initH) === 24 ? 'am' : 'pm'
    }].sort((a, b) => a.value.localeCompare(b.value));
  }

  for (const opt of hourOpts) {
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
    const selected = hourOpts.find(o => o.value === hSel.value);
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
    const shouldAutoSetEnd = startH && !currentEnd;

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
      if (opt.value === currentEnd || (shouldAutoSetEnd && opt.value === startH)) el.selected = true;
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
let allProjects = []; // [{ id, name, hidden, hourly_rate }] — all projects including hidden
let invoiceProfiles = [];
let standardRates = [];
let signatures = [];
let rateMode = 'project';

async function fetchProjects() {
  try {
    const res = await fetch('/api/projects');
    if (res.ok) {
      const projects = await res.json();
      allProjects = projects.map(project => typeof project === 'string'
        ? { id: null, name: project, hidden: 0, hourly_rate: 0 }
        : {
            id: project.id,
            name: project.name || '',
            hidden: project.hidden || 0,
            hourly_rate: project.hourly_rate || 0
          });
    }
  } catch (_) {}
}
fetchProjects();

async function fetchInvoiceProfiles() {
  try {
    const res = await fetch('/api/invoice-profiles');
    if (res.ok) invoiceProfiles = await res.json();
  } catch (_) {}
}

async function fetchRateMode() {
  try {
    const res = await fetch('/api/settings/rate-mode');
    if (res.ok) {
      const data = await res.json();
      rateMode = data.mode || 'project';
    }
  } catch (_) {}
}

async function fetchStandardRates() {
  try {
    const res = await fetch('/api/standard-rates');
    if (res.ok) standardRates = await res.json();
  } catch (_) {}
}

async function fetchSignatures() {
  try {
    const res = await fetch('/api/signatures');
    if (res.ok) signatures = await res.json();
  } catch (_) {}
}

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
    const matches = allProjects.filter(p => p.name.toLowerCase().includes(val) && val.length > 0);
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
      defaultStart = `${timeWindow.start}:00`;
    } else {
      const lastRow     = existingRows[existingRows.length - 1];
      const lastEndWrap = lastRow.querySelector('.end-selects');
      defaultStart = lastEndWrap ? readTimeSelects(lastEndWrap) : `${timeWindow.start}:00`;
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

  const entries = [];

  for (const row of rows) {
    const project     = row.querySelector('.project-select').value;
    const startWrap   = row.querySelector('.start-selects');
    const endWrap     = row.querySelector('.end-selects');
    const start_time  = readTimeSelects(startWrap);
    const end_time    = readTimeSelects(endWrap);
    const description = row.querySelector('.description-input').value.trim();

    if (!project) continue;
    if (!start_time || !end_time) {
      showModalError('Rows with a project must have a start time and end time.');
      return;
    }

    entries.push({ project, start_time, end_time, description });
  }

  if (entries.length === 0) {
    showModalError('Please add at least one time entry with a project.');
    return;
  }

  try {
    const res = await fetch('/api/workday', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: selectedDate, entries })
    });
    if (!res.ok) {
      const data = await res.json();
      showModalError(data.errors
        ? data.errors.map(e => e.message).join('\n')
        : (data.message || 'Failed to save entries.'));
      return;
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
// Expenses tab
const timePanel = document.getElementById('time-panel');
const expensesPanel = document.getElementById('expenses-panel');
const expenseError = document.getElementById('expense-error');
const expenseProjectSelect = document.getElementById('expense-project');
const expenseReportContainer = document.getElementById('expense-report-container');
const recurringExpensesContainer = document.getElementById('recurring-expenses-container');

function showExpenseError(msg) {
  expenseError.textContent = msg;
  expenseError.classList.add('visible');
}

function hideExpenseError() {
  expenseError.textContent = '';
  expenseError.classList.remove('visible');
}

function switchTopTab(tab) {
  const showExpenses = tab === 'expenses';
  timePanel.style.display = showExpenses ? 'none' : 'flex';
  expensesPanel.style.display = showExpenses ? 'block' : 'none';
  document.getElementById('tab-time').classList.toggle('secondary', showExpenses);
  document.getElementById('tab-expenses').classList.toggle('secondary', !showExpenses);
  if (showExpenses) initExpensesTab();
}

document.getElementById('tab-time').addEventListener('click', () => switchTopTab('time'));
document.getElementById('tab-expenses').addEventListener('click', () => switchTopTab('expenses'));

function setExpenseDefaults() {
  const todayValue = todayIso();
  document.getElementById('expense-date').value = todayValue;
  document.getElementById('expense-report-end').value = todayValue;
  const start = new Date(today);
  start.setDate(today.getDate() - 30);
  document.getElementById('expense-report-start').value = toIso(start.getFullYear(), start.getMonth(), start.getDate());
}

function fillExpenseProjectSelect() {
  const visibleProjects = allProjects.filter(project => !project.hidden);
  expenseProjectSelect.innerHTML = '<option value="">Select project</option>' +
    visibleProjects.map(project => `<option value="${escHtml(project.name)}">${escHtml(project.name)}</option>`).join('');
}

async function initExpensesTab() {
  hideExpenseError();
  if (!document.getElementById('expense-date').value) setExpenseDefaults();
  await fetchProjects();
  fillExpenseProjectSelect();
  await Promise.all([loadExpenseReport(), loadRecurringExpenses()]);
}

document.getElementById('btn-save-expense').addEventListener('click', async () => {
  hideExpenseError();
  const date = document.getElementById('expense-date').value;
  const project = expenseProjectSelect.value;
  const description = document.getElementById('expense-description').value.trim();
  const amount = document.getElementById('expense-amount').value;
  const recurring = document.getElementById('expense-recurring').checked;
  if (!date || !project || amount === '') {
    showExpenseError('Date, project, and amount are required.');
    return;
  }
  const url = recurring ? '/api/recurring-expenses' : '/api/expenses';
  const payload = recurring
    ? {
        project,
        description,
        amount,
        frequency: document.getElementById('expense-frequency').value,
        start_date: date,
        expiration_date: document.getElementById('expense-expiration').value || null
      }
    : { date, project, description, amount };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const data = await res.json();
      showExpenseError(data.message || 'Failed to save expense.');
      return;
    }
    document.getElementById('expense-description').value = '';
    document.getElementById('expense-amount').value = '';
    document.getElementById('expense-expiration').value = '';
    await Promise.all([loadExpenseReport(), loadRecurringExpenses()]);
  } catch (_) {
    showExpenseError('Network error.');
  }
});

document.getElementById('btn-load-expenses').addEventListener('click', () => loadExpenseReport());
document.getElementById('expense-report-sort').addEventListener('change', () => loadExpenseReport());

async function loadExpenseReport() {
  const start = document.getElementById('expense-report-start').value;
  const end = document.getElementById('expense-report-end').value;
  const sort = document.getElementById('expense-report-sort').value;
  if (!start || !end) return;
  expenseReportContainer.innerHTML = '<p class="empty-state">Loading expenses...</p>';
  try {
    const res = await fetch(`/api/expenses/report?start=${start}&end=${end}&sort=${sort}`);
    if (!res.ok) {
      const data = await res.json();
      showExpenseError(data.message || 'Failed to load expenses.');
      return;
    }
    const data = await res.json();
    document.getElementById('expense-report-total').textContent = `Total: $${Number(data.total || 0).toFixed(2)}`;
    if (data.rows.length === 0) {
      expenseReportContainer.innerHTML = '<p class="empty-state">No expenses found.</p>';
      return;
    }
    const table = document.createElement('table');
    table.className = 'entry-table';
    table.innerHTML = '<thead><tr><th>Date</th><th>Project</th><th>Description</th><th>Amount</th><th>Type</th><th></th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    for (const expense of data.rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escHtml(expense.date)}</td>
        <td>${escHtml(expense.project)}</td>
        <td>${escHtml(expense.description || '')}</td>
        <td>$${Number(expense.amount || 0).toFixed(2)}</td>
        <td>${expense.recurring_expense_id ? 'Recurring' : 'One-time'}</td>
        <td><button class="danger small expense-delete-btn" data-id="${expense.id}">Delete</button></td>
      `;
      tbody.appendChild(tr);
    }
    expenseReportContainer.innerHTML = '';
    expenseReportContainer.appendChild(table);
    expenseReportContainer.querySelectorAll('.expense-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this logged expense?')) return;
        await fetch(`/api/expenses/${btn.dataset.id}`, { method: 'DELETE' });
        loadExpenseReport();
      });
    });
  } catch (_) {
    showExpenseError('Network error.');
  }
}

async function loadRecurringExpenses() {
  try {
    const res = await fetch('/api/recurring-expenses');
    if (!res.ok) return;
    const rules = await res.json();
    if (rules.length === 0) {
      recurringExpensesContainer.innerHTML = '<p class="empty-state">No recurring expenses.</p>';
      return;
    }
    const table = document.createElement('table');
    table.className = 'entry-table';
    table.innerHTML = '<thead><tr><th>Project</th><th>Description</th><th>Amount</th><th>Frequency</th><th>Start</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    for (const rule of rules) {
      const status = rule.stopped ? 'Stopped' : (rule.paused ? 'Paused' : 'Active');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escHtml(rule.project)}</td>
        <td>${escHtml(rule.description || '')}</td>
        <td>$${Number(rule.amount || 0).toFixed(2)}</td>
        <td>${escHtml(rule.frequency)}</td>
        <td>${escHtml(rule.start_date)}</td>
        <td>${escHtml(rule.expiration_date || '')}</td>
        <td>${status}</td>
        <td>
          <button class="secondary small recurring-pause-btn" data-id="${rule.id}" data-paused="${rule.paused ? '1' : '0'}">${rule.paused ? 'Resume' : 'Pause'}</button>
          <button class="danger small recurring-stop-btn" data-id="${rule.id}" ${rule.stopped ? 'disabled' : ''}>Stop</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
    recurringExpensesContainer.innerHTML = '';
    recurringExpensesContainer.appendChild(table);
    recurringExpensesContainer.querySelectorAll('.recurring-pause-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const paused = btn.dataset.paused !== '1';
        await fetch(`/api/recurring-expenses/${btn.dataset.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paused })
        });
        await Promise.all([loadRecurringExpenses(), loadExpenseReport()]);
      });
    });
    recurringExpensesContainer.querySelectorAll('.recurring-stop-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Stop this recurring expense? Existing logged expenses stay.')) return;
        await fetch(`/api/recurring-expenses/${btn.dataset.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stopped: true })
        });
        loadRecurringExpenses();
      });
    });
  } catch (_) {
    recurringExpensesContainer.innerHTML = '<p class="empty-state">Failed to load recurring expenses.</p>';
  }
}

const settingsOverlay = document.getElementById('settings-overlay');

function fillTimeWindowSelects() {
  const startSel = document.getElementById('time-window-start');
  const endSel = document.getElementById('time-window-end');
  const startOptions = buildHourOptions('00', '23');
  const endOptions = buildHourOptions('00', '24');

  startSel.innerHTML = startOptions.map(opt =>
    `<option value="${opt.value}"${opt.value === timeWindow.start ? ' selected' : ''}>${opt.label}</option>`
  ).join('');
  endSel.innerHTML = endOptions.map(opt =>
    `<option value="${opt.value}"${opt.value === timeWindow.end ? ' selected' : ''}>${opt.label}</option>`
  ).join('');
}

document.getElementById('btn-settings').addEventListener('click', async () => {
  settingsOverlay.classList.add('open');
  document.getElementById('projects-tbody').innerHTML =
    '<tr><td colspan="3" style="color:#6b7280;font-style:italic;">Loading...</td></tr>';
  document.getElementById('from-profiles-list').innerHTML =
    '<div style="color:#6b7280;font-size:0.85rem;font-style:italic;">Loading...</div>';
  document.getElementById('to-profiles-list').innerHTML =
    '<div style="color:#6b7280;font-size:0.85rem;font-style:italic;">Loading...</div>';
  document.getElementById('new-project-input').value = '';
  document.getElementById('invoice-profile-label').value = '';
  document.getElementById('invoice-profile-details').value = '';
  document.getElementById('standard-rate-label').value = '';
  document.getElementById('standard-rate-amount').value = '';
  document.getElementById('signature-label').value = '';
  document.getElementById('signature-file').value = '';
  delete document.getElementById('btn-save-invoice-profile').dataset.editId;
  document.getElementById('settings-error').textContent = '';
  document.getElementById('settings-error').classList.remove('visible');
  fillTimeWindowSelects();

  try {
    await Promise.allSettled([
      fetchProjects(),
      fetchInvoiceProfiles(),
      fetchRateMode(),
      fetchStandardRates(),
      fetchSignatures(),
      fetchTimeWindow()
    ]);
    renderProjectsList();
    renderInvoiceProfiles();
    renderRateSettings();
    renderSignatures();
    fillTimeWindowSelects();
  } catch (_) {
    showSettingsError('Failed to load settings.');
  }
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
    tbody.innerHTML = '<tr><td colspan="3" style="color:#6b7280;font-style:italic;">No projects yet.</td></tr>';
    return;
  }

  for (const project of allProjects) {
    const tr = document.createElement('tr');

    function renderProjView() {
      const hiddenStyle = project.hidden ? 'color:#9ca3af;text-decoration:line-through;' : '';
      tr.innerHTML = `
        <td style="${hiddenStyle}">${escHtml(project.name)}${project.hidden ? ' <span style="font-size:0.75rem;color:#9ca3af;">(hidden)</span>' : ''}</td>
        <td style="white-space:nowrap;">$${Number(project.hourly_rate || 0).toFixed(2)}/hr</td>
        <td style="white-space:nowrap;">
          <button class="secondary small proj-rate-btn" aria-label="Rate ${escHtml(project.name)}">Rate</button>
          <button class="secondary small proj-edit-btn" aria-label="Edit ${escHtml(project.name)}">Edit</button>
          <button class="secondary small proj-hide-btn" aria-label="${project.hidden ? 'Show' : 'Hide'} ${escHtml(project.name)}">${project.hidden ? 'Show' : 'Hide'}</button>
          <button class="danger small proj-delete-btn" aria-label="Delete ${escHtml(project.name)}">Delete</button>
        </td>
      `;
      tr.querySelector('.proj-rate-btn').addEventListener('click', renderProjRate);
      tr.querySelector('.proj-edit-btn').addEventListener('click', renderProjEdit);
      tr.querySelector('.proj-delete-btn').addEventListener('click', () => deleteProject(project.id, tr));
      tr.querySelector('.proj-hide-btn').addEventListener('click', () => toggleProjectHidden(project));
    }

    function renderProjRate() {
      tr.innerHTML = `
        <td>${escHtml(project.name)}</td>
        <td><input type="number" min="0" step="0.01" class="proj-rate-input" value="${Number(project.hourly_rate || 0)}" style="width:90px;padding:0.3rem 0.4rem;border:1px solid #d1d5db;border-radius:4px;" /></td>
        <td>
          <button class="small proj-rate-save-btn">Save</button>
          <button class="secondary small proj-rate-cancel-btn">Cancel</button>
        </td>
      `;
      tr.querySelector('.proj-rate-cancel-btn').addEventListener('click', renderProjView);
      tr.querySelector('.proj-rate-save-btn').addEventListener('click', async () => {
        if (!project.id) {
          showSettingsError('Refresh the app before setting rates for this project.');
          return;
        }

        const hourly_rate = tr.querySelector('.proj-rate-input').value;
        try {
          const res = await fetch(`/api/projects/${project.id}/rate`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hourly_rate })
          });
          if (res.ok) {
            const updated = await res.json();
            project.hourly_rate = updated.hourly_rate;
            await fetchProjects();
            renderProjectsList();
          } else {
            const data = await res.json();
            showSettingsError(data.message || 'Failed to update rate.');
          }
        } catch (_) {
          showSettingsError('Network error.');
        }
      });
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

function renderInvoiceProfiles() {
  renderInvoiceProfileList('from', document.getElementById('from-profiles-list'));
  renderInvoiceProfileList('to', document.getElementById('to-profiles-list'));
}

function renderInvoiceProfileList(kind, containerEl) {
  const profiles = invoiceProfiles.filter(profile => profile.kind === kind);
  if (profiles.length === 0) {
    containerEl.innerHTML = '<div style="color:#6b7280;font-size:0.85rem;font-style:italic;">None saved.</div>';
    return;
  }
  containerEl.innerHTML = profiles.map(profile => `
    <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:center;margin-bottom:0.35rem;">
      <button class="secondary small invoice-profile-edit" data-id="${profile.id}" type="button" style="flex:1;text-align:left;">${escHtml(profile.label)}</button>
      <button class="danger small invoice-profile-delete" data-id="${profile.id}" type="button">Delete</button>
    </div>
  `).join('');

  containerEl.querySelectorAll('.invoice-profile-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const profile = invoiceProfiles.find(p => p.id === Number(btn.dataset.id));
      if (!profile) return;
      document.getElementById('invoice-profile-kind').value = profile.kind;
      document.getElementById('invoice-profile-label').value = profile.label;
      document.getElementById('invoice-profile-details').value = profile.details;
      document.getElementById('btn-save-invoice-profile').dataset.editId = String(profile.id);
    });
  });

  containerEl.querySelectorAll('.invoice-profile-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this invoice profile?')) return;
      try {
        const res = await fetch(`/api/invoice-profiles/${btn.dataset.id}`, { method: 'DELETE' });
        if (res.status === 204) {
          await fetchInvoiceProfiles();
          renderInvoiceProfiles();
        }
      } catch (_) {
        showSettingsError('Network error.');
      }
    });
  });
}

document.getElementById('btn-save-invoice-profile').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-invoice-profile');
  const editId = btn.dataset.editId;
  const payload = {
    kind: document.getElementById('invoice-profile-kind').value,
    label: document.getElementById('invoice-profile-label').value.trim(),
    details: document.getElementById('invoice-profile-details').value.trim()
  };
  if (!payload.label) {
    showSettingsError('Profile label is required.');
    return;
  }

  try {
    const res = await fetch(editId ? `/api/invoice-profiles/${editId}` : '/api/invoice-profiles', {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const data = await res.json();
      showSettingsError(data.message || 'Failed to save invoice profile.');
      return;
    }
    delete btn.dataset.editId;
    document.getElementById('invoice-profile-label').value = '';
    document.getElementById('invoice-profile-details').value = '';
    await fetchInvoiceProfiles();
    renderInvoiceProfiles();
  } catch (_) {
    showSettingsError('Network error.');
  }
});

function renderRateSettings() {
  const container = document.getElementById('standard-rates-list');
  if (standardRates.length === 0) {
    container.innerHTML = '<div style="color:#6b7280;font-size:0.85rem;font-style:italic;">No standard rates saved.</div>';
    return;
  }
  container.innerHTML = standardRates.map(rate => `
    <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:center;margin-bottom:0.35rem;">
      <span style="font-size:0.9rem;">${escHtml(rate.label)} - $${Number(rate.amount || 0).toFixed(2)}/hr</span>
      <button class="danger small standard-rate-delete" data-id="${rate.id}" type="button">Delete</button>
    </div>
  `).join('');
  container.querySelectorAll('.standard-rate-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this standard rate?')) return;
      try {
        const res = await fetch(`/api/standard-rates/${btn.dataset.id}`, { method: 'DELETE' });
        if (res.status === 204) {
          await fetchStandardRates();
          renderRateSettings();
        }
      } catch (_) {
        showSettingsError('Network error.');
      }
    });
  });
}

document.getElementById('btn-save-standard-rate').addEventListener('click', async () => {
  const label = document.getElementById('standard-rate-label').value.trim();
  const amount = document.getElementById('standard-rate-amount').value;
  if (!label) {
    showSettingsError('Rate name is required.');
    return;
  }
  try {
    const res = await fetch('/api/standard-rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, amount })
    });
    const data = await res.json();
    if (!res.ok) {
      showSettingsError(data.message || 'Failed to save standard rate.');
      return;
    }
    document.getElementById('standard-rate-label').value = '';
    document.getElementById('standard-rate-amount').value = '';
    await fetchStandardRates();
    renderRateSettings();
  } catch (_) {
    showSettingsError('Network error.');
  }
});

function renderSignatures() {
  const container = document.getElementById('signatures-list');
  if (signatures.length === 0) {
    container.innerHTML = '<div style="color:#6b7280;font-size:0.85rem;font-style:italic;">No signatures saved.</div>';
    return;
  }
  container.innerHTML = signatures.map(sig => `
    <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:center;margin-bottom:0.35rem;">
      <span style="font-size:0.9rem;">${escHtml(sig.label)}</span>
      <button class="danger small signature-delete" data-id="${sig.id}" type="button">Delete</button>
    </div>
  `).join('');
  container.querySelectorAll('.signature-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this signature?')) return;
      try {
        const res = await fetch(`/api/signatures/${btn.dataset.id}`, { method: 'DELETE' });
        if (res.status === 204) {
          await fetchSignatures();
          renderSignatures();
        }
      } catch (_) {
        showSettingsError('Network error.');
      }
    });
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveSignatureDataUrl(label, dataUrl, placement = null) {
  const res = await fetch('/api/signatures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, dataUrl, placement })
  });
  const data = await res.json();
  if (!res.ok) {
    showSettingsError(data.message || 'Failed to save signature.');
    return false;
  }
  await fetchSignatures();
  renderSignatures();
  return true;
}

document.getElementById('btn-save-signature').addEventListener('click', async () => {
  const label = document.getElementById('signature-label').value.trim();
  const file = document.getElementById('signature-file').files[0];
  if (!label || !file) {
    showSettingsError('Signature name and image are required.');
    return;
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    showSettingsError('Signature must be PNG, JPG, or WebP.');
    return;
  }
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const saved = await saveSignatureDataUrl(label, dataUrl);
    if (!saved) return;
    document.getElementById('signature-label').value = '';
    document.getElementById('signature-file').value = '';
  } catch (_) {
    showSettingsError('Network error.');
  }
});

const signaturePad = document.getElementById('signature-pad');
const signatureCtx = signaturePad.getContext('2d');
const signatureInkCanvas = document.createElement('canvas');
signatureInkCanvas.width = signaturePad.width;
signatureInkCanvas.height = signaturePad.height;
const signatureInkCtx = signatureInkCanvas.getContext('2d');
let drawingSignature = false;
let hasDrawnSignature = false;
const signaturePadLine = { x: 40, y: 135, width: 250 };
const signaturePdfScale = 210 / signaturePadLine.width;

function renderSignaturePad() {
  signatureCtx.fillStyle = '#ffffff';
  signatureCtx.fillRect(0, 0, signaturePad.width, signaturePad.height);
  signatureCtx.strokeStyle = '#111827';
  signatureCtx.lineWidth = 1.5;
  signatureCtx.beginPath();
  signatureCtx.moveTo(signaturePadLine.x, signaturePadLine.y);
  signatureCtx.lineTo(signaturePadLine.x + signaturePadLine.width, signaturePadLine.y);
  signatureCtx.stroke();
  signatureCtx.fillStyle = '#6b7280';
  signatureCtx.font = '13px system-ui, sans-serif';
  signatureCtx.fillText('Signature', signaturePadLine.x, signaturePadLine.y + 20);
  signatureCtx.drawImage(signatureInkCanvas, 0, 0);
}

function resetSignaturePad() {
  signatureInkCtx.clearRect(0, 0, signatureInkCanvas.width, signatureInkCanvas.height);
  hasDrawnSignature = false;
  renderSignaturePad();
}

function signaturePoint(evt) {
  const rect = signaturePad.getBoundingClientRect();
  return {
    x: ((evt.clientX - rect.left) / rect.width) * signaturePad.width,
    y: ((evt.clientY - rect.top) / rect.height) * signaturePad.height
  };
}

function signatureAssetFromInk(inkCanvas) {
  const data = inkCanvas.getContext('2d').getImageData(0, 0, inkCanvas.width, inkCanvas.height).data;
  let left = inkCanvas.width;
  let top = inkCanvas.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < inkCanvas.height; y += 1) {
    for (let x = 0; x < inkCanvas.width; x += 1) {
      if (data[((y * inkCanvas.width) + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) return null;

  const padding = 3;
  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  right = Math.min(inkCanvas.width - 1, right + padding);
  bottom = Math.min(inkCanvas.height - 1, bottom + padding);
  const width = right - left + 1;
  const height = bottom - top + 1;
  const cropped = document.createElement('canvas');
  cropped.width = width;
  cropped.height = height;
  cropped.getContext('2d').drawImage(inkCanvas, left, top, width, height, 0, 0, width, height);

  return {
    dataUrl: cropped.toDataURL('image/png'),
    placement: {
      x: Math.round((left - signaturePadLine.x) * signaturePdfScale),
      y: Math.round((top - signaturePadLine.y) * signaturePdfScale),
      width: Math.round(width * signaturePdfScale),
      height: Math.round(height * signaturePdfScale)
    }
  };
}

signaturePad.addEventListener('pointerdown', (evt) => {
  drawingSignature = true;
  hasDrawnSignature = true;
  signaturePad.setPointerCapture(evt.pointerId);
  const pt = signaturePoint(evt);
  signatureInkCtx.strokeStyle = document.getElementById('signature-color').value;
  signatureInkCtx.lineWidth = 2;
  signatureInkCtx.lineCap = 'round';
  signatureInkCtx.lineJoin = 'round';
  signatureInkCtx.beginPath();
  signatureInkCtx.moveTo(pt.x, pt.y);
});

signaturePad.addEventListener('pointermove', (evt) => {
  if (!drawingSignature) return;
  const pt = signaturePoint(evt);
  signatureInkCtx.lineTo(pt.x, pt.y);
  signatureInkCtx.stroke();
  renderSignaturePad();
});

signaturePad.addEventListener('pointerup', () => {
  drawingSignature = false;
});

signaturePad.addEventListener('pointercancel', () => {
  drawingSignature = false;
});

document.getElementById('btn-clear-drawn-signature').addEventListener('click', resetSignaturePad);

document.getElementById('btn-save-drawn-signature').addEventListener('click', async () => {
  const label = document.getElementById('signature-label').value.trim();
  if (!label) {
    showSettingsError('Signature name is required.');
    return;
  }
  if (!hasDrawnSignature) {
    showSettingsError('Draw a signature first.');
    return;
  }
  try {
    const asset = signatureAssetFromInk(signatureInkCanvas);
    if (!asset) {
      showSettingsError('Draw a signature first.');
      return;
    }
    const saved = await saveSignatureDataUrl(label, asset.dataUrl, asset.placement);
    if (!saved) return;
    document.getElementById('signature-label').value = '';
    resetSignaturePad();
  } catch (_) {
    showSettingsError('Network error.');
  }
});

document.getElementById('btn-save-typed-signature').addEventListener('click', async () => {
  const typedName = document.getElementById('typed-signature-name').value.trim();
  const label = document.getElementById('signature-label').value.trim() || typedName;
  if (!typedName) {
    showSettingsError('Type a name first.');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 700;
  canvas.height = 190;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = document.getElementById('signature-color').value;
  ctx.font = '48px "Brush Script MT", "Segoe Script", cursive';
  ctx.fillText(typedName, signaturePadLine.x + 6, signaturePadLine.y - 18);
  const asset = signatureAssetFromInk(canvas);

  try {
    const saved = await saveSignatureDataUrl(label, asset.dataUrl, asset.placement);
    if (!saved) return;
    document.getElementById('signature-label').value = '';
    document.getElementById('typed-signature-name').value = '';
  } catch (_) {
    showSettingsError('Network error.');
  }
});

resetSignaturePad();

document.getElementById('btn-save-time-window').addEventListener('click', async () => {
  const start = document.getElementById('time-window-start').value;
  const end = document.getElementById('time-window-end').value;
  if (Number(start) > Number(end)) {
    showSettingsError('Earliest time must be before latest time.');
    return;
  }

  try {
    const res = await fetch('/api/settings/time-window', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start, end })
    });
    const data = await res.json();
    if (!res.ok) {
      showSettingsError(data.message || 'Failed to save time window.');
      return;
    }

    function renderProjRate() {
      tr.innerHTML = `
        <td>${escHtml(project.name)}</td>
        <td><input type="number" min="0" step="0.01" class="proj-rate-input" value="${Number(project.hourly_rate || 0)}" style="width:90px;padding:0.3rem 0.4rem;border:1px solid #d1d5db;border-radius:4px;" /></td>
        <td>
          <button class="small proj-rate-save-btn">Save</button>
          <button class="secondary small proj-rate-cancel-btn">Cancel</button>
        </td>
      `;
      tr.querySelector('.proj-rate-cancel-btn').addEventListener('click', renderProjView);
      tr.querySelector('.proj-rate-save-btn').addEventListener('click', async () => {
        const hourly_rate = tr.querySelector('.proj-rate-input').value;
        try {
          const res = await fetch(`/api/projects/${project.id}/rate`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hourly_rate })
          });
          if (res.ok) {
            const updated = await res.json();
            project.hourly_rate = updated.hourly_rate;
            await fetchProjects();
            renderProjectsList();
          } else {
            const data = await res.json();
            showSettingsError(data.message || 'Failed to update rate.');
          }
        } catch (_) {
          showSettingsError('Network error.');
        }
      });
    }
    timeWindow = data;
    HOUR_OPTS = buildHourOptions(timeWindow.start, timeWindow.end);
  } catch (_) {
    showSettingsError('Network error.');
  }
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
        `${data.entriesSkipped} skipped (already exist). ` +
        `${data.settingsUpdated || 0} setting(s) updated.`;
      // Refresh projects list and heatmap
      await Promise.all([
        fetchProjects(),
        fetchInvoiceProfiles(),
        fetchRateMode(),
        fetchStandardRates(),
        fetchSignatures(),
        fetchTimeWindow()
      ]);
      fillTimeWindowSelects();
      renderProjectsList();
      renderInvoiceProfiles();
      renderRateSettings();
      renderSignatures();
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
