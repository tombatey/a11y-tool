# CLAUDE.md — WebDepend A11y Tool

Internal accessibility scanning tool built for WebDepend. Crawls websites or
scans URL lists using axe-core, W3C Nu HTML validation, and CSS linting.
Results are stored in PostgreSQL and surfaced via a web UI. Deployed at
https://a11y.webdepend.dev (production) and https://staging.a11y.webdepend.dev.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 (CommonJS modules) |
| Web framework | Express 4 |
| Browser automation | Playwright + Chromium |
| Accessibility scanning | axe-core via `@axe-core/playwright` |
| HTML validation | W3C Nu checker (vnu.jar) running as local HTTP service on port 8888 |
| CSS validation | W3C CSS Validator public API + stylelint (programmatic) |
| Database | PostgreSQL 16 via `pg` (node-postgres) |
| Auth | Google OAuth 2.0 via `passport-google-oauth20` |
| Sessions | `express-session` + `connect-pg-simple` (sessions stored in PostgreSQL) |
| Email | Loops.so transactional API |
| PDF export | Playwright (renders HTML report to PDF server-side) |
| Process manager | PM2 |
| Reverse proxy | Caddy (handles SSL automatically) |

---

## Repository structure

```
a11y-tool/
├── src/
│   ├── server.js          # Express app — all API routes and middleware
│   ├── auth.js            # Passport Google OAuth config + requireAuth middleware
│   ├── db.js              # PostgreSQL connection pool (shared singleton)
│   ├── jobStore.js        # All database operations — the data layer
│   ├── orchestrator.js    # Scan job runner — ties crawler + validators together
│   ├── crawler.js         # BFS site crawler using Playwright
│   ├── scanner.js         # axe-core accessibility scanner
│   ├── authTarget.js      # Auth against the *scanned* site — basic auth + form login
│   ├── crypto.js          # AES-256-GCM helpers for encrypting stored auth passwords
│   ├── email.js           # Loops.so scan-complete notification
│   ├── report.js          # Self-contained HTML report generator for PDF export
│   ├── grouping.js        # Collapses same-issue findings across URLs into groups (see below)
│   ├── testingManager.js  # Testing Manager (Bubble) API client — see "Testing Manager integration" below
│   └── validators/
│       ├── html.js        # Posts rendered HTML to local vnu server, normalises findings
│       └── css.js         # Fetches stylesheets, runs W3C API + stylelint, deduplicates
├── public/
│   ├── index.html         # Main scanner UI (CSS variables, layout)
│   ├── app.js             # Main scanner frontend logic
│   ├── history.html       # Scan history — list and detail views
│   ├── groupsView.js      # Shared "By issue" grouped-results view (loaded by both pages above)
│   ├── login.html         # Google OAuth login page
│   ├── team.html          # Team management UI
│   ├── organisations.html # Testing Manager organisation linking UI (admin)
│   └── images/
│       └── webdepend-logo.png
├── db/
│   ├── schema.sql         # PostgreSQL schema — CREATE TABLE IF NOT EXISTS, safe to re-run
│   └── migrate.js         # Reads schema.sql and applies it; called by npm run db:migrate
├── scripts/
│   ├── setup.sh           # One-time server setup (Node, PostgreSQL, Caddy, PM2, Playwright)
│   ├── setup-staging.sh   # One-time staging environment setup on same Droplet
│   ├── deploy.sh          # Deploy to staging or production (usage: ./scripts/deploy.sh staging|production)
│   ├── promote.sh         # Merge develop → main + version tag before production deploy
│   ├── install-html-validator.sh  # Install Java + vnu.jar + systemd service
│   └── add-user.js        # CLI to add first user before anyone can log in
├── docs/
│   └── user-guide.md      # End-user guide for WebDepend team members
├── stylelint.config.js    # Minimal stylelint ruleset (errors only, no style preferences)
├── ecosystem.config.js    # PM2 config
├── docker-compose.yml     # Local dev with PostgreSQL
└── Dockerfile             # Uses mcr.microsoft.com/playwright/node:22-jammy
```

---

## Database schema

Eight tables in PostgreSQL. The schema is in `db/schema.sql` and is idempotent
(`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

```
scans           — one row per scan job
  id UUID PK, status, mode, input JSONB, pages_discovered, pages_scanned,
  stop_requested BOOL, started_by_email, organisation_id INT FK, tm_project_id,
  tm_project_name, created_at, updated_at

pages           — one row per page visited in a scan
  id SERIAL PK, scan_id UUID FK, url, findings_count, critical_count,
  serious_count, moderate_count, minor_count, scanned_at

findings        — one row per individual issue found
  id UUID PK, scan_id UUID FK, url, type, source_tool, rule_id, wcag_tags JSONB,
  impact, description, help, help_url, target_selector, breadcrumb JSONB,
  html_snippet, failure_summary, location JSONB, screenshot_path, created_at

scan_errors     — crawler/scan errors (page load failures etc.)
  id SERIAL PK, scan_id UUID FK, url, message, created_at

users           — Google accounts whitelisted to access the tool
  id SERIAL PK, email TEXT UNIQUE, name, created_at, last_login

organisations   — maps a display name to a Testing Manager organisation ID
  id SERIAL PK, name, tm_org_id TEXT UNIQUE, created_at

raised_bugs     — one row per Testing Manager bug raised from an issue group
  id SERIAL PK, scan_id UUID FK, group_key, tm_issue_id, tm_issue_ref,
  assigned_to_tm_id, assigned_to_name, raised_by_email, created_at
  UNIQUE (scan_id, group_key)

session         — express-session store (connect-pg-simple)
  sid VARCHAR PK, sess JSON, expire TIMESTAMP
```

### Finding schema (common across all validators)

All three scan types (accessibility, HTML, CSS) produce findings with this shape:

```javascript
{
  type:            'accessibility' | 'html-validation' | 'css-validation' | 'css-lint',
  source_tool:     'axe-core' | 'vnu' | 'w3c-css' | 'stylelint',
  rule_id:         string,
  wcag_tags:       string[],   // e.g. ['wcag2aa', 'wcag143'] — empty for HTML/CSS
  impact:          'critical' | 'serious' | 'moderate' | 'minor',
  description:     string,
  help:            string,     // human-readable issue description
  help_url:        string,     // link to documentation
  url:             string,     // page URL (or stylesheet URL for CSS findings)
  target_selector: string,     // CSS selector (accessibility) or CSS context (CSS findings)
  breadcrumb:      string[],   // DOM path segments — empty for HTML/CSS findings
  html_snippet:    string,     // affected HTML
  failure_summary: string,     // e.g. "Line 23, Col 10" for HTML/CSS
  location:        {           // for accessibility: position + screenshot
    position: { x, y, width, height, pageHeight, percentDown, aboveFold } | null,
    line:   number | null,     // for HTML/CSS findings
    column: number | null,
  },
  screenshot_path: string | null,  // relative path: "{scan_id}/{uuid}.png"
}
```

---

## Environment variables

All loaded via `dotenv` at startup from `.env` in the project root.

```
DATABASE_URL      PostgreSQL connection string (required)
PORT              HTTP port (default: 3000; staging uses 3001)
DATA_DIR          Directory for screenshot files (default: ./data)
APP_URL           Full public URL — used for OAuth callback and email links
GOOGLE_CLIENT_ID  Google OAuth client ID (from Google Cloud Console)
GOOGLE_CLIENT_SECRET  Google OAuth client secret
SESSION_SECRET    Random string for signing sessions (generate: openssl rand -hex 32)
CREDENTIALS_ENCRYPTION_KEY  32-byte hex key for encrypting target-site auth passwords at
                  rest (generate: openssl rand -hex 32). Required only if a scan is
                  submitted with basic-auth or login-form credentials — see "Scanning
                  password-protected sites" below.
VNU_URL           URL of the vnu HTML checker service (default: http://localhost:8888)
LOOPS_API_KEY     Loops.so API key (optional — notifications disabled if absent)
LOOPS_SCAN_COMPLETE_TEMPLATE_ID  Loops transactional template ID (optional)
TESTING_MANAGER_BASE_URL    Testing Manager Bubble API base — Live: https://testingmanager.co.uk/api/1.1
                  Development: https://testingmanager.co.uk/version-test/api/1.1
                  (staging uses Development, production uses Live — these are
                  separate databases with separate org/project/user IDs; optional
                  — organisation linking, project/user lookups, and "raise bug"
                  are disabled if absent; see "Testing Manager integration" below)
TESTING_MANAGER_API_TOKEN   Shared service-account bearer token for Testing Manager
                  (matching Live or Development per TESTING_MANAGER_BASE_URL above)
```

---

## Key patterns and conventions

### Job lifecycle

1. `POST /api/scan` creates a job via `jobStore.createJob()` and fires `orchestrator.runJob()` asynchronously (fire-and-forget)
2. Client polls `GET /api/scan/:id` every 1.5s — status progresses: `queued → crawling → scanning → done|stopped|error`
3. Stop mechanism: `POST /api/scan/:id/stop` sets `stopRequested = true` in both an in-memory Set (for fast synchronous reads by the crawler) and the database (for persistence)
4. After terminal state, `email.js` sends a Loops notification if configured

### Scan job flow (orchestrator.js)

```
runJob()
  → chromium.launch()
  → browser.newContext()        — httpCredentials set here if auth.type === 'basic'
  → performFormLogin()          — runs once if auth.type === 'form', before anything else;
                                   logs in using the same context the crawl/list loop reuses,
                                   so its session cookies carry over to every page load
  → crawlSite() or URL list loop
      → per page: runAllValidators(page, url, options, seenStylesheets)
          → scanPageWithAxe()        — runs if tags array is non-empty
          → validateHtml()           — runs if options.validateHtml
          → validateCss()            — runs if options.validateCss; uses seenStylesheets Set to skip already-validated stylesheets
      → appendResult()
          → processFinding()         — saves screenshots to DATA_DIR, strips base64 from findings
          → addPageResult()          — single DB transaction: insert page row + all findings
  → setStatus('done'|'stopped'|'error')
  → getScanEmailData() + sendScanCompleteEmail()
```

### Scanning password-protected sites

Two independent auth methods, submitted per-scan as `input.auth` alongside
`mode`/`rootUrl`/`urls`/`options` — there is no saved/reusable "site" entity;
credentials are entered fresh on every scan by design.

```javascript
auth: {
  type: 'none' | 'basic' | 'form',
  basic: { username, password },                    // HTTP Basic Auth (.htaccess-style)
  form: {                                            // application login form
    loginUrl, usernameSelector, passwordSelector, submitSelector,
    username, password,
    waitForSelector,                                 // optional — confirms login succeeded
  },
}
```

- **Basic auth** (`src/authTarget.js` `basicAuthContextOptions()`) becomes
  `httpCredentials` on `browser.newContext()` — applies to every request in
  that context, including the CSS validator's stylesheet fetches (see next
  point).
- **Form login** (`src/authTarget.js` `performFormLogin()`) opens a page in
  the shared context, fills `usernameSelector`/`passwordSelector` with plain
  CSS selectors, clicks `submitSelector`, waits for navigation (and
  `waitForSelector` if given), then closes the page. Any failure aborts the
  scan with a recorded error rather than proceeding unauthenticated. No
  support for 2FA, CAPTCHA, or multi-step logins — single form, single
  attempt.
- **`src/validators/css.js`** fetches external stylesheets via
  `page.request.get(url)` rather than a bare global `fetch()` specifically
  so those requests inherit the context's cookies/httpCredentials — a plain
  `fetch()` would 401 on a protected page even though the page itself
  loaded fine.
- **Encryption at rest**: `src/crypto.js` (AES-256-GCM,
  `CREDENTIALS_ENCRYPTION_KEY`) encrypts `auth.basic.password` /
  `auth.form.password` before `jobStore.createJob()` writes `scans.input`
  to Postgres. The job handed to `runJob()` is built from the original
  plaintext request, not read back from the DB, so the running scan never
  needs to decrypt anything. `jobStore.rowToJob()` / `listJobs()` redact
  both password fields (to `'••••••••'`) on every read — the poll endpoint
  and history page never receive a password back, plaintext or ciphertext.

### CSS stylesheet deduplication

A `seenStylesheets` Set is created once per scan job in `runJob()` and passed through to `validateCss()`. Each stylesheet URL is added to the Set after first validation — subsequent pages sharing the same stylesheet URL skip validation entirely. This prevents a shared `main.css` on 50 pages from generating 50× the CSS findings.

### Screenshot storage

Screenshots are base64 data URLs in-memory during scanning. `processFinding()` in `orchestrator.js` extracts them, saves as `{DATA_DIR}/screenshots/{scan_id}/{uuid}.png`, and stores only the relative path in the DB. The API reconstructs the full URL as `/api/screenshots/{path}` — served by `express.static` in `server.js`.

### Frontend architecture

Three pages (`index.html`, `history.html`, `team.html`) each contain their own full CSS in `<style>` and are self-contained. `app.js` drives `index.html`. `history.html` and `team.html` have their JS inline in `<script>` at the bottom. Each page's own logic (e.g. `typeGroup`/`renderLocation`) is duplicated rather than shared — the one exception is `groupsView.js` (and `version-footer.js`), a plain `<script src="...">` loaded by both `index.html` and `history.html`, no bundler involved.

CSS uses a set of CSS variables defined in each page's `:root` block using the WebDepend colour palette:
- `--ink: #014357` (Blue 900 — headings, button text)
- `--body: #334155` (Slate 700 — body text)
- `--paper: #F8FAFC` (Slate 50 — page background)
- `--line: #E2E8F0` (Slate 200 — borders)
- `--muted: #64748B` (Slate 500 — muted text)
- `--accent: #017CA1` (Blue 800 — links, active states)
- Primary button: `#02BFF8` bg (Blue 600), `#014357` text (Blue 900)

### Issue grouping ("By issue" view)

`src/grouping.js` collapses a scan's findings that represent the same underlying issue (found on multiple URLs/elements) into groups — this is what "Raise bug" (see "Testing Manager integration" below) raises one bug per, instead of one per occurrence. It's a pure function, `buildGroups(scanId, findings) -> groups[]`, computed on demand from the same `findings` rows `getJob()` already returns — no new table, no migration.

- **Grouping key**: axe-core, stylelint, and w3c-css *errors* have a genuinely stable `rule_id`, so those group by `rule_id` directly. vnu (HTML validation) and w3c-css *warnings* don't — vnu's `rule_id` is a slug of the entire free-text message (including the specific attribute/element it names), and every w3c-css warning shares the literal `rule_id` `'css-warning'`. For those, `grouping.js` normalizes the message (quoted/variable tokens → `"…"` placeholders) to recover a reusable template as the key, e.g. `Attribute "foo" not allowed on element "div"` and `Attribute "bar" not allowed on element "span"` both collapse to one group. Changing that normalization logic changes group identity for message-derived groups — relevant if a future feature ever persists state keyed by `group_key`.
- **`group_key` format**: `` `${scanId}|${type}|${source_tool}|${keyKind}:${keyValue}` `` — namespaced so nothing collides across scans/types/tools.
- **API**: `GET /api/scan/:id/groups` (in `server.js`) returns `{ scanId, status, groupCount, groups }`. Each group carries `occurrences[]` (url, target_selector, breadcrumb, html_snippet, failure_summary, location), the union of `wcag_tags`, worst `impact`, and distinct `urls`/`url_count`.
- **Frontend**: `public/groupsView.js`, a shared script loaded by both `index.html` and `history.html` (mirrors the `version-footer.js` pattern), renders group cards and owns all three filter dimensions together — `GroupsView.render(containerEl, scanId, { type, severities, url }, onCounts)`. `onCounts` reports per-severity *group* counts (not occurrence counts) back to the host page so its severity summary cards read correctly while "By issue" is selected. A `urlFilter` also narrows each shown group's own occurrence list/counts to just that URL, mirroring how the flat table hides non-matching rows outright.
- **Known gap**: CSS findings are keyed by their stylesheet's URL, not the page that referenced it (see "Known constraints and gotchas" below) — so a CSS group's `urls`/occurrences are stylesheet URLs, and filtering "By issue" to a specific *page* URL will never match a CSS group.

### Testing Manager integration

Lets a scan's issue groups (see "Issue grouping" above) be raised as bugs
directly in Testing Manager, a separate Bubble app (`testingmanager.co.uk`)
that WebDepend also uses for other internal tools. `webdepend-slack-app`'s
`services/testingManager.js` was the reference for the read-side API shape
(Data API — `GET`/`POST /obj/{Type}`); bug creation goes through
`testing-manager-bridge`'s pre-existing `/wf/create_ticket` workflow
(Workflow API), extended specifically for this integration with several new
parameters — see the payload table below.

Bubble keeps **Development** and **Live** as genuinely separate
environments — separate databases (so organisation/project/user unique_ids
never match across them) and separate publish state (a workflow change made
in the Bubble editor isn't live until explicitly deployed there). Staging's
`TESTING_MANAGER_BASE_URL` points at Development
(`.../version-test/api/1.1`); production points at Live (`.../api/1.1`).
Something that works on one and not the other is almost always an
environment mismatch (wrong org/project/user ID for that database, or a
workflow change not yet published to Live) rather than an a11y-tool bug —
check that before debugging the app code.

- **Organisations admin** (`public/organisations.html`, `/api/organisations`):
  a pure mapping table — an internal display name plus a Testing Manager
  organisation's Bubble `unique_id`. Adding one calls
  `testingManager.getOrganisationById()` first to catch a typo'd ID
  immediately rather than at scan time.
- **Scan setup**: `index.html`'s "Testing Manager" section lets you pick one
  of those organisations and then one of its **active** Testing Manager
  projects (`GET /api/organisations/:id/projects`, filtered to
  `projectStatus = 'Active'` — note the field name; it is *not* `status`).
  Both are optional — a scan started without them simply has no "Raise bug"
  action on its results. Selections persist on the `scans` row
  (`organisation_id`, `tm_project_id`, `tm_project_name`) via `createJob()`.
- **Raising a bug**: each group card in `groupsView.js`'s "By issue" view
  shows a "Raise bug" button — in its own fixed-width `.group-card-action`
  column, not flowing inline with the wrapping badges/title/tags, otherwise
  its position drifts card to card (that column needs `flex-basis: 0%`, not
  `auto`, or the sibling content's own unwrapped width pushes it onto a new
  line — see the code comment if this regresses) — when the scan has a
  `tm_project_id`, or a "Raised: BUG-123" badge that links to the bug
  (`testingManager.getIssueUrl()`) once one exists. The button opens a small
  self-contained modal whose CSS (including the button/badge/column styles
  every group card needs) is injected **eagerly at script load**, not
  lazily on first modal open — group cards render long before anyone opens
  the modal, so lazy injection left them unstyled until it had been opened
  once that page load. The modal is prefilled from the group:
  - **Title** — the group's title
  - **Description** — description/help text, labelled WCAG/category tags,
    a `Details:` link (`help_url`), and a full numbered occurrence list
    (URL + location) for every occurrence — see "Description/attachment
    budget" below for what happens when that doesn't fit
  - **Severity** — `IMPACT_TO_SEVERITY` maps axe-core impact to Testing
    Manager's severity option set (`critical→Critical`, `serious→Major`,
    `moderate→Minor`, `minor→Trivial`) — duplicated in both
    `src/testingManager.js` and `groupsView.js`, kept in sync manually.
    Confirmed against the real option set; still editable in the modal.
  - **Assign to** — from `GET /api/organisations/:id/users`

  Submitting posts to `POST /api/scan/:id/groups/:groupKey/raise-bug`, which
  resolves the group fresh from `grouping.js`'s `buildGroups()` (groups are
  never persisted — see "Issue grouping"), calls `testingManager.createIssue()`,
  and records the result in `raised_bugs`.
- **Description/attachment budget**: Testing Manager's Issue description has
  a 5,000-character hard limit. `groupsView.js`'s `buildRaiseBugDescription()`
  keeps a 4,800-character budget; if the full occurrence list doesn't fit,
  it truncates the inline list (with a note) and returns `truncated: true`.
  The modal sends that as `descriptionTruncated` on submit; when true,
  `server.js`'s route builds a CSV of the group's **complete, untruncated**
  occurrence data (`occurrenceCsv()` — URL, location, HTML snippet) and
  passes it to `createIssue()` as `attachment`, which Testing Manager stores
  as a `File`-type `Item` linked into the Issue's `issueItems` list.
- **Assignable users**: `testingManager.getAssignableUsers()` fetches all
  Testing Manager users with `isActive = true`, then filters in JS to
  `organisation === tmOrgId || isStaff(user)`, where "staff" means
  `admin === true || userRole === 'Tester'` — the same rule
  `webdepend-slack-app/services/auth.js`'s `isTMStaff` uses for "WebDepend,
  not a customer".
- **Idempotency**: `raised_bugs` has a `UNIQUE (scan_id, group_key)`
  constraint — the raise-bug route checks for an existing row first and
  returns 409 rather than ever double-raising the same group. Since
  `group_key` is the same content-derived string `grouping.js` computes (not
  a persisted group ID), the normalization-logic caveat in "Issue grouping"
  above applies here too: changing how `grouping.js` derives keys changes
  which future findings match an already-raised group.
- **Graceful degradation**: every Testing Manager route/action checks
  `testingManager.isConfigured()` first (`TESTING_MANAGER_BASE_URL` +
  `TESTING_MANAGER_API_TOKEN` both set) and returns 503 rather than a raw
  fetch failure if the integration isn't configured — the rest of the app
  (scanning, history, exports) works identically either way.

#### `/wf/create_ticket` payload (`src/testingManager.js`'s `createIssue()`)

This workflow predates this integration — it's shared with
`testing-manager-bridge`'s public bug-report widget, so everything below is
additive on top of the original contract and, with one exception noted
below, required nothing from the widget's existing calls to change.

| Param | Sent as | Notes |
|---|---|---|
| `assigned_to` | Bubble `User` unique_id | the modal's "Assign to" selection |
| `issue_category` | `'Accessibility'` (fixed) | every bug this integration raises is one; no per-call variation yet |
| `file` | `{ filename, contents, private: false }` \| `null` | **not** a `data:...;base64,...` string — confirmed against Bubble's own API docs after a data-URI string was silently stored as literal text instead of a real file. `contents` is base64 with no `data:` prefix |
| `filesize` | number (bytes) \| `null` | the *raw* attachment's byte length, not the ~33% larger base64-encoded length — Testing Manager sets `Item Filesize` from this directly |
| `steps`, `screenshot`, `browser`, `os`, `screen` | always `null` | required parameters on this workflow that this integration has no value for. Bubble's Workflow API needs the *key* present even when the value is `null` (`MISSING_DATA` otherwise) — sending these as explicit `null` (not omitting them) was the fix |

`raisedBy` is **not** a parameter here — Testing Manager's workflow sets it
internally to a fixed "system user" record. That user's ID is
environment-specific (see the Development/Live note above), so a `raisedBy`
that works on one environment and not the other means that workflow step is
pointed at the wrong environment's user, not something to fix in this repo.

Two Bubble Workflow API behaviours worth remembering if this workflow
changes again: a **required** parameter only needs its *key* present in the
request body — the value itself can be `null`. A new **optional** parameter
is safe to add without breaking existing callers, but if the step consuming
it is conditioned on the wrong thing (`assigned_to`/`issue_category`
briefly only ran when `file` was also present, since they'd been added to
the same conditional step), it'll silently no-op for every call that
doesn't also satisfy that other condition — test a new parameter both with
and without the others present, not just in isolation.

### API conventions

All API routes are in `server.js`. Protected by `requireAuth` middleware (placed before `express.static`). Public routes: `/login`, `/auth/google`, `/auth/google/callback`, `/auth/logout`.

API returns JSON. Scan results are returned with the full findings array on every poll — no pagination currently. For scans with many findings this is acceptable given the internal-tool context. `GET /api/scan/:id/groups` is the one exception to "just returns what's in the DB" — see "Issue grouping" above.

---

## Common commands

```bash
# Local development
npm install
npm run db:migrate
npm start

# Deploy
./scripts/deploy.sh staging      # deploy current branch to staging
./scripts/deploy.sh production   # deploy main branch to production

# Release workflow
./scripts/promote.sh             # merge develop → main, create version tag
./scripts/deploy.sh production

# Database migrations (run automatically by deploy.sh)
npm run db:migrate

# Add a user from the server command line
node scripts/add-user.js email@webdepend.co.uk "Full Name"

# Check vnu HTML validator status
systemctl status vnu
journalctl -u vnu -n 20

# Check running app processes
pm2 list
pm2 logs a11y-tool --lines 50
pm2 logs a11y-tool-staging --lines 50
```

---

## Deployment

**Server:** DigitalOcean Droplet, Ubuntu 24.04, 104.248.164.90
**Production:** `/var/www/a11y-tool` — PM2 process `a11y-tool` — port 3000
**Staging:** `/var/www/a11y-tool-staging` — PM2 process `a11y-tool-staging` — port 3001
**Caddy:** routes `a11y.webdepend.dev` → 3000, `staging.a11y.webdepend.dev` → 3001
**Screenshots:** production at `/var/data/a11y-tool/screenshots/`, staging at `/var/data/a11y-tool-staging/screenshots/`
**vnu:** systemd service `vnu.service`, started with `java -Xss32m -cp /opt/vnu/vnu.jar nu.validator.servlet.Main 8888`

---

## Git branching

```
main      → production (a11y.webdepend.dev)
develop   → staging (staging.a11y.webdepend.dev)
feature/* → merge into develop when done
```

Full workflow:
1. `git checkout -b feature/name develop`
2. Do work, commit
3. `git checkout develop && git merge feature/name && git push origin develop`
4. `git branch -d feature/name && git push origin --delete feature/name`
5. `./scripts/deploy.sh staging` — test
6. `./scripts/promote.sh` — merge to main + tag
7. `./scripts/deploy.sh production`

---

## Known constraints and gotchas

- **vnu.jar requires `-Xss32m`** — the HTML5 schema has very deep recursion that causes StackOverflowError with the default or smaller stack sizes. The systemd service is configured with this flag.
- **Crawler uses `domcontentloaded` not `networkidle`** — many real sites never reach networkidle due to analytics, chat widgets, and polling scripts, causing 30-second timeouts. domcontentloaded is sufficient for axe-core and vnu since they only need the DOM.
- **BFS crawl depth limits** — the crawler queues links as it processes pages. Blog posts and articles tend to be discovered late in BFS order. If important pages are missing, increase maxPages or use URL list mode with the client's sitemap.
- **CSS findings deduplication** — stylesheets are only validated once per scan. If a stylesheet URL changes between pages (e.g. cache-busted filenames), it will be validated each time.
- **Screenshots are stored on disk, not in the DB** — the DB stores only the relative path. If `DATA_DIR` changes, existing screenshot references break. Never move `DATA_DIR` without updating existing paths.
- **In-memory stop flag** — `isStopRequested()` reads from an in-memory Set for synchronous access by the crawler. If the server restarts mid-scan, the in-memory flag is lost but the DB flag persists. Scans in progress when the server restarts will be stuck in `scanning` status in the DB — update manually if needed: `UPDATE scans SET status = 'error' WHERE status IN ('crawling','scanning')`.
- **Sessions in PostgreSQL** — clearing the `session` table logs everyone out.
- **`stylelint-config-standard` is intentionally NOT used** — `stylelint.config.js` uses a minimal custom ruleset of genuine errors only. Do not switch to `stylelint-config-standard` as it generates thousands of formatting warnings per stylesheet.
- **PDF export launches a second Chromium instance** — do not run PDF exports during large crawl scans on the same server; it can cause memory pressure on the 2GB Droplet.
- **Form login has no retry and no MFA support** — one attempt at filling and submitting the configured selectors; a wrong selector, a CAPTCHA, or a 2FA step all fail the scan the same way (recorded as a scan error, status `error`). Re-check selectors with DevTools if a form-login scan keeps failing.
- **`CREDENTIALS_ENCRYPTION_KEY` must be set before any basic-auth/form-login scan is submitted** — `src/crypto.js` throws immediately if it's missing or not a 32-byte hex string. It is not required for scans that don't use `auth`.
- **Target-site credentials are never reusable** — by design there's no saved "site" record; every scan against a protected target needs its credentials/selectors re-entered.
- **`findings.url` means "the page" for accessibility/HTML but "the stylesheet" for CSS** — `css.js` sets a CSS finding's `url` to the stylesheet resource it validated (or `{pageUrl}#inline-style-N` for inline `<style>` blocks), not the page(s) that reference it. Any code that filters/groups findings by exact URL match (the "pages scanned" panel, the URL filter chip, `grouping.js`'s per-group `urls`) therefore never attributes a CSS finding to a specific page. `app.js`/`history.html` recompute the pages panel's displayed counts client-side from this same exact-match rule (rather than trusting the scan-time pre-aggregated `pages.findings_count`, which does fold CSS findings into a page's count) specifically so the panel doesn't show numbers the URL filter then can't reproduce — but this means the pages panel's counts and the CSV/PDF export's "Pages Scanned" section (still built server-side from the original `pages.findings_count`) can now disagree for pages with CSS issues. Fixing that fully would mean tracking which page a CSS finding was discovered via as a separate field from its own resource URL — not implemented.
