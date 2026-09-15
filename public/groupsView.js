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

  // axe-core impact -> Testing Manager severity option set — mirrors
  // src/testingManager.js's IMPACT_TO_SEVERITY, used to prefill the raise-bug
  // modal's severity field (still editable).
  const IMPACT_TO_SEVERITY = { critical: 'Critical', serious: 'Major', moderate: 'Minor', minor: 'Trivial' };

  // Set by render() on every call — the raise-bug modal (triggered from an
  // inline onclick with only a group_key to hand it) reads this rather than
  // needing every call site to thread scanId/organisationId through by hand.
  let _ctx = { scanId: null, organisationId: null, enabled: false };
  let _lastGroups = []; // most recently fetched groups, for the raise-bug modal to read title/description/impact from

  // Mirrors the host pages' WCAG_TAG_LABELS/findingTagPills — kept as its
  // own copy for the same reason as typeCategory() below (this module stays
  // usable without depending on host-page globals). Empty for HTML/CSS
  // groups, since only axe-core findings carry wcag_tags.
  const WCAG_TAG_LABELS = {
    wcag2a:          'WCAG 2.0 A',
    wcag2aa:         'WCAG 2.0 AA',
    wcag21aa:        'WCAG 2.1 AA',
    wcag22aa:        'WCAG 2.2 AA',
    wcag2aaa:        'WCAG 2.0 AAA',
    'best-practice': 'Best Practice',
    experimental:    'Experimental',
  };

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

  function groupTagPills(g) {
    if (!g.wcag_tags || !g.wcag_tags.length) return '';
    const known = g.wcag_tags.filter((t) => WCAG_TAG_LABELS[t]);
    if (!known.length) return '';
    return `<div class="group-tags">${known.map((t) =>
      `<span class="finding-tag-pill">${escapeHtml(WCAG_TAG_LABELS[t])}</span>`
    ).join('')}</div>`;
  }

  // Renders either a "Raise bug" button or a "Raised: BUG-123" badge for a
  // group, or nothing at all when this scan has no Testing Manager project
  // selected (see _ctx, set by render()). Wrapped in a stable data-group-key
  // slot so a successful raise can patch just this element in place without
  // a full re-render (see _submitRaiseBug).
  function raiseBugControl(g) {
    if (!_ctx.enabled) return '';
    const key = escapeHtml(g.group_key);
    const inner = g.raisedBug
      ? `<span class="raised-bug-badge">Raised: ${escapeHtml(g.raisedBug.tmIssueRef || g.raisedBug.tmIssueId)}</span>`
      : `<button type="button" class="raise-bug-btn" onclick="event.stopPropagation(); GroupsView._openRaiseBug('${key}')">Raise bug</button>`;
    return `<span class="raise-bug-slot" data-group-key="${key}">${inner}</span>`;
  }

  // `urlFilter`, if given, narrows a group's own occurrence list (and the
  // "N occurrences across M URLs" summary) down to just that URL — mirroring
  // how the flat occurrence table hides non-matching rows outright, rather
  // than leaving the group's header showing scan-wide totals while only
  // some of its occurrences are actually shown underneath.
  function renderGroup(g, idx, urlFilter) {
    const occurrences = urlFilter ? g.occurrences.filter((o) => o.url === urlFilter) : g.occurrences;
    const occurrenceCount = urlFilter ? occurrences.length : g.occurrence_count;
    const urlCount = urlFilter ? 1 : g.url_count;
    const bodyId = `groupBody-${idx}`;
    const occurrenceRows = occurrences.map((o) => `
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
        <span class="group-summary">${occurrenceCount} occurrence${occurrenceCount === 1 ? '' : 's'} across ${urlCount} URL${urlCount === 1 ? '' : 's'}</span>
        ${raiseBugControl(g)}
        ${groupTagPills(g)}
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

  // `filters` mirrors the host page's current filter state:
  //   - type: 'all' | 'accessibility' | 'html-validation' | 'css' — so
  //     switching to "By issue" while a type filter is active shows only
  //     that type's groups, and clicking a type filter while already on
  //     "By issue" re-filters in place.
  //   - severities: a Set of impact strings ('critical' | 'serious' |
  //     'moderate' | 'minor'), mirroring the severity-isolation state
  //     (clicking a severity summary card) — groups whose impact isn't in
  //     the set are hidden. Omit/null to show every severity.
  //   - url: a single URL string, mirroring the "Show pages scanned" URL
  //     filter — only groups with at least one occurrence on that URL are
  //     shown, and each shown group's own occurrence list/summary is
  //     narrowed to just that URL too (see renderGroup). Omit/null to show
  //     every URL.
  //
  // `onCounts`, if given, is called with { critical, serious, moderate,
  // minor } — the number of *groups* (not occurrences) at each severity
  // among the type+URL-filtered set, before severity filtering is applied —
  // so the host page can show issue-level counts on its severity summary
  // cards instead of occurrence-level ones while "By issue" is active.
  // Mirrors how the occurrence view's own counts are type/URL-filtered but
  // not further narrowed by which severity is currently isolated.
  async function render(containerEl, scanId, filters, onCounts) {
    if (!containerEl) return;
    const { type: activeType, severities: activeSeverities, url: urlFilter, raiseBug } = filters || {};
    _ctx = {
      scanId,
      organisationId: raiseBug?.organisationId ?? null,
      enabled: !!(raiseBug && raiseBug.tmProjectId),
    };
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
    _lastGroups = data.groups;

    const typeFiltered = (!activeType || activeType === 'all')
      ? data.groups
      : data.groups.filter((g) => typeCategory(g.type) === activeType);

    const urlFiltered = urlFilter
      ? typeFiltered.filter((g) => g.urls.includes(urlFilter))
      : typeFiltered;

    if (onCounts) {
      const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
      urlFiltered.forEach((g) => { if (counts[g.impact] !== undefined) counts[g.impact]++; });
      onCounts(counts);
    }

    const groups = activeSeverities
      ? urlFiltered.filter((g) => activeSeverities.has(g.impact))
      : urlFiltered;

    if (data.groups.length === 0) {
      containerEl.innerHTML = '<div class="empty">No issues to group.</div>';
    } else if (groups.length === 0) {
      containerEl.innerHTML = '<div class="empty">No issues match this filter.</div>';
    } else {
      containerEl.innerHTML = groups.map((g, idx) => renderGroup(g, idx, urlFilter)).join('');
    }
  }

  // ─── Raise-bug modal ──────────────────────────────────────────────────────
  // A single modal element shared across every group card, created lazily on
  // first use and reused — matches this file's self-contained philosophy
  // (its own styles injected once, no dependency on host-page CSS/markup).
  let _openGroupKey = null;

  function ensureModal() {
    if (document.getElementById('raiseBugModal')) return;

    const style = document.createElement('style');
    style.textContent = `
      .raise-bug-btn {
        padding: 3px 10px; border: 1px solid #02BFF8; border-radius: 5px;
        background: #E1F7FE; color: #014357; cursor: pointer; font-size: 11px;
        font-weight: 600; font-family: inherit;
      }
      .raise-bug-btn:hover { background: #02BFF8; }
      .raised-bug-badge {
        font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 99px;
        background: #F3FAE6; color: #547717;
      }
      .raise-bug-modal-overlay {
        position: fixed; inset: 0; background: rgba(15,23,42,0.5); z-index: 1100;
        align-items: center; justify-content: center; padding: 16px;
      }
      .raise-bug-modal {
        background: #fff; border-radius: 10px; padding: 24px; width: 100%; max-width: 440px;
        max-height: 90vh; overflow-y: auto; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      }
      .raise-bug-modal h3 { margin: 0 0 16px; font-size: 15px; color: #014357; }
      .raise-bug-modal label { display: block; font-size: 12px; color: #64748B; margin: 14px 0 4px; }
      .raise-bug-modal label:first-of-type { margin-top: 0; }
      .raise-bug-modal input[type=text], .raise-bug-modal textarea, .raise-bug-modal select {
        width: 100%; padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 6px;
        font-size: 13px; font-family: inherit; background: #F8FAFC; box-sizing: border-box;
      }
      .raise-bug-modal textarea { resize: vertical; }
      .raise-bug-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
      .raise-bug-modal-actions button {
        padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600;
        cursor: pointer; font-family: inherit; border: 1px solid #E2E8F0; background: #fff; color: #334155;
      }
      .raise-bug-modal-actions button.primary { background: #02BFF8; color: #014357; border-color: #02BFF8; }
      .raise-bug-modal-actions button:disabled { opacity: 0.5; cursor: default; }
      .raise-bug-msg { margin-top: 12px; font-size: 12px; padding: 8px 12px; border-radius: 6px; background: #fdf2f2; color: #8c2f2f; }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'raiseBugModal';
    overlay.className = 'raise-bug-modal-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div class="raise-bug-modal">
        <h3>Raise bug in Testing Manager</h3>
        <label for="raiseBugTitle">Title</label>
        <input type="text" id="raiseBugTitle" />
        <label for="raiseBugDescription">Description</label>
        <textarea id="raiseBugDescription" rows="4"></textarea>
        <label for="raiseBugSeverity">Severity</label>
        <select id="raiseBugSeverity">
          <option value="Trivial">Trivial</option>
          <option value="Minor">Minor</option>
          <option value="Major">Major</option>
          <option value="Critical">Critical</option>
          <option value="Blocker">Blocker</option>
        </select>
        <label for="raiseBugAssignee">Assign to</label>
        <select id="raiseBugAssignee"><option value="">Loading…</option></select>
        <div id="raiseBugMsg" class="raise-bug-msg" style="display:none"></div>
        <div class="raise-bug-modal-actions">
          <button type="button" onclick="GroupsView._closeRaiseBug()">Cancel</button>
          <button type="button" class="primary" id="raiseBugSubmitBtn" onclick="GroupsView._submitRaiseBug()">Raise bug</button>
        </div>
      </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) _closeRaiseBug(); });
    document.body.appendChild(overlay);
  }

  function _openRaiseBug(groupKey) {
    const g = _lastGroups.find((x) => x.group_key === groupKey);
    if (!g) return;
    _openGroupKey = groupKey;
    ensureModal();

    document.getElementById('raiseBugTitle').value = g.title || '';
    document.getElementById('raiseBugDescription').value = g.description || g.help || '';
    document.getElementById('raiseBugSeverity').value = IMPACT_TO_SEVERITY[g.impact] || 'Minor';
    document.getElementById('raiseBugMsg').style.display = 'none';

    const assigneeSelect = document.getElementById('raiseBugAssignee');
    assigneeSelect.innerHTML = '<option value="">Loading…</option>';
    document.getElementById('raiseBugModal').style.display = 'flex';

    fetch(`/api/organisations/${_ctx.organisationId}/users`)
      .then((r) => r.json())
      .then((users) => {
        if (!Array.isArray(users) || !users.length) {
          assigneeSelect.innerHTML = '<option value="">No assignable users found</option>';
          return;
        }
        assigneeSelect.innerHTML = '<option value="">Choose someone…</option>' + users.map((u) =>
          `<option value="${escapeHtml(u._id)}" data-name="${escapeHtml(u.firstLast || u._id)}">${escapeHtml(u.firstLast || u._id)}</option>`
        ).join('');
      })
      .catch(() => { assigneeSelect.innerHTML = '<option value="">Failed to load users</option>'; });
  }

  function _closeRaiseBug() {
    const modal = document.getElementById('raiseBugModal');
    if (modal) modal.style.display = 'none';
    _openGroupKey = null;
  }

  function showRaiseBugMsg(text) {
    const msg = document.getElementById('raiseBugMsg');
    msg.textContent = text;
    msg.style.display = 'block';
  }

  async function _submitRaiseBug() {
    if (!_openGroupKey) return;
    const title       = document.getElementById('raiseBugTitle').value.trim();
    const description = document.getElementById('raiseBugDescription').value.trim();
    const severity    = document.getElementById('raiseBugSeverity').value;
    const assigneeSelect     = document.getElementById('raiseBugAssignee');
    const assignedToTmUserId = assigneeSelect.value;
    const assignedToName     = assigneeSelect.selectedOptions[0]?.dataset.name || '';

    if (!title)              { showRaiseBugMsg('Title is required.'); return; }
    if (!assignedToTmUserId) { showRaiseBugMsg('Choose someone to assign this to.'); return; }

    const btn = document.getElementById('raiseBugSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Raising…';

    try {
      const res = await fetch(`/api/scan/${_ctx.scanId}/groups/${encodeURIComponent(_openGroupKey)}/raise-bug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, severity, assignedToTmUserId, assignedToName }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        showRaiseBugMsg(result.error || 'Failed to raise bug.');
        return;
      }

      const g = _lastGroups.find((x) => x.group_key === _openGroupKey);
      if (g) g.raisedBug = { tmIssueId: result.tmIssueId, tmIssueRef: result.tmIssueRef, assignedToName };

      const slot = document.querySelector(`.raise-bug-slot[data-group-key="${CSS.escape(_openGroupKey)}"]`);
      if (slot && g) slot.outerHTML = raiseBugControl(g);

      _closeRaiseBug();
    } catch (err) {
      showRaiseBugMsg('Failed to raise bug.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Raise bug';
    }
  }

  return { renderToggle, render, _toggleBody, _openRaiseBug, _closeRaiseBug, _submitRaiseBug };
})();
