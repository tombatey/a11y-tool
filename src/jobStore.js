const pool = require('./db');

// In-memory Set for fast synchronous stop checks — the DB flag persists
// across restarts but in-flight scans only need the in-memory read path.
const stopRequestedSet = new Set();

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rowToJob(row, findings = [], errors = []) {
  return {
    id:               row.id,
    status:           row.status,
    input:            row.input,
    pagesDiscovered:  row.pages_discovered,
    pagesScanned:     row.pages_scanned,
    stopRequested:    row.stop_requested,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
    findings:         findings.map(rowToFinding),
    errors:           errors.map((e) => ({ url: e.url, error: e.message })),
  };
}

function rowToFinding(row) {
  return {
    type:            row.type,
    source_tool:     row.source_tool,
    rule_id:         row.rule_id,
    wcag_tags:       row.wcag_tags,
    impact:          row.impact,
    description:     row.description,
    help:            row.help,
    help_url:        row.help_url,
    url:             row.url,
    target_selector: row.target_selector,
    breadcrumb:      row.breadcrumb,
    html_snippet:    row.html_snippet,
    failure_summary: row.failure_summary,
    location: {
      position:   row.location?.position ?? null,
      screenshot: row.screenshot_path
        ? `/api/screenshots/${row.screenshot_path}`
        : null,
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function createJob(input) {
  const res = await pool.query(
    `INSERT INTO scans (mode, input)
     VALUES ($1, $2)
     RETURNING *`,
    [input.mode, JSON.stringify(input)]
  );
  return rowToJob(res.rows[0]);
}

async function getJob(id) {
  const [scanRes, findRes, errRes] = await Promise.all([
    pool.query('SELECT * FROM scans WHERE id = $1', [id]),
    pool.query('SELECT * FROM findings WHERE scan_id = $1 ORDER BY created_at', [id]),
    pool.query('SELECT * FROM scan_errors WHERE scan_id = $1 ORDER BY created_at', [id]),
  ]);
  if (!scanRes.rows[0]) return null;
  return rowToJob(scanRes.rows[0], findRes.rows, errRes.rows);
}

async function listJobs() {
  const res = await pool.query(`
    SELECT s.*,
      COUNT(f.id)::int                                          AS findings_count,
      COUNT(CASE WHEN f.impact = 'critical' THEN 1 END)::int   AS critical_count,
      COUNT(CASE WHEN f.impact = 'serious'  THEN 1 END)::int   AS serious_count,
      COUNT(CASE WHEN f.impact = 'moderate' THEN 1 END)::int   AS moderate_count,
      COUNT(CASE WHEN f.impact = 'minor'    THEN 1 END)::int   AS minor_count
    FROM scans s
    LEFT JOIN findings f ON f.scan_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `);
  return res.rows.map((row) => ({
    id:              row.id,
    status:          row.status,
    input:           row.input,
    createdAt:       row.created_at,
    pagesDiscovered: row.pages_discovered,
    pagesScanned:    row.pages_scanned,
    findingsCount:   row.findings_count,
    severityCounts: {
      critical: row.critical_count,
      serious:  row.serious_count,
      moderate: row.moderate_count,
      minor:    row.minor_count,
    },
  }));
}

async function setStatus(id, status) {
  await pool.query(
    'UPDATE scans SET status = $1, updated_at = NOW() WHERE id = $2',
    [status, id]
  );
}

async function updateScanCounts(id, { pagesDiscovered }) {
  await pool.query(
    'UPDATE scans SET pages_discovered = $1, updated_at = NOW() WHERE id = $2',
    [pagesDiscovered, id]
  );
}

async function addPageResult(id, pageResult) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const f of pageResult.findings) {
      await client.query(
        `INSERT INTO findings
           (scan_id, url, type, source_tool, rule_id, wcag_tags, impact,
            description, help, help_url, target_selector, breadcrumb,
            html_snippet, failure_summary, location, screenshot_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          id,
          f.url,
          f.type,
          f.source_tool,
          f.rule_id,
          JSON.stringify(f.wcag_tags ?? []),
          f.impact,
          f.description,
          f.help,
          f.help_url,
          f.target_selector,
          JSON.stringify(f.breadcrumb ?? []),
          f.html_snippet,
          f.failure_summary,
          JSON.stringify(f.location ?? null),
          f.screenshot_path ?? null,
        ]
      );
    }
    await client.query(
      'UPDATE scans SET pages_scanned = pages_scanned + 1, updated_at = NOW() WHERE id = $1',
      [id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function addError(id, { url, error }) {
  await pool.query(
    'INSERT INTO scan_errors (scan_id, url, message) VALUES ($1, $2, $3)',
    [id, url ?? null, error]
  );
}

// Stop mechanism — hybrid: in-memory Set for synchronous reads by the crawler,
// PostgreSQL for persistence so the flag survives a server restart.
async function requestStop(id) {
  stopRequestedSet.add(id);
  await pool.query(
    'UPDATE scans SET stop_requested = TRUE, updated_at = NOW() WHERE id = $1',
    [id]
  );
}

function isStopRequested(id) {
  return stopRequestedSet.has(id);
}

module.exports = {
  createJob,
  getJob,
  listJobs,
  setStatus,
  updateScanCounts,
  addPageResult,
  addError,
  requestStop,
  isStopRequested,
};
