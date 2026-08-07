/**
 * CSS validator — two checks run in parallel per stylesheet:
 *   1. W3C CSS Validator API  (spec compliance)
 *   2. stylelint              (best practices / code quality)
 *
 * Playwright is used to extract stylesheet URLs and inline <style> blocks
 * from the already-loaded page, then the CSS content is fetched/read and
 * passed to both checkers.
 */

const stylelint       = require('stylelint');
const W3C_CSS_API     = 'https://jigsaw.w3.org/css-validator/validator';
const W3C_TIMEOUT_MS  = 15000;
const FETCH_TIMEOUT_MS = 10000;

// Maximum findings reported per stylesheet — prevents one noisy file from
// dominating results. The most impactful issues sort to the top naturally
// since errors come before warnings.
const MAX_FINDINGS_PER_SHEET = 50;

// ─── Extract CSS from the page ────────────────────────────────────────────────

async function extractStylesheets(page, pageUrl) {
  // External <link rel="stylesheet"> hrefs
  const externalUrls = await page.$$eval(
    'link[rel="stylesheet"][href]',
    (els) => els.map((el) => el.href).filter(Boolean)
  ).catch(() => []);

  // Inline <style> blocks
  const inlineContents = await page.$$eval(
    'style',
    (els) => els.map((el) => el.textContent || '')
  ).catch(() => []);

  // Fetch external stylesheet content via the page's own request context
  // (page.request) rather than a bare global fetch — this shares the
  // browser context's cookies/httpCredentials, so stylesheets on
  // password-protected pages (basic auth or form-login sessions) are
  // fetched authenticated instead of 401ing.
  const external = await Promise.all(
    externalUrls.map(async (url) => {
      try {
        const res     = await page.request.get(url, { timeout: FETCH_TIMEOUT_MS });
        const content = await res.text();
        return { url, content };
      } catch {
        return null;
      }
    })
  );

  const inline = inlineContents
    .filter((c) => c.trim())
    .map((content, i) => ({ url: `${pageUrl}#inline-style-${i + 1}`, content }));

  return [...external.filter(Boolean), ...inline];
}

// ─── W3C CSS Validator ────────────────────────────────────────────────────────

async function w3cValidate(cssContent, sourceUrl) {
  try {
    const body = new URLSearchParams({
      text:    cssContent,
      output:  'json',
      profile: 'css3',
      warning: '2',
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), W3C_TIMEOUT_MS);

    const res  = await fetch(W3C_CSS_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
      signal:  controller.signal,
    });
    const data = await res.json();
    const v    = data?.cssvalidation;
    if (!v) return [];

    const findings = [];

    for (const err of v.errors || []) {
      findings.push({
        type:            'css-validation',
        source_tool:     'w3c-css',
        rule_id:         err.errorsubtype || err.errortype || 'css-error',
        wcag_tags:       [],
        impact:          'moderate',
        description:     err.message?.trim() || 'CSS error',
        help:            err.message?.trim() || 'CSS error',
        help_url:        'https://jigsaw.w3.org/css-validator/',
        url:             sourceUrl,
        target_selector: err.context || null,
        breadcrumb:      [],
        html_snippet:    null,
        failure_summary: `Line ${err.line}`,
        location:        { line: err.line || null, column: null },
        screenshot_path: null,
      });
    }

    for (const warn of v.warnings || []) {
      findings.push({
        type:            'css-validation',
        source_tool:     'w3c-css',
        rule_id:         'css-warning',
        wcag_tags:       [],
        impact:          'minor',
        description:     warn.message?.trim() || 'CSS warning',
        help:            warn.message?.trim() || 'CSS warning',
        help_url:        'https://jigsaw.w3.org/css-validator/',
        url:             sourceUrl,
        target_selector: null,
        breadcrumb:      [],
        html_snippet:    null,
        failure_summary: `Line ${warn.line}`,
        location:        { line: warn.line || null, column: null },
        screenshot_path: null,
      });
    }

    return findings;
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn('W3C CSS API error:', err.message);
    }
    return [];
  }
}

// ─── stylelint ────────────────────────────────────────────────────────────────

async function lintCss(cssContent, sourceUrl) {
  try {
    const result = await stylelint.lint({
      code:   cssContent,
      config: { extends: ['stylelint-config-standard'] },
    });

    return result.results.flatMap((r) =>
      r.warnings.map((w) => ({
        type:            'css-lint',
        source_tool:     'stylelint',
        rule_id:         w.rule,
        wcag_tags:       [],
        impact:          w.severity === 'error' ? 'moderate' : 'minor',
        description:     w.text,
        help:            w.text,
        help_url:        `https://stylelint.io/user-guide/rules/${w.rule}`,
        url:             sourceUrl,
        target_selector: null,
        breadcrumb:      [],
        html_snippet:    null,
        failure_summary: `Line ${w.line}, Col ${w.column}`,
        location:        { line: w.line || null, column: w.column || null },
        screenshot_path: null,
      }))
    );
  } catch (err) {
    console.warn('stylelint error:', err.message);
    return [];
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────
// seenUrls: a Set shared across pages in a scan — stylesheets already validated
// are skipped so shared assets (main.css, bootstrap.css etc.) are only checked once.

async function validateCss(page, pageUrl, seenUrls = new Set()) {
  const stylesheets = await extractStylesheets(page, pageUrl);
  if (!stylesheets.length) return [];

  const results = await Promise.all(
    stylesheets.map(async ({ url, content }) => {
      if (!content.trim()) return [];

      // Skip if this stylesheet URL was already validated earlier in this scan
      if (seenUrls.has(url)) return [];
      seenUrls.add(url);

      const [w3c, lint] = await Promise.all([
        w3cValidate(content, url),
        lintCss(content, url),
      ]);

      const combined = [...w3c, ...lint];
      // Cap per stylesheet — errors first (they're inserted before warnings above)
      return combined.slice(0, MAX_FINDINGS_PER_SHEET);
    })
  );

  return results.flat();
}

module.exports = { validateCss };
