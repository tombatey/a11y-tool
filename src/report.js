/**
 * Generates a self-contained HTML report for PDF rendering via Playwright.
 * All CSS is inline and the logo is embedded as base64 so no external
 * resources are needed during headless rendering.
 */

const fs   = require('fs');
const path = require('path');

const LOGO_PATH = path.join(__dirname, '..', 'public', 'images', 'webdepend-logo.png');

function logoDataUrl() {
  try {
    return 'data:image/png;base64,' + fs.readFileSync(LOGO_PATH).toString('base64');
  } catch {
    return '';
  }
}

const IMPACT_COLOUR = {
  critical: '#8c2f2f',
  serious:  '#b5611c',
  moderate: '#8a7a1e',
  minor:    '#5b6470',
};

const TYPE_LABEL = {
  'accessibility':  'A11Y',
  'html-validation': 'HTML',
  'css-validation': 'CSS',
  'css-lint':       'CSS',
};

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function impactBadge(impact) {
  const colour = IMPACT_COLOUR[impact] || '#666';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;color:#fff;background:${colour};text-transform:uppercase">${escHtml(impact || 'n/a')}</span>`;
}

function typeBadge(type) {
  const label = TYPE_LABEL[type] || 'OTHER';
  const colours = {
    'A11Y': { bg: '#e1f5ee', fg: '#0f6e56' },
    'HTML': { bg: '#e6f1fb', fg: '#185fa5' },
    'CSS':  { bg: '#f3e6fb', fg: '#6418a5' },
  };
  const c = colours[label] || { bg: '#f0f0f0', fg: '#333' };
  return `<span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;background:${c.bg};color:${c.fg}">${label}</span>`;
}

function summaryCounts(findings) {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const types  = { accessibility: 0, 'html-validation': 0, css: 0 };
  findings.forEach(f => {
    if (counts[f.impact] !== undefined) counts[f.impact]++;
    const tg = (!f.type || f.type === 'accessibility') ? 'accessibility'
             : f.type === 'html-validation' ? 'html-validation' : 'css';
    types[tg]++;
  });
  return { counts, types };
}

function locationText(f) {
  if (f.location?.line) {
    return f.location.column
      ? `Line ${f.location.line}, Col ${f.location.column}`
      : `Line ${f.location.line}`;
  }
  if (f.breadcrumb?.length) {
    return f.breadcrumb.slice(-3).join(' › ');
  }
  return f.target_selector || '';
}

function generateReportHtml(job, pages = []) {
  const logo         = logoDataUrl();
  const date         = formatDate(job.createdAt);
  const input        = job.input || {};
  const target       = input.mode === 'crawl'
    ? input.rootUrl
    : `URL list (${(input.urls || []).length} URL${(input.urls||[]).length === 1 ? '' : 's'})`;
  const tags         = (input.options?.tags || []).join(', ') || 'None selected';
  const findings     = job.findings || [];
  const { counts, types } = summaryCounts(findings);

  // Sort findings: critical → serious → moderate → minor
  const rank = { critical: 4, serious: 3, moderate: 2, minor: 1 };
  const sorted = findings.slice().sort((a, b) => (rank[b.impact] || 0) - (rank[a.impact] || 0));

  const findingRows = sorted.map(f => `
    <tr>
      <td style="white-space:nowrap">${impactBadge(f.impact)}</td>
      <td>${typeBadge(f.type)}</td>
      <td style="font-size:11px;color:#2f5d50;word-break:break-all;max-width:200px">${escHtml(f.url)}</td>
      <td style="font-size:11px;font-family:monospace;color:#444">${escHtml(f.rule_id || '')}</td>
      <td style="font-size:11px">${escHtml(f.help || f.description || '')}</td>
      <td style="font-size:11px;color:#666;white-space:nowrap">${escHtml(locationText(f))}</td>
    </tr>`).join('');

  const pageRows = pages.map(p => {
    const sevParts = [
      p.critical_count ? `<span style="color:#8c2f2f;font-weight:600">${p.critical_count} critical</span>` : '',
      p.serious_count  ? `<span style="color:#b5611c;font-weight:600">${p.serious_count} serious</span>`   : '',
      p.moderate_count ? `<span style="color:#8a7a1e;font-weight:600">${p.moderate_count} moderate</span>` : '',
      p.minor_count    ? `<span style="color:#5b6470;font-weight:600">${p.minor_count} minor</span>`       : '',
    ].filter(Boolean).join(', ') || '<span style="color:#ccc">None</span>';
    return `<tr>
      <td style="font-size:11px;color:#2f5d50;word-break:break-all">${escHtml(p.url)}</td>
      <td style="font-size:11px">${sevParts}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>WebDepend Accessibility Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #16191c; font-size: 12px; line-height: 1.5; }
  h1 { font-size: 22px; font-weight: 700; color: #16191c; }
  h2 { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8CC63F; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #8CC63F; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 7px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b6f73; border-bottom: 1px solid #e2e1dc; background: #fafaf8; }
  td { padding: 7px 8px; border-bottom: 1px solid #e2e1dc; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .section { margin-bottom: 28px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 24px; }
  .meta-item .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b6f73; }
  .meta-item .value { font-size: 13px; font-weight: 500; }
  .stat-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 24px; }
  .stat { border: 1px solid #e2e1dc; border-radius: 8px; padding: 10px; text-align: center; }
  .stat .num { font-size: 22px; font-weight: 700; }
  .stat .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b6f73; }
  .stat.critical .num { color: #8c2f2f; }
  .stat.serious  .num { color: #b5611c; }
  .stat.moderate .num { color: #8a7a1e; }
  .stat.minor    .num { color: #5b6470; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e1dc; color: #6b6f73; font-size: 10px; display: flex; justify-content: space-between; }
  @media print {
    body { font-size: 11px; }
    .section { page-break-inside: avoid; }
    tr { page-break-inside: avoid; }
    .findings-section { page-break-before: always; }
  }
</style>
</head>
<body style="padding: 32px 36px">

<!-- Header -->
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;padding-bottom:20px;border-bottom:3px solid #8CC63F">
  ${logo ? `<img src="${logo}" style="height:40px;width:auto" alt="WebDepend"/>` : '<strong style="font-size:20px;color:#00AEEF">Web<span style="color:#8CC63F">Depend</span></strong>'}
  <div style="text-align:right">
    <div style="font-size:18px;font-weight:700;color:#16191c">Accessibility Report</div>
    <div style="font-size:12px;color:#6b6f73">${escHtml(date)}</div>
  </div>
</div>

<!-- Scan metadata -->
<div class="section">
  <h2>Scan Details</h2>
  <div class="meta-grid">
    <div class="meta-item"><div class="label">Target</div><div class="value">${escHtml(target)}</div></div>
    <div class="meta-item"><div class="label">Date</div><div class="value">${escHtml(date)}</div></div>
    <div class="meta-item"><div class="label">Pages scanned</div><div class="value">${job.pagesScanned}</div></div>
    <div class="meta-item"><div class="label">WCAG tags</div><div class="value">${escHtml(tags)}</div></div>
    <div class="meta-item"><div class="label">Total findings</div><div class="value">${findings.length}</div></div>
    <div class="meta-item"><div class="label">Status</div><div class="value">${escHtml(job.status)}</div></div>
  </div>
</div>

<!-- Summary stats -->
<div class="section">
  <h2>Summary</h2>
  <div class="stat-grid">
    <div class="stat"><div class="num">${findings.length}</div><div class="lbl">Total</div></div>
    <div class="stat critical"><div class="num">${counts.critical}</div><div class="lbl">Critical</div></div>
    <div class="stat serious"><div class="num">${counts.serious}</div><div class="lbl">Serious</div></div>
    <div class="stat moderate"><div class="num">${counts.moderate}</div><div class="lbl">Moderate</div></div>
    <div class="stat minor"><div class="num">${counts.minor}</div><div class="lbl">Minor</div></div>
    <div class="stat"><div class="num">${job.pagesScanned}</div><div class="lbl">Pages</div></div>
  </div>
  ${types.accessibility || types['html-validation'] || types.css ? `
  <table style="width:auto">
    <thead><tr><th>Check type</th><th>Findings</th></tr></thead>
    <tbody>
      ${types.accessibility    ? `<tr><td>Accessibility (axe-core)</td><td>${types.accessibility}</td></tr>` : ''}
      ${types['html-validation'] ? `<tr><td>HTML validation (W3C Nu)</td><td>${types['html-validation']}</td></tr>` : ''}
      ${types.css             ? `<tr><td>CSS validation / linting</td><td>${types.css}</td></tr>` : ''}
    </tbody>
  </table>` : ''}
</div>

${pages.length ? `
<!-- Pages scanned -->
<div class="section">
  <h2>Pages Scanned (${pages.length})</h2>
  <table>
    <thead><tr><th>URL</th><th>Findings</th></tr></thead>
    <tbody>${pageRows}</tbody>
  </table>
</div>` : ''}

<!-- Findings -->
<div class="section findings-section">
  <h2>Findings (${findings.length})</h2>
  ${findings.length === 0
    ? '<p style="color:#6b6f73">No findings — well done!</p>'
    : `<table>
        <thead>
          <tr>
            <th style="width:80px">Impact</th>
            <th style="width:50px">Type</th>
            <th>URL</th>
            <th style="width:140px">Rule</th>
            <th>Issue</th>
            <th style="width:110px">Location</th>
          </tr>
        </thead>
        <tbody>${findingRows}</tbody>
      </table>`}
</div>

<!-- Footer -->
<div class="footer">
  <span>Generated by WebDepend Accessibility Scanner</span>
  <span>${escHtml(date)}</span>
</div>

</body>
</html>`;
}

module.exports = { generateReportHtml };
