// src/changelogPage.js
// Server-renders the public /changelog page as a self-contained HTML string,
// mirroring how src/report.js builds HTML — no templating engine, no build step.

const { readChangelog } = require('./changelog');

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function generateChangelogHtml() {
  let releases = [];
  let hadError = false;
  try {
    releases = readChangelog();
  } catch (err) {
    hadError = true;
  }

  const body = hadError || releases.length === 0
    ? '<div class="empty">Changelog is currently unavailable.</div>'
    : releases.map((r) => `
      <section class="release">
        <h2><span class="version">v${escHtml(r.version)}</span>
          <span class="date">${escHtml(formatDate(r.date))}</span></h2>
        ${r.notes.length
          ? `<ul>${r.notes.map((n) => `<li>${escHtml(n)}</li>`).join('')}</ul>`
          : '<p class="no-notes">No release notes recorded for this version.</p>'}
      </section>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Changelog — A11y Scanner</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --ink: #014357; --body: #334155; --paper: #F8FAFC;
    --line: #E2E8F0; --muted: #64748B; --accent: #017CA1;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    background: var(--paper);
    color: var(--body);
  }
  header { padding: 32px 32px 24px; border-bottom: 1px solid var(--line); }
  header h1 { margin: 0 0 4px; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--ink); }
  header p { margin: 0; color: var(--muted); font-size: 13px; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 32px 80px; }
  .release {
    background: #fff; border: 1px solid var(--line); border-radius: 10px;
    padding: 20px 24px; margin-bottom: 16px;
  }
  .release h2 {
    margin: 0 0 12px; font-size: 15px; font-weight: 700;
    display: flex; align-items: baseline; gap: 10px;
  }
  .version { color: var(--ink); }
  .date { color: var(--muted); font-weight: 400; font-size: 12px; }
  .release ul { margin: 0; padding-left: 18px; font-size: 13px; }
  .release li { margin-bottom: 4px; }
  .no-notes { margin: 0; font-size: 13px; color: var(--muted); font-style: italic; }
  .empty { color: var(--muted); font-size: 13px; padding: 24px; }
  a.back { display: inline-block; margin-top: 8px; font-size: 13px; color: var(--accent); text-decoration: none; }
  a.back:hover { text-decoration: underline; }
</style>
</head>
<body>
<header>
  <h1>Changelog</h1>
  <p>Release history for the WebDepend Accessibility Scanner</p>
</header>
<main>
  ${body}
  <a class="back" href="/">&larr; Back to scanner</a>
</main>
</body>
</html>`;
}

module.exports = { generateChangelogHtml };
