/**
 * Groups findings from a single scan that represent the same underlying
 * issue occurring on multiple URLs/elements — e.g. every "Select element
 * must have an accessible name" violation across a crawl collapses into
 * one group listing all the URLs/locations it was found at.
 *
 * This exists to prep for a future Testing Manager integration: raise one
 * bug per group (with all its URLs/locations attached) rather than one bug
 * per individual occurrence.
 *
 * NOTE: group_key is derived deterministically from finding content. If a
 * future feature persists state keyed by group_key (e.g. a Testing Manager
 * ticket ID), changing the normalization logic below changes group identity
 * for message-derived groups — treat that as a breaking change for it.
 */

const IMPACT_RANK = { critical: 4, serious: 3, moderate: 2, minor: 1 };

// Sources whose rule_id is already a stable, per-issue identifier that can
// be grouped on directly. vnu (HTML) never has one — its rule_id is a slug
// of the whole free-text message. W3C CSS warnings collapse to the single
// literal 'css-warning' for every warning, so that's unusable too.
function hasStableRuleId(f) {
  if (f.type === 'accessibility') return true;                                  // axe-core: violation.id
  if (f.type === 'css-lint') return true;                                       // stylelint: rule name
  if (f.type === 'css-validation' && f.rule_id && f.rule_id !== 'css-warning')  // w3c-css errors: typed category
    return true;
  return false;
}

// Collapses the variable parts of a free-text message (quoted element/
// attribute/value names) so two occurrences of the same underlying message
// template collapse to one key, while keeping the fixed wording intact so
// the result still reads as a sensible group title.
//   'Attribute "foo" not allowed on element "div" at this point.'
//   'Attribute "bar" not allowed on element "span" at this point.'
//   -> both normalize to: 'Attribute "…" not allowed on element "…" at this point.'
function normalizeMessageTemplate(message) {
  if (!message) return '';
  return message
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Cheap 32-bit string hash (base36) — collision guard when a slug gets
// truncated and would otherwise merge two different long messages.
function shortHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function slugify(str, maxLen = 80) {
  const slug = str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length <= maxLen ? slug : `${slug.slice(0, maxLen)}-${shortHash(str)}`;
}

// Returns { keyKind: 'rule'|'msg', keyValue, title } for one finding.
function deriveKey(f) {
  if (hasStableRuleId(f)) {
    return { keyKind: 'rule', keyValue: f.rule_id, title: f.help || f.description || f.rule_id };
  }
  const template = normalizeMessageTemplate(f.description || f.help || '');
  return { keyKind: 'msg', keyValue: slugify(template), title: template || f.rule_id || 'Unknown issue' };
}

// Builds the grouped view of a scan's findings. `scanId` namespaces the
// group_key so keys never collide across scans even if this is ever called
// with findings from more than one (it isn't today — grouping is per-scan).
function buildGroups(scanId, findings) {
  const map = new Map();

  for (const f of findings) {
    const { keyKind, keyValue, title } = deriveKey(f);
    const key = `${scanId}|${f.type}|${f.source_tool}|${keyKind}:${keyValue}`;

    let g = map.get(key);
    if (!g) {
      g = {
        group_key: key,
        type: f.type,
        source_tool: f.source_tool,
        rule_id: keyKind === 'rule' ? f.rule_id : null,
        title,
        description: keyKind === 'rule' ? f.description : title,
        help: f.help,
        help_url: f.help_url,
        impact: null,
        wcag_tags: new Set(),
        urls: new Set(),
        occurrences: [],
      };
      map.set(key, g);
    }

    (f.wcag_tags || []).forEach((t) => g.wcag_tags.add(t));
    if ((IMPACT_RANK[f.impact] || 0) > (IMPACT_RANK[g.impact] || 0)) g.impact = f.impact;
    if (!g.help_url && f.help_url) g.help_url = f.help_url;

    g.urls.add(f.url);
    g.occurrences.push({
      url: f.url,
      target_selector: f.target_selector,
      breadcrumb: f.breadcrumb,
      html_snippet: f.html_snippet,
      failure_summary: f.failure_summary,
      location: f.location,
    });
  }

  const groups = [...map.values()].map((g) => ({
    ...g,
    wcag_tags: [...g.wcag_tags].sort(),
    occurrence_count: g.occurrences.length,
    url_count: g.urls.size,
    urls: [...g.urls].sort(),
  }));

  groups.sort((a, b) =>
    (IMPACT_RANK[b.impact] || 0) - (IMPACT_RANK[a.impact] || 0) ||
    b.occurrence_count - a.occurrence_count
  );

  return groups;
}

module.exports = { buildGroups, deriveKey, normalizeMessageTemplate, slugify, IMPACT_RANK };
