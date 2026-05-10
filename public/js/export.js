'use strict';

const errorEl   = document.getElementById('export-error');
const startInput = document.getElementById('export-start');
const endInput   = document.getElementById('export-end');

// Default to current week (Monday → today)
const today = new Date();
const dayOfWeek = today.getDay(); // 0=Sun
const monday = new Date(today);
monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

function toIsoDate(d) { return d.toISOString().slice(0, 10); }

startInput.value = toIsoDate(monday);
endInput.value   = toIsoDate(today);

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add('visible');
}
function hideError() {
  errorEl.textContent = '';
  errorEl.classList.remove('visible');
}

document.getElementById('btn-export').addEventListener('click', () => {
  hideError();
  const start = startInput.value;
  const end   = endInput.value;

  if (!start) { showError('Please select a start date.'); return; }
  if (!end)   { showError('Please select an end date.'); return; }
  if (start > end) { showError('Start date must be on or before end date.'); return; }

  // Trigger browser download by navigating to the export endpoint
  window.location.href = `/api/export?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
});
