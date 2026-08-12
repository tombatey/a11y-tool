const { AxeBuilder } = require('@axe-core/playwright');

/**
 * Build a human-readable breadcrumb array from axe's target selector.
 * axe returns target as an array of CSS selector strings:
 *   - Simple: ["button.primary > span"]
 *   - Iframe: ["iframe#widget", ".inner-button"]
 * We split the deepest selector on " > " and surface iframe parents as a prefix.
 */
function buildBreadcrumb(target) {
  try {
    if (!Array.isArray(target) || target.length === 0) return [];
    const deepest = target[target.length - 1];
    const parts = deepest.split(/\s*>\s*/).map((p) => p.trim()).filter(Boolean);
    if (target.length > 1) {
      // Iframe ancestry — prefix each frame selector clearly
      const frameParts = target.slice(0, -1).map((s) => `iframe(${s})`);
      return [...frameParts, ...parts];
    }
    return parts;
  } catch (_) {
    return [];
  }
}

/**
 * For a single finding, get:
 *   - position: bounding box + percent-down-page + above/below-fold flag
 *   - screenshot: base64 PNG of the element (if captureScreenshot=true)
 *
 * All failures are silently swallowed — location data is best-effort.
 * pageHeight is passed in so we only evaluate scrollHeight once per page.
 */
async function getElementLocation(page, targetRaw, pageHeight, viewportHeight, captureScreenshot) {
  const result = { position: null, screenshot: null };
  try {
    const selectorStr = Array.isArray(targetRaw)
      ? targetRaw[targetRaw.length - 1]
      : String(targetRaw);

    const locator = page.locator(selectorStr).first();
    const box = await locator.boundingBox({ timeout: 3000 }).catch(() => null);

    if (!box) return result;

    const elementCenterY = box.y + box.height / 2;
    const percentDown = Math.round((elementCenterY / Math.max(pageHeight, 1)) * 100);

    result.position = {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
      pageHeight,
      percentDown,
      aboveFold: box.y < viewportHeight,
    };

    if (captureScreenshot && box.width > 0 && box.height > 0) {
      // Skip if element is huge (e.g. a full-page container) — cap at 1200x800
      if (box.width <= 1200 && box.height <= 800) {
        const buf = await locator.screenshot({ timeout: 5000 }).catch(() => null);
        if (buf) result.screenshot = 'data:image/png;base64,' + buf.toString('base64');
      }
    }
  } catch (_) {
    // Not critical — finding is still reported without location data
  }
  return result;
}

/**
 * Run axe-core against an already-loaded Playwright page.
 * Normalises violations into a flat Finding array, enriched with location data.
 *
 * options:
 *   tags              — axe tag set to run (default: wcag2a, wcag2aa, wcag21aa)
 *   captureScreenshots — whether to take per-element screenshots (default: false)
 */
async function scanPageWithAxe(page, url, {
  tags = ['wcag2a', 'wcag2aa', 'wcag21aa'],
  captureScreenshots = false,
} = {}) {
  // Skip axe entirely if no tags requested
  if (!tags || tags.length === 0) {
    return { url, findings: [], passes_count: 0, incomplete_count: 0, scanned_at: new Date().toISOString() };
  }
  const results = await new AxeBuilder({ page }).withTags(tags).analyze();

  // Measure page once — reused for every finding's position calculation
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
  const viewportHeight = (page.viewportSize() || { height: 768 }).height;

  // Build raw findings first
  const rawFindings = [];
  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      rawFindings.push({
        type: 'accessibility',
        source_tool: 'axe-core',
        rule_id: violation.id,
        // Keep WCAG criterion tags plus the two category tags axe-core uses
        // for non-WCAG rules — best-practice/experimental — so the UI can
        // show a "Best Practice"/"Experimental" pill alongside WCAG level pills.
        wcag_tags: violation.tags.filter((t) => /^wcag|^best-practice$|^experimental$/.test(t)),
        impact: violation.impact,       // minor | moderate | serious | critical
        description: violation.description,
        help: violation.help,
        help_url: violation.helpUrl,
        url,
        target_raw: node.target,        // kept for location lookup
        target_selector: node.target.join(' > '),
        breadcrumb: buildBreadcrumb(node.target),
        html_snippet: node.html,
        failure_summary: node.failureSummary,
      });
    }
  }

  // Enrich with location data — batched 5 at a time to avoid overwhelming the page
  const CONCURRENCY = 5;
  const findings = [];
  for (let i = 0; i < rawFindings.length; i += CONCURRENCY) {
    const batch = rawFindings.slice(i, i + CONCURRENCY);
    const locations = await Promise.all(
      batch.map((f) => getElementLocation(page, f.target_raw, pageHeight, viewportHeight, captureScreenshots))
    );
    batch.forEach((f, idx) => {
      const { target_raw, ...finding } = f; // strip internal field before storing
      findings.push({ ...finding, location: locations[idx] });
    });
  }

  return {
    url,
    findings,
    passes_count: results.passes.length,
    incomplete_count: results.incomplete.length,
    scanned_at: new Date().toISOString(),
  };
}

module.exports = { scanPageWithAxe };
