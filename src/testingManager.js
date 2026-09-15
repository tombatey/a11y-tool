/**
 * Testing Manager API client — Testing Manager is a Bubble app
 * (testingmanager.co.uk) with a Data API (GET/POST /obj/{Type}) and custom
 * backend workflows (/wf/...). Set TESTING_MANAGER_BASE_URL and
 * TESTING_MANAGER_API_TOKEN in .env to enable. If either is missing, calls
 * throw — callers (server.js routes) should check isConfigured() first and
 * return a clear error rather than let a raw fetch failure surface.
 *
 * Field names and request shape are proven in production by the
 * webdepend-slack-app project's services/testingManager.js (read side) and
 * testing-manager-bridge's src/services/bubble.js (the /wf/create_ticket
 * workflow this module's createIssue() extends with an assigned_to field).
 */

function isConfigured() {
  return !!(process.env.TESTING_MANAGER_BASE_URL && process.env.TESTING_MANAGER_API_TOKEN);
}

function baseUrl() {
  return process.env.TESTING_MANAGER_BASE_URL.replace(/\/+$/, '');
}

async function tmFetch(path, { method = 'GET', params, body } = {}) {
  const url = new URL(`${baseUrl()}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.TESTING_MANAGER_API_TOKEN}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err  = new Error(`Testing Manager API error ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Fetch an Organisation record by its Bubble unique_id. Used to verify an
 * org ID before it's saved in the admin "Organisations" screen.
 */
async function getOrganisationById(tmOrgId) {
  const data = await tmFetch(`/obj/Organisation/${encodeURIComponent(tmOrgId)}`);
  return data.response;
}

/**
 * Fetch Project records for an organisation with status = 'Active', for the
 * project dropdown shown when starting a scan.
 */
async function getActiveProjects(tmOrgId) {
  const constraints = JSON.stringify([
    { key: 'organisation', constraint_type: 'equals', value: tmOrgId },
    { key: 'status',       constraint_type: 'equals', value: 'Active' },
  ]);
  const data = await tmFetch('/obj/Project', { params: { constraints, sort_field: 'projectname', limit: 100 } });
  return data.response?.results ?? [];
}

// admin = true OR userRole = 'Tester' means WebDepend staff, not a customer —
// matches webdepend-slack-app/services/auth.js's isTMStaff exactly.
function isStaff(user) {
  return user.admin === true || user.userRole === 'Tester';
}

/**
 * Fetch active Users assignable to a bug for this organisation: isActive and
 * (belongs to the organisation OR is WebDepend staff).
 */
async function getAssignableUsers(tmOrgId) {
  const constraints = JSON.stringify([
    { key: 'isActive', constraint_type: 'equals', value: true },
  ]);
  const data  = await tmFetch('/obj/User', { params: { constraints, limit: 100 } });
  const users = data.response?.results ?? [];
  return users.filter((u) => u.organisation === tmOrgId || isStaff(u));
}

// axe-core impact -> Testing Manager severity option set (Trivial/Minor/
// Major/Critical/Blocker, per testing-manager-bridge/CLAUDE.md). Verify
// against the real Issue option set before relying on this for anything
// beyond a sensible default — it's carried over from the widget-bridge docs.
const IMPACT_TO_SEVERITY = {
  critical: 'Critical',
  serious:  'Major',
  moderate: 'Minor',
  minor:    'Trivial',
};

/**
 * Create a bug (Issue) in Testing Manager via the existing /wf/create_ticket
 * workflow. Same payload shape as testing-manager-bridge's bubble.js, plus
 * assigned_to for the bug owner — verify this exact param name against the
 * real workflow, since the original contract always used a fixed system
 * user and never took an assignee from the caller.
 */
async function createIssue({ projectId, orgId, title, description, severity, assignedTo, pageUrl }) {
  const data = await tmFetch('/wf/create_ticket', {
    method: 'POST',
    body: {
      project_id:  projectId,
      org_id:      orgId,
      type:        'Bug',
      title,
      description,
      severity,
      assigned_to: assignedTo,
      page_url:    pageUrl || null,
      submitted_at: new Date().toISOString(),
    },
  });

  const issueId = data?.response?.id || data?.id || null;
  if (!issueId) throw new Error('Testing Manager returned success but no issue ID was found in the response.');
  return { tmIssueId: issueId, tmIssueRef: data?.response?.issueRef ?? null };
}

module.exports = {
  isConfigured,
  getOrganisationById,
  getActiveProjects,
  getAssignableUsers,
  createIssue,
  IMPACT_TO_SEVERITY,
};
