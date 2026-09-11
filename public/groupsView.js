/**
 * Shared "grouped issues" view — loaded by both index.html (live scan) and
 * history.html (scan detail). Fetches /api/scan/:id/groups and renders it
 * as an alternative to the flat, one-row-per-occurrence findings table.
 *
 * Deliberately self-contained (no reliance on host-page globals) since
 * index.html/app.js and history.html each keep their own copies of state
 * like currentJobId/activeTypes under different names.
 */
window.GroupsView = (function () {
  const IMPACT_LABEL = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor' };
  const TYPE_LABEL   = { accessibility: 'A11Y', 'html-validation': 'HTML', 'css-validation': 'CSS', 'css-lint': 'CSS' };

  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Renders the "By occurrence" / "By issue" toggle. `toggleFnName` is the
  // name of a global function on the host page taking the new mode string —
  // kept as a string (rather than a function reference) since the buttons
  // are rendered as an HTML string with inline onclick handlers, matching
  // the existing type-filter-btn pattern already used on both host pages.
  //
  // Uses its own view-toggle/view-toggle-btn classes rather than reusing
  // type-filters/type-filter-btn — the host pages' setTypeFilter() does a
  // document-wide querySelectorAll('.type-filter-btn') to sync the active
  // class on the A11Y/HTML/CSS buttons, which would otherwise also match
  // (and incorrectly clear the active state of) these toggle buttons.
  function renderToggle(viewMode, toggleFnName) {
    return `
    <div class="view-toggle">
      <button class="view-toggle-btn ${viewMode === 'occurrence' ? 'active' : ''}" onclick="${toggleFnName}('occurrence')">By occurrence</button>
      <button class="view-toggle-btn ${viewMode === 'group' ? 'active' : ''}" onclick="${toggleFnName}('group')">By issue</button>
    </div>`;
  }

  // Mirrors the host pages' typeGroup() bucketing (accessibility / html-validation
  // / css) so the type filter buttons can filter grouped issues too. Kept as its
  // own copy rather than calling the host's global — this module stays usable
  // without depending on exactly how each host page names that helper.
  function typeCategory(type) {
    if (!type || type === 'accessibility') return 'accessibility';
    if (type === 'html-validation') return 'html-validation';
    return 'css';
  }

  function occurrenceLocation(o) {
    if (o.failure_summary) return escapeHtml(o.failure_summary);
    const path = (o.breadcrumb || []).slice(-3).join(' > ') || o.target_selector;
    return path ? escapeHtml(path) : '';
  }

  function renderGroup(g, idx) {
    const bodyId = `groupBody-${idx}`;
    const occurrenceRows = g.occurrences.map((o) => `
      <tr>
        <td class="occ-url">${escapeHtml(o.url)}</td>
        <td class="occ-location">${occurrenceLocation(o)}</td>
        <td class="occ-snippet">${o.html_snippet ? `<code>${escapeHtml(o.html_snippet)}</code>` : ''}</td>
      </tr>`).join('');

    return `
    <div class="group-card">
      <div class="group-card-header" onclick="GroupsView._toggleBody('${bodyId}')">
        <span class="badge ${g.impact || ''}">${IMPACT_LABEL[g.impact] || 'n/a'}</span>
        <span class="type-badge ${g.type}">${TYPE_LABEL[g.type] || g.type}</span>
        <span class="group-title">${escapeHtml(g.title)}</span>
        ${g.rule_id ? `<span class="group-rule">${escapeHtml(g.rule_id)}</span>` : ''}
        <span class="group-summary">${g.occurrence_count} occurrence${g.occurrence_count === 1 ? '' : 's'} across ${g.url_count} URL${g.url_count === 1 ? '' : 's'}</span>
      </div>
      <div class="group-card-body" id="${bodyId}" style="display:none">
        ${g.help_url ? `<div class="group-help"><a href="${escapeHtml(g.help_url)}" target="_blank" rel="noopener">Details</a></div>` : ''}
        <table>
          <thead><tr><th>URL</th><th>Location</th><th>Snippet</th></tr></thead>
          <tbody>${occurrenceRows}</tbody>
        </table>
      </div>
    </div>`;
  }

  function _toggleBody(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }

  // `activeType` mirrors the host page's type-filter state ('all' |
  // 'accessibility' | 'html-validation' | 'css') so switching to "By issue"
  // while a type filter is active shows only that type's groups, and
  // clicking a type filter while already on "By issue" re-filters in place.
  //
  // `activeSeverities`, if given, is a Set of impact strings ('critical' |
  // 'serious' | 'moderate' | 'minor') mirroring the host page's severity
  // isolation state (clicking a severity summary card) — groups whose
  // impact isn't in the set are hidden. Omit it to show every severity.
  //
  // `onCounts`, if given, is called with { critical, serious, moderate,
  // minor } — the number of *groups* (not occurrences) at each severity
  // among the type-filtered set, before severity filtering is applied — so
  // the host page can show issue-level counts on its severity summary cards
  // instead of occurrence-level ones while "By issue" is active. Mirrors
  // how the occurrence view's own counts are type-filtered but not further
  // narrowed by which severity is currently isolated.
  async function render(containerEl, scanId, activeType, activeSeverities, onCounts) {
    if (!containerEl) return;
    containerEl.innerHTML = '<div class="empty">Loading grouped issues…</div>';
    let data;
    try {
      const res = await fetch(`/api/scan/${scanId}/groups`);
      if (!res.ok) throw new Error('bad response');
      data = await res.json();
    } catch {
      containerEl.innerHTML = '<div class="empty">Failed to load grouped issues.</div>';
      return;
    }

    const typeFiltered = (!activeType || activeType === 'all')
      ? data.groups
      : data.groups.filter((g) => typeCategory(g.type) === activeType);

    if (onCounts) {
      const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
      typeFiltered.forEach((g) => { if (counts[g.impact] !== undefined) counts[g.impact]++; });
      onCounts(counts);
    }

    const groups = activeSeverities
      ? typeFiltered.filter((g) => activeSeverities.has(g.impact))
      : typeFiltered;

    if (data.groups.length === 0) {
      containerEl.innerHTML = '<div class="empty">No issues to group.</div>';
    } else if (groups.length === 0) {
      containerEl.innerHTML = '<div class="empty">No issues match this filter.</div>';
    } else {
      containerEl.innerHTML = groups.map(renderGroup).join('');
    }
  }

  return { renderToggle, render, _toggleBody };
})();
