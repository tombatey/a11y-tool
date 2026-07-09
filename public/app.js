let mode = 'crawl';
let pollTimer = null;
let currentJobId = null;
let activeFilters = new Set(['critical', 'serious', 'moderate', 'minor']);

// Populate header with current user's name
fetch('/api/me')
  .then((r) => { if (r.status === 401) { window.location.href = '/login'; } return r.json(); })
  .then((user) => {
    const el = document.getElementById('headerUser');
    if (el) el.textContent = user.name || user.email;
  })
  .catch(() => {});

const modeCrawlBtn = document.getElementById('modeCrawlBtn');
const modeListBtn = document.getElementById('modeListBtn');
const crawlFields = document.getElementById('crawlFields');
const listFields = document.getElementById('listFields');
const startBtn = document.getElementById('startBtn');
const statusLine = document.getElementById('statusLine');
const statusText = document.getElementById('statusText');
const resultsArea = document.getElementById('resultsArea');

modeCrawlBtn.addEventListener('click', () => setMode('crawl'));
modeListBtn.addEventListener('click', () => setMode('list'));

function setMode(m) {
  mode = m;
  modeCrawlBtn.classList.toggle('active', m === 'crawl');
  modeListBtn.classList.toggle('active', m === 'list');
  crawlFields.style.display = m === 'crawl' ? 'block' : 'none';
  listFields.style.display = m === 'list' ? 'block' : 'none';
}

// Tag chip toggle — keep .checked class in sync with the checkbox state
document.querySelectorAll('.tag-chip input[type=checkbox]').forEach((checkbox) => {
  checkbox.addEventListener('change', () => {
    checkbox.closest('.tag-chip').classList.toggle('checked', checkbox.checked);
    validateTagSelection();
  });
});

function getSelectedTags() {
  return Array.from(document.querySelectorAll('.tag-chip input[type=checkbox]:checked'))
    .map((cb) => cb.value);
}

function validateTagSelection() {
  const tags = getSelectedTags();
  startBtn.disabled = tags.length === 0;
  startBtn.title = tags.length === 0 ? 'Select at least one tag to scan against.' : '';
}

// Screenshot chip — keep .checked class in sync
const screenshotCheckbox = document.getElementById('captureScreenshots');
screenshotCheckbox.addEventListener('change', () => {
  document.getElementById('screenshotChip').classList.toggle('checked', screenshotCheckbox.checked);
});

// Auto-tick screenshots when switching to list mode (fewer pages, more detail makes sense)
modeCrawlBtn.addEventListener('click', () => {
  if (screenshotCheckbox.checked) {
    screenshotCheckbox.checked = false;
    document.getElementById('screenshotChip').classList.remove('checked');
  }
});
modeListBtn.addEventListener('click', () => {
  if (!screenshotCheckbox.checked) {
    screenshotCheckbox.checked = true;
    document.getElementById('screenshotChip').classList.add('checked');
  }
});

startBtn.addEventListener('click', startScan);

async function startScan() {
  const tags = getSelectedTags();
  if (tags.length === 0) return alert('Select at least one tag to scan against.');

  const captureScreenshots = screenshotCheckbox.checked;

  let body;
  if (mode === 'crawl') {
    const rootUrl = document.getElementById('rootUrl').value.trim();
    if (!rootUrl) return alert('Enter a site root URL.');
    const maxPages = parseInt(document.getElementById('maxPages').value, 10) || 50;
    const maxDepth = parseInt(document.getElementById('maxDepth').value, 10) || 3;
    body = { mode: 'crawl', rootUrl, options: { maxPages, maxDepth, tags, captureScreenshots } };
  } else {
    const raw = document.getElementById('urlList').value.trim();
    if (!raw) return alert('Enter at least one URL.');
    const urls = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    body = { mode: 'list', urls, options: { tags, captureScreenshots } };
  }

  startBtn.disabled = true;
  activeFilters = new Set(['critical', 'serious', 'moderate', 'minor']);
  statusLine.style.display = 'flex';
  statusText.textContent = 'Starting…';
  resultsArea.innerHTML = '<div class="empty">Scan running…</div>';

  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    statusText.textContent = `Failed to start: ${err.error || res.statusText}`;
    startBtn.disabled = false;
    return;
  }

  const { jobId } = await res.json();
  currentJobId = jobId;
  document.getElementById('stopBtn').style.display = 'inline-block';
  pollJob(jobId);
}

function pollJob(jobId) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const res = await fetch(`/api/scan/${jobId}`);
    if (!res.ok) return;
    const job = await res.json();
    renderJob(job);
    if (['done', 'stopped', 'error'].includes(job.status)) {
      clearInterval(pollTimer);
      startBtn.disabled = false;
      document.getElementById('stopBtn').style.display = 'none';
    }
  }, 1500);
}

async function stopScan() {
  if (!currentJobId) return;
  const btn = document.getElementById('stopBtn');
  btn.disabled = true;
  btn.textContent = 'Stopping…';
  await fetch(`/api/scan/${currentJobId}/stop`, { method: 'POST' }).catch(() => {});
}

function renderJob(job) {
  statusText.textContent = describeStatus(job);
  renderResults(job);
}

function describeStatus(job) {
  switch (job.status) {
    case 'queued': return 'Queued…';
    case 'crawling': return `Crawling — ${job.pagesScanned} page(s) scanned so far…`;
    case 'scanning': return `Scanning — ${job.pagesScanned} page(s) scanned, ${job.findings.length} finding(s) so far…`;
    case 'done': return `Done — ${job.pagesScanned} page(s) scanned, ${job.findings.length} finding(s).`;
    case 'stopped': return `Stopped — ${job.pagesScanned} page(s) scanned, ${job.findings.length} finding(s).`;
    case 'error': return `Error — ${job.errors[job.errors.length - 1]?.error || 'unknown error'}`;
    default: return job.status;
  }
}

function renderResults(job) {
  if (job.findings.length === 0 && !['done', 'stopped'].includes(job.status)) {
    resultsArea.innerHTML = '<div class="empty">Scan running, no findings yet…</div>';
    return;
  }
  if (job.findings.length === 0 && ['done', 'stopped'].includes(job.status)) {
    resultsArea.innerHTML = '<div class="empty">No accessibility violations found. Nice.</div>';
    return;
  }

  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  job.findings.forEach((f) => { if (counts[f.impact] !== undefined) counts[f.impact]++; });

  const summaryHtml = `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="num">${job.pagesScanned}</div>
        <div class="label">Pages scanned</div>
      </div>
      <div class="summary-card">
        <div class="num">${job.findings.length}</div>
        <div class="label">Total findings</div>
      </div>
      <div class="summary-card filter-card" data-filter="critical" onclick="toggleFilter('critical')">
        <div class="num">${counts.critical}</div>
        <div class="label">Critical</div>
        <span class="filter-hint">show only</span>
      </div>
      <div class="summary-card filter-card" data-filter="serious" onclick="toggleFilter('serious')">
        <div class="num">${counts.serious}</div>
        <div class="label">Serious</div>
        <span class="filter-hint">show only</span>
      </div>
      <div class="summary-card filter-card" data-filter="moderate" onclick="toggleFilter('moderate')">
        <div class="num">${counts.moderate}</div>
        <div class="label">Moderate</div>
        <span class="filter-hint">show only</span>
      </div>
      <div class="summary-card filter-card" data-filter="minor" onclick="toggleFilter('minor')">
        <div class="num">${counts.minor}</div>
        <div class="label">Minor</div>
        <span class="filter-hint">show only</span>
      </div>
    </div>
  `;

  const rows = job.findings
    .slice()
    .sort((a, b) => impactRank(b.impact) - impactRank(a.impact))
    .map((f) => `
      <tr data-impact="${f.impact || ''}">
        <td><span class="badge ${f.impact}">${f.impact || 'n/a'}</span></td>
        <td>${escapeHtml(f.rule_id)}</td>
        <td class="url-cell">${escapeHtml(f.url)}</td>
        <td class="location-cell">${renderLocation(f)}</td>
        <td>${escapeHtml(f.help)} — <a href="${f.help_url}" target="_blank" rel="noopener">details</a></td>
      </tr>
    `).join('');

  resultsArea.innerHTML = `
    ${summaryHtml}
    <table>
      <thead>
        <tr><th>Impact</th><th>Rule</th><th>URL</th><th>Location</th><th>Issue</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  // Restore filter state after re-render (polling replaces innerHTML each tick)
  syncFilterUI();
  applyFilters();
}

function toggleFilter(impact) {
  const allImpacts = ['critical', 'serious', 'moderate', 'minor'];
  const allActive = allImpacts.every((i) => activeFilters.has(i));
  const onlyThisActive = activeFilters.size === 1 && activeFilters.has(impact);

  if (allActive) {
    // Isolate to just this severity
    activeFilters = new Set([impact]);
  } else if (onlyThisActive) {
    // Already isolated here — reset to show all
    activeFilters = new Set(allImpacts);
  } else {
    // A subset is active — toggle this one in/out of that subset
    if (activeFilters.has(impact)) {
      activeFilters.delete(impact);
      if (activeFilters.size === 0) activeFilters = new Set(allImpacts); // never go fully empty
    } else {
      activeFilters.add(impact);
    }
  }
  syncFilterUI();
  applyFilters();
}

function syncFilterUI() {
  document.querySelectorAll('.filter-card[data-filter]').forEach((card) => {
    card.classList.toggle('inactive', !activeFilters.has(card.dataset.filter));
  });
}

function applyFilters() {
  document.querySelectorAll('tbody tr[data-impact]').forEach((row) => {
    row.style.display = activeFilters.has(row.dataset.impact) ? '' : 'none';
  });
}

function truncateSeg(seg, max = 22) {
  return seg.length > max ? seg.slice(0, max - 1) + '…' : seg;
}

function renderLocation(f) {
  const loc = f.location;
  let html = '';

  // Screenshot thumbnail
  if (loc && loc.screenshot) {
    html += `<img class="loc-thumb" src="${loc.screenshot}" alt="Element screenshot" onclick="openLightbox('${loc.screenshot}')" />`;
  }

  // Breadcrumb — last 4 segments, each truncated to prevent overflow
  if (f.breadcrumb && f.breadcrumb.length > 0) {
    const crumbs = f.breadcrumb;
    const display = crumbs.length > 4 ? ['…', ...crumbs.slice(-3)] : crumbs;
    const parts = display.map((seg, i) => {
      const isTarget = i === display.length - 1;
      const label = seg === '…' ? seg : escapeHtml(truncateSeg(seg));
      return `<span class="seg${isTarget ? ' target' : ''}" title="${escapeHtml(seg)}">${label}</span>`;
    });
    html += `<div class="loc-breadcrumb">${parts.join('<span class="arrow">›</span>')}</div>`;
  } else {
    const raw = truncateSeg(f.target_selector || '', 30);
    html += `<div class="loc-breadcrumb"><span class="seg target" title="${escapeHtml(f.target_selector)}">${escapeHtml(raw)}</span></div>`;
  }

  // Position info
  if (loc && loc.position) {
    const p = loc.position;
    const foldLabel = p.aboveFold
      ? '<span class="fold-badge">Above fold</span>'
      : '<span class="fold-badge below">Below fold</span>';
    html += `<div class="loc-position">${foldLabel} ${p.percentDown}% down</div>`;
  }

  return html;
}

function impactRank(impact) {
  return { critical: 4, serious: 3, moderate: 2, minor: 1 }[impact] || 0;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.add('open');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lightboxImg').src = '';
}
