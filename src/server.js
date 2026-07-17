require('dotenv').config();
const express      = require('express');
const path         = require('path');
const session      = require('express-session');
const pgSession    = require('connect-pg-simple')(session);
const pool         = require('./db');
const { passport, requireAuth } = require('./auth');
const { createJob, getJob, listJobs, requestStop, getPages } = require('./jobStore');
const { runJob }   = require('./orchestrator');
const { generateReportHtml } = require('./report');

const app      = express();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const APP_URL  = process.env.APP_URL  || 'http://localhost:3000';

// Trust Caddy/nginx proxy so secure cookies work over HTTPS
app.set('trust proxy', 1);
app.use(express.json());

// ─── Session ──────────────────────────────────────────────────────────────────
app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: false }),
  secret:            process.env.SESSION_SECRET || 'change-me-in-production',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    maxAge:   30 * 24 * 60 * 60 * 1000, // 30 days
    secure:   APP_URL.startsWith('https'),
    httpOnly: true,
    sameSite: 'lax',
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// ─── Auth routes (public) ─────────────────────────────────────────────────────
app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=unauthorised' }),
  (_req, res) => res.redirect('/')
);

app.post('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/login');
  });
});

// ─── Static files — login page is public, everything else protected ───────────
app.use('/login.html', express.static(path.join(__dirname, '..', 'public')));
app.use(requireAuth);
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch {
    res.status(503).json({ ok: false, db: 'unavailable' });
  }
});

// ─── Screenshot serving ───────────────────────────────────────────────────────
app.use('/api/screenshots', express.static(path.join(DATA_DIR, 'screenshots')));

// ─── Current user ─────────────────────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  res.json({ email: req.user.email, name: req.user.name });
});

// ─── Team management ──────────────────────────────────────────────────────────
app.get('/api/users', async (_req, res) => {
  const result = await pool.query(
    'SELECT id, email, name, created_at, last_login FROM users ORDER BY created_at'
  );
  res.json(result.rows);
});

app.post('/api/users', async (req, res) => {
  const { email, name } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  try {
    const result = await pool.query(
      `INSERT INTO users (email, name) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, email, name, created_at`,
      [email.toLowerCase().trim(), name?.trim() || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ─── Scan API ─────────────────────────────────────────────────────────────────
app.post('/api/scan', async (req, res) => {
  const { mode, rootUrl, urls, options } = req.body || {};
  if (mode === 'crawl' && !rootUrl)
    return res.status(400).json({ error: 'rootUrl is required for crawl mode' });
  if (mode === 'list' && (!Array.isArray(urls) || urls.length === 0))
    return res.status(400).json({ error: 'urls array is required for list mode' });
  if (!['crawl', 'list'].includes(mode))
    return res.status(400).json({ error: "mode must be 'crawl' or 'list'" });

  const job = await createJob({ mode, rootUrl, urls, options });
  runJob(job).catch((err) => console.error(`Job ${job.id} failed:`, err));
  res.status(202).json({ jobId: job.id });
});

app.get('/api/scan/:id', async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.get('/api/scan/:id/pages', async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const pages = await getPages(req.params.id);
  res.json(pages);
});

// ─── PDF export ───────────────────────────────────────────────────────────────
app.get('/api/scan/:id/export/pdf', async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const pages = await getPages(req.params.id);

    const html    = generateReportHtml(job, pages);
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const page    = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({
      format:          'A4',
      printBackground: true,
      margin:          { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
    });
    await browser.close();

    const dateStr  = new Date(job.createdAt).toISOString().slice(0, 10);
    const filename = `webdepend-a11y-report-${dateStr}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    console.error('PDF export error:', err.message);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// ─── CSV export ───────────────────────────────────────────────────────────────
app.get('/api/scan/:id/export/csv', async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const input    = job.input || {};
    const target   = input.mode === 'crawl' ? input.rootUrl : `URL list (${(input.urls||[]).length} URLs)`;
    const dateStr  = new Date(job.createdAt).toISOString().slice(0, 10);

    const csvEscape = (val) => {
      const s = String(val ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const lines = [
      // Metadata header rows
      ['WebDepend Accessibility Report'],
      ['Scan Date', dateStr],
      ['Target',    target],
      ['Pages Scanned', job.pagesScanned],
      ['Total Findings', (job.findings || []).length],
      [],
      // Column headers
      ['URL', 'Impact', 'Type', 'Source Tool', 'Rule ID', 'Issue', 'Location', 'Help URL'],
      // Findings
      ...(job.findings || [])
        .sort((a, b) => ({ critical: 4, serious: 3, moderate: 2, minor: 1 }[b.impact] || 0)
                       - ({ critical: 4, serious: 3, moderate: 2, minor: 1 }[a.impact] || 0))
        .map(f => {
          const loc = f.location?.line
            ? `Line ${f.location.line}${f.location.column ? `, Col ${f.location.column}` : ''}`
            : (f.breadcrumb || []).slice(-3).join(' > ') || f.target_selector || '';
          return [f.url, f.impact, f.type, f.source_tool, f.rule_id, f.help || f.description, loc, f.help_url];
        }),
    ];

    const csv = lines.map(row => row.map(csvEscape).join(',')).join('\r\n');

    const filename = `webdepend-a11y-report-${dateStr}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8 compatibility
  } catch (err) {
    console.error('CSV export error:', err.message);
    res.status(500).json({ error: 'Failed to generate CSV' });
  }
});

app.post('/api/scan/:id/stop', async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!['queued', 'crawling', 'scanning'].includes(job.status))
    return res.status(400).json({ error: `Cannot stop a job with status: ${job.status}` });
  await requestStop(req.params.id);
  res.json({ ok: true });
});

app.get('/api/scans', async (_req, res) => {
  const jobs = await listJobs();
  res.json(jobs);
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT   = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`a11y-tool listening on ${APP_URL}`);
});

async function shutdown(signal) {
  console.log(`${signal} received — shutting down gracefully`);
  server.close(async () => { await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
