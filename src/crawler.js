const { URL } = require('url');

/**
 * Normalize a URL for dedup purposes:
 * - strips hash fragments
 * - strips trailing slash (except root)
 * - strips common tracking params
 * - lowercases host
 */
function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
    trackingParams.forEach((p) => u.searchParams.delete(p));
    u.hostname = u.hostname.toLowerCase();
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    u.pathname = pathname;
    return u.toString();
  } catch (e) {
    return null;
  }
}

function isSameScope(candidateUrl, rootUrl, includeSubdomains) {
  try {
    const c = new URL(candidateUrl);
    const r = new URL(rootUrl);
    if (!['http:', 'https:'].includes(c.protocol)) return false;
    if (includeSubdomains) {
      return c.hostname === r.hostname || c.hostname.endsWith('.' + r.hostname);
    }
    return c.hostname === r.hostname;
  } catch (e) {
    return false;
  }
}

const SKIP_EXTENSIONS = /\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|rar|mp4|mp3|avi|mov|doc|docx|xls|xlsx|ppt|pptx|css|js|json|xml|woff|woff2|ttf|eot)(\?.*)?$/i;

/**
 * Crawl a site starting from rootUrl using a shared Playwright browser context.
 * Calls onPage(url) for each discovered page BEFORE scanning isn't done here -
 * the caller decides when/whether to scan; this module purely discovers + visits.
 *
 * options:
 *  - maxPages: number (default 50)
 *  - maxDepth: number (default 3)
 *  - includeSubdomains: boolean (default false)
 *  - includePatterns: array of regex strings (optional allowlist)
 *  - excludePatterns: array of regex strings (optional denylist)
 *  - concurrency: number (default 3)
 *  - onPageVisited: async (pageInfo) => {} called after each page is loaded+ready,
 *      with { url, page } - page is the Playwright Page, left open for the caller
 *      to run further checks (e.g. axe) on, then the caller must NOT close it -
 *      crawler will close it after onPageVisited resolves.
 */
async function crawlSite(context, rootUrl, options, onPageVisited, shouldStop = () => false) {
  const {
    maxPages = 50,
    maxDepth = 3,
    includeSubdomains = false,
    includePatterns = [],
    excludePatterns = [],
    concurrency = 3,
  } = options;

  const includeRegexes = includePatterns.map((p) => new RegExp(p));
  const excludeRegexes = excludePatterns.map((p) => new RegExp(p));

  const normalizedRoot = normalizeUrl(rootUrl);
  if (!normalizedRoot) throw new Error(`Invalid root URL: ${rootUrl}`);

  const visited = new Set();
  const queued = new Set([normalizedRoot]);
  const queue = [{ url: normalizedRoot, depth: 0 }];
  const errors = [];

  // Track pages currently loading so we can close them immediately on stop
  const activePages = new Set();

  // Watcher: close in-flight pages within ~300ms of stop being requested,
  // aborting their navigations rather than waiting up to 30s for them to finish.
  const stopWatcher = setInterval(() => {
    if (!shouldStop()) return;
    clearInterval(stopWatcher);
    for (const p of activePages) {
      p.close().catch(() => {});
    }
  }, 300);

  function shouldVisit(url) {
    if (!isSameScope(url, normalizedRoot, includeSubdomains)) return false;
    if (SKIP_EXTENSIONS.test(url)) return false;
    if (excludeRegexes.some((re) => re.test(url))) return false;
    if (includeRegexes.length > 0 && !includeRegexes.some((re) => re.test(url))) return false;
    return true;
  }

  async function worker() {
    while (queue.length > 0 && visited.size < maxPages && !shouldStop()) {
      const item = queue.shift();
      if (!item) continue;
      const { url, depth } = item;
      if (visited.has(url)) continue;
      visited.add(url);

      const page = await context.newPage();
      activePages.add(page);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Check after navigation — skip the expensive scan if stop was requested
        // (either explicitly or because the stop watcher closed this page mid-load)
        if (!shouldStop() && typeof onPageVisited === 'function') {
          await onPageVisited({ url, page, depth });
        }

        if (!shouldStop() && depth < maxDepth) {
          const hrefs = await page.$$eval('a[href]', (els) => els.map((el) => el.href));
          for (const href of hrefs) {
            const normalized = normalizeUrl(href);
            if (!normalized) continue;
            if (visited.has(normalized) || queued.has(normalized)) continue;
            if (!shouldVisit(normalized)) continue;
            if (visited.size + queued.size >= maxPages) break;
            queued.add(normalized);
            queue.push({ url: normalized, depth: depth + 1 });
          }
        }
      } catch (err) {
        // Suppress errors that are a direct result of stopping (page closed by watcher)
        if (!shouldStop()) {
          errors.push({ url, error: err.message });
        }
      } finally {
        activePages.delete(page);
        await page.close().catch(() => {});
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  clearInterval(stopWatcher);

  return {
    visitedUrls: Array.from(visited),
    errors,
  };
}

module.exports = { crawlSite, normalizeUrl, isSameScope };
