/**
 * HTML validator using the W3C Nu HTML Checker (vnu.jar).
 * vnu runs as a local HTTP server on VNU_URL (default: http://localhost:8888).
 * Accepts rendered HTML from Playwright and returns normalized findings.
 */

const VNU_URL = process.env.VNU_URL || 'http://localhost:8888';
const TIMEOUT  = 20000; // ms

// vnu severity → our impact level
const IMPACT_MAP = { error: 'serious', warning: 'minor', info: 'minor' };

async function validateHtml(html, pageUrl) {
  let data;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    const res = await fetch(`${VNU_URL}/?out=json`, {
      method:  'POST',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body:    html,
      signal:  controller.signal,
    });
    clearTimeout(timer);
    data = await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('vnu timeout for', pageUrl);
    } else {
      console.warn('vnu unavailable:', err.message);
    }
    return [];
  }

  return (data.messages || [])
    .filter((m) => m.type !== 'info')
    .map((m) => ({
      type:            'html-validation',
      source_tool:     'vnu',
      rule_id:         slugify(m.message),
      wcag_tags:       [],
      impact:          IMPACT_MAP[m.type] || 'minor',
      description:     m.message,
      help:            m.message,
      help_url:        'https://validator.w3.org/nu/',
      url:             pageUrl,
      target_selector: null,
      breadcrumb:      [],
      html_snippet:    m.extract || null,
      failure_summary: m.lastLine ? `Line ${m.lastLine}, Col ${m.lastColumn ?? '?'}` : null,
      location:        { line: m.lastLine || null, column: m.lastColumn || null },
      screenshot_path: null,
    }));
}

// Derive a short rule_id from the message text (first ~40 chars, slugified)
function slugify(msg) {
  return msg
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

module.exports = { validateHtml };
