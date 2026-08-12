// src/sitemap.js
// Fetches and parses an XML sitemap (or sitemap index) into a flat URL array
// for "sitemap" mode scans. Fetches via context.request (Playwright's
// APIRequestContext) rather than a bare fetch() so the request inherits the
// browser context's cookies/httpCredentials — same reasoning as
// src/validators/css.js's stylesheet fetching, since a sitemap can live
// behind the same basic-auth/form-login as the site itself.

const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({ ignoreAttributes: true });

const MAX_SITEMAP_INDEX_DEPTH = 3;   // real-world nesting is rarely more than 2 levels
const MAX_CHILD_SITEMAPS = 50;       // guards against a pathological sitemap index

function toArray(v) {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

// Fetches a single sitemap URL and returns its raw parsed XML, throwing a
// clear error on fetch failure or invalid XML.
async function fetchAndParse(context, sitemapUrl) {
  let res;
  try {
    res = await context.request.get(sitemapUrl, { timeout: 15000 });
  } catch (err) {
    throw new Error(`Sitemap fetch failed: ${sitemapUrl} (${err.message})`);
  }
  if (!res.ok()) {
    throw new Error(`Sitemap fetch failed: ${res.status()} ${sitemapUrl}`);
  }
  const xml = await res.text();
  try {
    return parser.parse(xml);
  } catch (err) {
    throw new Error(`Sitemap at ${sitemapUrl} is not valid XML: ${err.message}`);
  }
}

// Resolves a sitemap URL (flat <urlset> or nested <sitemapindex>) into a
// flat array of page URLs, capped at maxPages. Unreachable/invalid child
// sitemaps referenced by a <sitemapindex> are logged and skipped rather
// than failing the whole scan — one stale entry shouldn't block an
// otherwise-working sitemap.
async function fetchSitemapUrls(context, sitemapUrl, maxPages, depth = 0) {
  if (depth > MAX_SITEMAP_INDEX_DEPTH) {
    throw new Error(`Sitemap index nesting exceeded ${MAX_SITEMAP_INDEX_DEPTH} levels at ${sitemapUrl}`);
  }

  const parsed = await fetchAndParse(context, sitemapUrl);

  if (parsed.sitemapindex) {
    const children = toArray(parsed.sitemapindex.sitemap)
      .map((s) => s.loc)
      .filter(Boolean)
      .slice(0, MAX_CHILD_SITEMAPS);

    let urls = [];
    for (const childUrl of children) {
      if (urls.length >= maxPages) break;
      try {
        const childUrls = await fetchSitemapUrls(context, childUrl, maxPages - urls.length, depth + 1);
        urls = urls.concat(childUrls);
      } catch (err) {
        console.warn(`Skipping unreachable/invalid child sitemap ${childUrl}: ${err.message}`);
      }
    }
    return urls.slice(0, maxPages);
  }

  if (parsed.urlset) {
    const urls = toArray(parsed.urlset.url).map((u) => u.loc).filter(Boolean);
    return urls.slice(0, maxPages);
  }

  throw new Error(`Sitemap at ${sitemapUrl} has neither <urlset> nor <sitemapindex> root`);
}

module.exports = { fetchSitemapUrls };
