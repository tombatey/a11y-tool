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

/**
 * Builds a link to view an issue in the Testing Manager web app, e.g.
 * https://testingmanager.co.uk/version-test/issue/<unique_id> on the test
 * environment, or https://testingmanager.co.uk/issue/<unique_id> live.
 * Derived from TESTING_MANAGER_BASE_URL (which points at .../api/1.1) rather
 * than a separate env var, so staging's /version-test/ segment is carried
 * over automatically without needing to configure it twice.
 */
function getIssueUrl(tmIssueId) {
  const appBase = baseUrl().replace(/\/api\/1\.1$/, '');
  return `${appBase}/issue/${encodeURIComponent(tmIssueId)}`;
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
 * Fetch Project records for an organisation with projectStatus = 'Active',
 * for the project dropdown shown when starting a scan.
 */
async function getActiveProjects(tmOrgId) {
  const constraints = JSON.stringify([
    { key: 'organisation',   constraint_type: 'equals', value: tmOrgId },
    { key: 'projectStatus',  constraint_type: 'equals', value: 'Active' },
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
 * assigned_to for the bug owner and file for an optional attachment (added
 * to the workflow specifically for this integration — creates an Item and
 * links it into the new Issue's issueItems list when present). Both are
 * additive/optional on the workflow side, unlike the required params below,
 * so the widget's existing calls (which never send either) are unaffected.
 *
 * `attachment`, if given, is { filename, content } with `content` as a plain
 * (not base64-encoded) string — this function does the encoding. Bubble's
 * file-type API parameters do NOT accept a data: URI; per Bubble's own docs
 * (manual.bubble.io/core-resources/api/the-bubble-api) the value must be a
 * JSON object: { filename, contents: <base64, no "data:" prefix>, private }.
 * Confirmed by testing a data: URI directly first — Bubble stored it as a
 * literal string rather than converting it to a file, matching a
 * misunderstanding, not a Bubble bug.
 */
async function createIssue({ projectId, orgId, title, description, severity, assignedTo, pageUrl, attachment }) {
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
      // Optional — the full occurrence list as a file when it's too large
      // to fit inline in the description. Omitted (null) on every
      // normal-sized bug.
      file: attachment ? {
        filename: attachment.filename,
        contents: Buffer.from(attachment.content, 'utf8').toString('base64'),
        private:  false,
      } : null,
      // The workflow declares these as parameters even though this
      // integration never has a value for them — Bubble's Workflow API
      // requires every declared parameter key to be present in the request
      // body (MISSING_DATA otherwise), even when null. Same full parameter
      // set as testing-manager-bridge's own payload shape.
      steps:        null,
      screenshot:   null,
      browser:      null,
      os:           null,
      screen:       null,
      submitted_at: new Date().toISOString(),
    },
  });

  const issueId = data?.response?.id || data?.id || null;
  if (!issueId) throw new Error('Testing Manager returned success but no issue ID was found in the response.');

  // create_ticket's response only carries the Bubble unique_id, not the
  // human-readable issueRef (e.g. "BUG-123") — fetch the record we just
  // created to get it. Best-effort: the bug is already raised either way,
  // so a failure here shouldn't fail the whole raise-bug action.
  let tmIssueRef = null;
  try {
    const issue = await tmFetch(`/obj/Issue/${encodeURIComponent(issueId)}`);
    tmIssueRef = issue?.response?.issueRef ?? null;
  } catch {
    tmIssueRef = null;
  }

  return { tmIssueId: issueId, tmIssueRef };
}

module.exports = {
  isConfigured,
  getOrganisationById,
  getActiveProjects,
  getAssignableUsers,
  createIssue,
  getIssueUrl,
  IMPACT_TO_SEVERITY,
};
