'use strict';

const container = document.getElementById('summary-container');
const startInput = document.getElementById('sum-start');
const endInput   = document.getElementById('sum-end');

// Default range: last 30 days
const today = new Date();
const thirtyDaysAgo = new Date(today);
thirtyDaysAgo.setDate(today.getDate() - 30);

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

startInput.value = toIsoDate(thirtyDaysAgo);
endInput.value   = toIsoDate(today);

document.getElementById('btn-load-summary').addEventListener('click', () => {
  const start = startInput.value;
  const end   = endInput.value;
  if (!start || !end) {
    container.innerHTML = '<p class="error-msg">Please select both a start and end date.</p>';
    return;
  }
  if (start > end) {
    container.innerHTML = '<p class="error-msg">Start date must be on or before end date.</p>';
    return;
  }
  loadSummary(start, end);
});

async function loadSummary(start, end) {
  container.innerHTML = '<p>Loading…</p>';
  try {
    const res = await fetch(`/api/summary?start=${start}&end=${end}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      container.innerHTML = `<p class="error-msg">${data.message || 'Failed to load summary.'}</p>`;
      return;
    }

    const summary = await res.json();

    if (summary.length === 0) {
      container.innerHTML = '<p class="empty-state">No entries found for this date range.</p>';
      return;
    }

    container.innerHTML = '';
    for (const day of summary) {
      const block = document.createElement('div');
      block.className = 'date-block';

      const heading = document.createElement('h2');
      heading.textContent = day.date;
      block.appendChild(heading);

      for (const p of day.projects) {
        const row = document.createElement('div');
        row.className = 'project-row';
        row.innerHTML = `
          <span class="project-name">${escHtml(p.project)}</span>
          <span class="project-hours">${formatHours(p.hours)}</span>
        `;
        block.appendChild(row);
      }

      container.appendChild(block);
    }
  } catch (_) {
    container.innerHTML = '<p class="error-msg">Network error. Please try again.</p>';
  }
}

function formatHours(hours) {
  const str = hours % 1 === 0 ? String(hours) : String(hours);
  return `${str} hrs`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Auto-load on page open
loadSummary(startInput.value, endInput.value);
