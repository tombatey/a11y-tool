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
  function renderToggle(viewMode, toggleFnName) {
    return `
    <div class="type-filters">
      <button class="type-filter-btn ${viewMode === 'occurrence' ? 'active' : ''}" onclick="${toggleFnName}('occurrence')">By occurrence</button>
      <button class="type-filter-btn ${viewMode === 'group' ? 'active' : ''}" onclick="${toggleFnName}('group')">By issue</button>
    </div>`;
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
        <td class="url-cell">${escapeHtml(o.url)}</td>
        <td>${occurrenceLocation(o)}</td>
        <td>${o.html_snippet ? `<code>${escapeHtml(o.html_snippet)}</code>` : ''}</td>
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

  async function render(containerEl, scanId) {
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
    containerEl.innerHTML = data.groups.length
      ? data.groups.map(renderGroup).join('')
      : '<div class="empty">No issues to group.</div>';
  }

  return { renderToggle, render, _toggleBody };
})();
