'use strict';

const errorEl = document.getElementById('export-error');
const startInput = document.getElementById('export-start');
const endInput = document.getElementById('export-end');
const invoiceDateInput = document.getElementById('invoice-date');
const invoiceNumberInput = document.getElementById('invoice-number');
const includeExpensesInput = document.getElementById('include-expenses');
const projectsEl = document.getElementById('export-projects');
const fromSelect = document.getElementById('from-profile');
const toSelect = document.getElementById('to-profile');
const standardRateField = document.getElementById('standard-rate-field');
const standardRateSelect = document.getElementById('standard-rate');
const signatureSelect = document.getElementById('signature-select');
let projects = [];
let rateMode = 'project';

const today = new Date();
const dayOfWeek = today.getDay();
const monday = new Date(today);
monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

function toIsoDate(d) { return d.toISOString().slice(0, 10); }

startInput.value = toIsoDate(monday);
endInput.value = toIsoDate(today);
invoiceDateInput.value = toIsoDate(today);

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add('visible');
}

function hideError() {
  errorEl.textContent = '';
  errorEl.classList.remove('visible');
}

async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) throw new Error('failed');
    projects = await res.json();
    await renderProjects();
  } catch (_) {
    projectsEl.innerHTML = '<span style="color:#dc2626;font-size:0.9rem;">Failed to load projects.</span>';
  }
}

function formatHours(value) {
  const rounded = Math.round(Number(value || 0) * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)} hrs`;
}

async function loadProjectHours() {
  const totals = new Map();
  const start = startInput.value;
  const end = endInput.value;
  if (!start || !end || start > end) return totals;
  try {
    const res = await fetch(`/api/summary?start=${start}&end=${end}`);
    if (!res.ok) return totals;
    const summary = await res.json();
    for (const day of summary) {
      for (const project of day.projects || []) {
        totals.set(project.project, (totals.get(project.project) || 0) + Number(project.hours || 0));
      }
    }
  } catch (_) {}
  return totals;
}

async function renderProjects() {
    if (projects.length === 0) {
      projectsEl.innerHTML = '<span style="color:#6b7280;font-size:0.9rem;">Add projects in Settings before exporting.</span>';
      return;
    }
    const checked = new Set([...document.querySelectorAll('.project-export-check:checked')].map(input => input.value));
    const hadRenderedProjects = document.querySelectorAll('.project-export-check').length > 0;
    const hoursByProject = await loadProjectHours();
    projectsEl.innerHTML = projects.map(project => `
      <label>
        <input type="checkbox" class="project-export-check" value="${escHtml(project.name)}"${!hadRenderedProjects || checked.has(project.name) ? ' checked' : ''} />
        <span style="display:flex;justify-content:space-between;gap:0.75rem;width:100%;">
          <span>${escHtml(project.name)}${project.hidden ? ' (hidden)' : ''}</span>
          <span style="color:#6b7280;">${formatHours(hoursByProject.get(project.name) || 0)}</span>
        </span>
      </label>
    `).join('');
}

async function loadProfiles(kind, selectEl) {
  try {
    const res = await fetch(`/api/invoice-profiles?kind=${kind}`);
    if (!res.ok) throw new Error('failed');
    const profiles = await res.json();
    selectEl.innerHTML = '<option value="">Select...</option>' + profiles.map(profile =>
      `<option value="${profile.id}">${escHtml(profile.label)}</option>`
    ).join('');
  } catch (_) {
    selectEl.innerHTML = '<option value="">Failed to load</option>';
  }
}

function updateRateMode() {
  rateMode = document.querySelector('input[name="export-rate-mode"]:checked')?.value || 'project';
  standardRateField.style.display = rateMode === 'standard' ? 'block' : 'none';
}

async function loadStandardRates() {
  try {
    const res = await fetch('/api/standard-rates');
    if (!res.ok) throw new Error('failed');
    const rates = await res.json();
    standardRateSelect.innerHTML = '<option value="">Select...</option>' + rates.map(rate =>
      `<option value="${rate.id}">$${Number(rate.amount || 0).toFixed(2)}/hr</option>`
    ).join('');
  } catch (_) {
    standardRateSelect.innerHTML = '<option value="">Failed to load</option>';
  }
}

async function loadSignatures() {
  try {
    const res = await fetch('/api/signatures');
    if (!res.ok) throw new Error('failed');
    const signatures = await res.json();
    signatureSelect.innerHTML = '<option value="">No signature</option>' + signatures.map(sig =>
      `<option value="${sig.id}">${escHtml(sig.label)}</option>`
    ).join('');
  } catch (_) {
    signatureSelect.innerHTML = '<option value="">No signature</option>';
  }
}

async function init() {
  await Promise.all([
    loadProjects(),
    loadProfiles('from', fromSelect),
    loadProfiles('to', toSelect),
    loadStandardRates(),
    loadSignatures()
  ]);
  updateRateMode();
}

function buildExportUrl(format, preview = false) {
  hideError();
  const start = startInput.value;
  const end = endInput.value;
  if (!start) { showError('Please select a start date.'); return null; }
  if (!end) { showError('Please select an end date.'); return null; }
  if (start > end) { showError('Start date must be on or before end date.'); return null; }

  const selectedProjects = [...document.querySelectorAll('.project-export-check:checked')]
    .map(input => input.value);
  if (selectedProjects.length === 0) {
    showError('Select at least one project.');
    return null;
  }
  if (rateMode === 'standard' && !standardRateSelect.value) {
    showError('Select a standard rate.');
    return null;
  }

  const params = new URLSearchParams({
    start,
    end,
    format,
    invoiceNumber: invoiceNumberInput.value.trim(),
    invoiceDate: invoiceDateInput.value
  });
  if (fromSelect.value) params.set('fromProfileId', fromSelect.value);
  if (toSelect.value) params.set('toProfileId', toSelect.value);
  params.set('rateMode', rateMode);
  if (rateMode === 'standard') params.set('standardRateId', standardRateSelect.value);
  if (format === 'pdf' && signatureSelect.value) params.set('signatureId', signatureSelect.value);
  if (includeExpensesInput.checked) params.set('includeExpenses', '1');
  if (preview) params.set('preview', '1');
  for (const project of selectedProjects) params.append('projects', project);
  return `/api/export?${params.toString()}`;
}

function exportInvoice(format) {
  const url = buildExportUrl(format);
  if (url) window.location.href = url;
}

function previewPdf() {
  const url = buildExportUrl('pdf', true);
  if (url) window.open(url, '_blank', 'noopener');
}

document.getElementById('btn-export-xlsx').addEventListener('click', () => exportInvoice('xlsx'));
document.getElementById('btn-export-pdf').addEventListener('click', () => exportInvoice('pdf'));
document.getElementById('btn-preview-pdf').addEventListener('click', previewPdf);
document.querySelectorAll('input[name="export-rate-mode"]').forEach(input => {
  input.addEventListener('change', updateRateMode);
});
startInput.addEventListener('change', renderProjects);
endInput.addEventListener('change', renderProjects);

init();
