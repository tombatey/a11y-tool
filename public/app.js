let mode = 'crawl';
let pollTimer = null;
let currentJobId = null;
let activeFilters = new Set(['critical', 'serious', 'moderate', 'minor']);
let activeTypes   = 'all'; // 'all' | 'accessibility' | 'html-validation' | 'css'
let activeUrlFilter = null; // null = show all, string = filter to that URL
let pagesVisible  = false;

// Populate header with current user's name
fetch('/api/me')
  .then((r) => { if (r.status === 401) { window.location.href = '/login'; } return r.json(); })
  .then((user) => {
    const el = document.getElementById('headerUser');
    if (el) el.textContent = user.name || user.email;
  })
  .catch(() => {});

// Check for ?rescan= parameter and pre-fill form if present
window.addEventListener('DOMContentLoaded', () => {
  const params   = new URLSearchParams(window.location.search);
  const rescanId = params.get('rescan');
  const forceMode = params.get('mode'); // 'list' = convert crawl to URL list
  if (rescanId) preFillFromScan(rescanId, forceMode);
});

async function preFillFromScan(scanId, forceMode) {
  const [job, pages] = await Promise.all([
    fetch(`/api/scan/${scanId}`).then(r => r.json()).catch(() => null),
    forceMode === 'list'
      ? fetch(`/api/scan/${scanId}/pages`).then(r => r.json()).catch(() => [])
      : Promise.resolve([]),
  ]);
  if (!job) return;

  const input      = job.input || {};
  const opts       = input.options || {};
  const targetMode = forceMode || input.mode || 'crawl';

  // Set mode toggle
  setMode(targetMode);

  if (targetMode === 'crawl') {
    document.getElementById('rootUrl').value  = input.rootUrl || '';
    document.getElementById('maxPages').value = opts.maxPages || 50;
    document.getElementById('maxDepth').value = opts.maxDepth || 3;
  } else {
    // list mode — either original URLs or discovered pages from a crawl
    const urls = forceMode === 'list' && pages.length
      ? pages.map(p => p.url)
      : (input.urls || []);
    document.getElementById('urlList').value = urls.join('\n');
  }

  // WCAG tag checkboxes
  const tags = opts.tags || [];
  document.querySelectorAll('.tag-chip input[type=checkbox][value]').forEach(cb => {
    const checked = tags.includes(cb.value);
    cb.checked = checked;
    cb.closest('.tag-chip').classList.toggle('checked', checked);
  });

  // Validation options
  const setChip = (id, val) => {
    const cb = document.getElementById(id);
    if (!cb) return;
    cb.checked = !!val;
    cb.closest('.tag-chip')?.classList.toggle('checked', !!val);
  };
  setChip('validateHtml',        opts.validateHtml);
  setChip('validateCss',         opts.validateCss);
  setChip('captureScreenshots',  opts.captureScreenshots);

  validateTagSelection();

  // Show banner
  const dateStr = new Date(job.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const modeNote = forceMode === 'list' && input.mode === 'crawl'
    ? ` — using ${pages.length} discovered URLs as a URL list`
    : '';
  document.getElementById('rescanBannerText').textContent =
    `ℹ Pre-filled from scan on ${dateStr}${modeNote}. Review settings then click Start scan.`;
  document.getElementById('rescanBanner').style.display = 'flex';

  // Clean up URL without triggering a reload
  window.history.replaceState({}, '', '/');
}

const modeCrawlBtn = document.getElementById('modeCrawlBtn');
const modeListBtn = document.getElementById('modeListBtn');
const crawlFields = document.getElementById('crawlFields');
const listFields = document.getElementById('listFields');
const startBtn = document.getElementById('startBtn');
const statusLine = document.getElementById('statusLine');
const statusText = document.getElementById('statusText');
const resultsArea = document.getElementById('resultsArea');

// Site login (target-site auth) — show only the fields relevant to the chosen type
const authTypeSelect  = document.getElementById('authType');
const basicAuthFields = document.getElementById('basicAuthFields');
const formAuthFields  = document.getElementById('formAuthFields');
authTypeSelect.addEventListener('change', () => {
  basicAuthFields.style.display = authTypeSelect.value === 'basic' ? 'block' : 'none';
  formAuthFields.style.display  = authTypeSelect.value === 'form'  ? 'block' : 'none';
});

// Builds the `auth` field for the scan request body, or null if not configured
// (and not valid) — never persisted/reused, entered fresh for each scan.
function buildAuthPayload() {
  const type = authTypeSelect.value;
  if (type === 'none') return { auth: null, error: null };

  if (type === 'basic') {
    const username = document.getElementById('basicUsername').value.trim();
    const password = document.getElementById('basicPassword').value;
    if (!username || !password) return { auth: null, error: 'Enter the basic auth username and password, or set Site login back to None.' };
    return { auth: { type: 'basic', basic: { username, password } }, error: null };
  }

  // type === 'form'
  const loginUrl          = document.getElementById('loginUrl').value.trim();
  const usernameSelector  = document.getElementById('usernameSelector').value.trim();
  const passwordSelector  = document.getElementById('passwordSelector').value.trim();
  const submitSelector    = document.getElementById('submitSelector').value.trim();
  const username           = document.getElementById('formUsername').value.trim();
  const password           = document.getElementById('formPassword').value;
  const waitForSelector   = document.getElementById('waitForSelector').value.trim();

  if (!loginUrl || !usernameSelector || !passwordSelector || !submitSelector || !username || !password) {
    return { auth: null, error: 'Fill in the login URL, both field selectors, the submit selector, and the username/password — or set Site login back to None.' };
  }
  return {
    auth: { type: 'form', form: { loginUrl, usernameSelector, passwordSelector, submitSelector, username, password, waitForSelector: waitForSelector || undefined } },
    error: null,
  };
}

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
  // Scoped to #ruleTagsSection so the HTML/CSS validation and screenshot
  // chips (which share .tag-chip styling but aren't WCAG/axe rule tags, and
  // have no `value` attribute) never leak in as a literal "on" tag.
  return Array.from(document.querySelectorAll('#ruleTagsSection input[type=checkbox]:checked'))
    .map((cb) => cb.value);
}

function validateTagSelection() {
  const tags         = getSelectedTags();
  const hasValidator = document.getElementById('validateHtml')?.checked
                    || document.getElementById('validateCss')?.checked;
  const canStart     = tags.length > 0 || hasValidator;
  startBtn.disabled  = !canStart;
  startBtn.title     = canStart ? '' : 'Select at least one WCAG tag or enable HTML/CSS validation.';
}

// Screenshot chip — keep .checked class in sync
const screenshotCheckbox = document.getElementById('captureScreenshots');
screenshotCheckbox.addEventListener('change', () => {
  document.getElementById('screenshotChip').classList.toggle('checked', screenshotCheckbox.checked);
});

// HTML/CSS validation chips
['validateHtml', 'validateCss'].forEach((id) => {
  const cb   = document.getElementById(id);
  const chip = cb.closest('.tag-chip');
  cb.addEventListener('change', () => chip.classList.toggle('checked', cb.checked));
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
  const tags           = getSelectedTags();
  const captureScreenshots = screenshotCheckbox.checked;
  const validateHtml       = document.getElementById('validateHtml').checked;
  const validateCss        = document.getElementById('validateCss').checked;
  const hasValidation      = validateHtml || validateCss;

  if (tags.length === 0 && !hasValidation) {
    return alert('Select at least one WCAG tag, or enable HTML or CSS validation.');
  }

  const { auth, error: authError } = buildAuthPayload();
  if (authError) return alert(authError);

  let body;
  if (mode === 'crawl') {
    const rootUrl  = document.getElementById('rootUrl').value.trim();
    if (!rootUrl) return alert('Enter a site root URL.');
    const maxPages = parseInt(document.getElementById('maxPages').value, 10) || 50;
    const maxDepth = parseInt(document.getElementById('maxDepth').value, 10) || 3;
    body = { mode: 'crawl', rootUrl, options: { maxPages, maxDepth, tags, captureScreenshots, validateHtml, validateCss }, auth };
  } else {
    const raw = document.getElementById('urlList').value.trim();
    if (!raw) return alert('Enter at least one URL.');
    const urls = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    body = { mode: 'list', urls, options: { tags, captureScreenshots, validateHtml, validateCss }, auth };
  }

  startBtn.disabled = true;
  activeFilters   = new Set(['critical', 'serious', 'moderate', 'minor']);
  activeTypes     = 'all';
  activeUrlFilter = null;
  pagesVisible    = false;
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
    case 'authenticating': return 'Logging in…';
    case 'crawling': return `Crawling — ${job.pagesScanned} page(s) scanned so far…`;
    case 'scanning': return `Scanning — ${job.pagesScanned} page(s) scanned, ${job.findings.length} finding(s) so far…`;
    case 'done': return `Done — ${job.pagesScanned} page(s) scanned, ${job.findings.length} finding(s).`;
    case 'stopped': return `Stopped — ${job.pagesScanned} page(s) scanned, ${job.findings.length} finding(s).`;
    case 'error': return `Error — ${job.errors[job.errors.length - 1]?.error || 'unknown error'}`;
    default: return job.status;
  }
}

function renderResults(job) {
  const findingsEmpty = job.findings.length === 0;
  const emptyFindingsMessage = !['done', 'stopped'].includes(job.status)
    ? '<div class="empty">Scan running, no findings yet…</div>'
    : '<div class="empty">No violations found. Nice.</div>';

  // Truly nothing to show yet (no pages visited, no findings) — keep the
  // original single-message empty state. Once at least one page has been
  // scanned, always render the summary/pages-toggle scaffold below, even
  // with zero findings, since "Show pages scanned" is independent of findings.
  if (findingsEmpty && job.pagesScanned === 0) {
    resultsArea.innerHTML = emptyFindingsMessage;
    return;
  }

  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  job.findings.forEach((f) => { if (counts[f.impact] !== undefined) counts[f.impact]++; });

  // Type counts for filter buttons
  const typeCounts = {};
  job.findings.forEach((f) => {
    const t = typeGroup(f.type);
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });
  const hasMultipleTypes = Object.keys(typeCounts).length > 1;

  const typeFilterHtml = hasMultipleTypes ? `
    <div class="type-filters">
      <button class="type-filter-btn ${activeTypes === 'all' ? 'active' : ''}" onclick="setTypeFilter('all')">All (${job.findings.length})</button>
      ${Object.entries(typeCounts).map(([t, n]) =>
        `<button class="type-filter-btn ${activeTypes === t ? 'active' : ''}" onclick="setTypeFilter('${t}')">${typeLabel(t)} (${n})</button>`
      ).join('')}
    </div>` : '';

  const summaryHtml = `
    <div class="summary-grid">
      <div class="summary-card"><div class="num">${job.pagesScanned}</div><div class="label">Pages scanned</div></div>
      <div class="summary-card"><div class="num">${job.findings.length}</div><div class="label">Total findings</div></div>
      ${['critical','serious','moderate','minor'].map(i => `
        <div class="summary-card filter-card" data-filter="${i}" onclick="toggleFilter('${i}')">
          <div class="num">${counts[i] || 0}</div>
          <div class="label">${i.charAt(0).toUpperCase()+i.slice(1)}</div>
          <span class="filter-hint">show only</span>
        </div>`).join('')}
    </div>`;

  const rows = job.findings
    .slice()
    .sort((a, b) => impactRank(b.impact) - impactRank(a.impact))
    .map((f) => `
      <tr data-impact="${f.impact || ''}" data-type="${typeGroup(f.type)}" data-url="${escapeHtml(f.url)}">
        <td><span class="badge ${f.impact}">${f.impact || 'n/a'}</span></td>
        <td><span class="type-badge ${f.type}">${typeLabel(typeGroup(f.type))}</span>${escapeHtml(f.rule_id)}</td>
        <td class="url-cell">${escapeHtml(f.url)}</td>
        <td class="location-cell">${renderLocation(f)}</td>
        <td>${escapeHtml(f.help)}${f.help_url ? ` — <a href="${escapeHtml(f.help_url)}" target="_blank" rel="noopener">details</a>` : ''}${findingTagPills(f)}</td>
      </tr>`).join('');

  const exportBar = `
    <div class="export-bar">
      <a class="export-btn" href="/api/scan/${currentJobId}/export/pdf" target="_blank">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="8" height="12" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M4 5h4M4 7h4M4 9h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        Export PDF
      </a>
      <a class="export-btn" href="/api/scan/${currentJobId}/export/csv" download>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M4 4h6M4 7h6M4 10h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        Export CSV
      </a>
    </div>`;

  const urlFilterBar = activeUrlFilter ? `
    <div class="url-filter-bar">
      Showing findings for: <strong>${escapeHtml(activeUrlFilter)}</strong>
      <button class="url-filter-clear" onclick="clearUrlFilter()">Show all pages</button>
    </div>` : '';

  resultsArea.innerHTML = `
    ${typeFilterHtml}
    ${summaryHtml}
    ${exportBar}
    <div class="pages-toggle">
      <span></span>
      <button class="pages-toggle-btn" id="pagesToggleBtn" onclick="togglePagesPanel('${currentJobId || ''}')">
        ${pagesVisible ? 'Hide pages' : 'Show pages scanned'}
      </button>
    </div>
    <div id="pagesPanel" style="display:${pagesVisible ? 'block' : 'none'}"></div>
    ${urlFilterBar}
    ${findingsEmpty ? emptyFindingsMessage : `
    <table>
      <thead><tr><th>Impact</th><th>Rule</th><th>URL</th><th>Location</th><th>Issue</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`}`;

  syncFilterUI();
  applyFilters();
  if (pagesVisible && currentJobId) loadPagesPanel(currentJobId, 'pagesPanel');
}

async function togglePagesPanel(jobId) {
  pagesVisible = !pagesVisible;
  const panel = document.getElementById('pagesPanel');
  const btn   = document.getElementById('pagesToggleBtn');
  if (!panel || !btn) return;
  panel.style.display = pagesVisible ? 'block' : 'none';
  btn.textContent = pagesVisible ? 'Hide pages' : 'Show pages scanned';
  if (pagesVisible && jobId) await loadPagesPanel(jobId, 'pagesPanel');
}

async function loadPagesPanel(jobId, panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.innerHTML = '<div class="empty" style="padding:12px">Loading pages…</div>';
  const pages = await fetch(`/api/scan/${jobId}/pages`).then(r => r.json()).catch(() => []);
  if (!pages.length) {
    panel.innerHTML = '<div class="empty" style="padding:12px">No pages recorded.</div>';
    return;
  }
  const rows = pages.map(p => {
    const sc = p;
    const sevHtml = (sc.findings_count === 0)
      ? '<span class="ps none">No findings</span>'
      : [
          sc.critical_count ? `<span class="ps critical">●&nbsp;${sc.critical_count} critical</span>` : '',
          sc.serious_count  ? `<span class="ps serious">●&nbsp;${sc.serious_count} serious</span>`   : '',
          sc.moderate_count ? `<span class="ps moderate">●&nbsp;${sc.moderate_count} moderate</span>` : '',
          sc.minor_count    ? `<span class="ps minor">●&nbsp;${sc.minor_count} minor</span>`          : '',
        ].filter(Boolean).join('');
    const isActive = activeUrlFilter === p.url;
    return `<tr data-url="${escapeHtml(p.url)}" class="${isActive ? 'active' : ''}" onclick="setUrlFilter('${escapeHtml(p.url)}', '${jobId}', '${panelId}')">
      <td class="page-url">${escapeHtml(p.url)}</td>
      <td><div class="page-sev">${sevHtml}</div></td>
    </tr>`;
  }).join('');
  panel.innerHTML = `<div class="pages-panel">
    <table>
      <thead><tr><th>URL (${pages.length})</th><th>Findings</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function setUrlFilter(url, jobId, panelId) {
  activeUrlFilter = activeUrlFilter === url ? null : url;
  // Refresh panel to update active row
  loadPagesPanel(jobId, panelId);
  applyFilters();
  // Show/hide url filter bar
  const bar = document.querySelector('.url-filter-bar');
  if (bar) bar.remove();
  if (activeUrlFilter) {
    const barHtml = document.createElement('div');
    barHtml.className = 'url-filter-bar';
    barHtml.innerHTML = `Showing findings for: <strong>${escapeHtml(activeUrlFilter)}</strong>
      <button class="url-filter-clear" onclick="clearUrlFilter()">Show all pages</button>`;
    const table = document.querySelector('tbody')?.closest('table');
    if (table) table.before(barHtml);
  }
}

function clearUrlFilter() {
  activeUrlFilter = null;
  document.querySelector('.url-filter-bar')?.remove();
  document.querySelectorAll('.pages-panel tr[data-url]').forEach(r => r.classList.remove('active'));
  applyFilters();
}

function typeGroup(type) {
  if (!type || type === 'accessibility') return 'accessibility';
  if (type === 'html-validation') return 'html-validation';
  return 'css';
}

function typeLabel(group) {
  return { accessibility: 'A11Y', 'html-validation': 'HTML', css: 'CSS' }[group] || group.toUpperCase();
}

// Known WCAG level/category tags a finding's wcag_tags might carry — deliberately
// excludes granular criterion-specific tags (e.g. "wcag143") which aren't useful
// as a compact per-issue label.
const WCAG_TAG_LABELS = {
  wcag2a:          'WCAG 2.0 A',
  wcag2aa:         'WCAG 2.0 AA',
  wcag21aa:        'WCAG 2.1 AA',
  wcag22aa:        'WCAG 2.2 AA',
  wcag2aaa:        'WCAG 2.0 AAA',
  'best-practice': 'Best Practice',
  experimental:    'Experimental',
};

function findingTagPills(f) {
  if (!f.wcag_tags || !f.wcag_tags.length) return '';
  const known = f.wcag_tags.filter((t) => WCAG_TAG_LABELS[t]);
  if (!known.length) return '';
  return `<div class="finding-tags">${known.map((t) =>
    `<span class="finding-tag-pill">${escapeHtml(WCAG_TAG_LABELS[t])}</span>`
  ).join('')}</div>`;
}

function setTypeFilter(type) {
  activeTypes = type;
  document.querySelectorAll('.type-filter-btn').forEach((btn) => {
    const btnType = btn.getAttribute('onclick').match(/setTypeFilter\('(.+?)'\)/)?.[1];
    btn.classList.toggle('active', btnType === type);
  });
  applyFilters();
  updateSummaryCounts();
}

// Recomputes the Critical/Serious/Moderate/Minor summary numbers from the
// rows currently in the DOM, scoped to the active type filter — the severity
// toggle (activeFilters) is a display lens on top of these numbers, not a
// second filter that should shrink them, so it's deliberately not consulted here.
function updateSummaryCounts() {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  document.querySelectorAll('tbody tr[data-impact]').forEach((row) => {
    const typeMatch = activeTypes === 'all' || row.dataset.type === activeTypes;
    if (typeMatch && counts[row.dataset.impact] !== undefined) counts[row.dataset.impact]++;
  });
  ['critical', 'serious', 'moderate', 'minor'].forEach((i) => {
    const el = document.querySelector(`.summary-card[data-filter="${i}"] .num`);
    if (el) el.textContent = counts[i] || 0;
  });
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
    const impactMatch = activeFilters.has(row.dataset.impact);
    const typeMatch   = activeTypes === 'all' || row.dataset.type === activeTypes;
    const urlMatch    = !activeUrlFilter || row.dataset.url === activeUrlFilter;
    row.style.display = (impactMatch && typeMatch && urlMatch) ? '' : 'none';
  });
}

function truncateSeg(seg, max = 22) {
  return seg.length > max ? seg.slice(0, max - 1) + '…' : seg;
}

function renderLocation(f) {
  // Location (screenshot/breadcrumb/on-page position) is an accessibility-only
  // concept — HTML/CSS findings don't have anything meaningful to show here.
  // typeGroup() matches the same "missing type = accessibility" fallback used
  // elsewhere in this file (row data-type, type badge).
  if (typeGroup(f.type) !== 'accessibility') return '';

  const loc = f.location;
  let html = '';

  // Accessibility findings: screenshot, breadcrumb, DOM position
  if (loc && loc.screenshot) {
    html += `<img class="loc-thumb" src="${loc.screenshot}" alt="Element screenshot" onclick="openLightbox('${loc.screenshot}')" />`;
  }

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
