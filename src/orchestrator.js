const path = require('path');
const fs   = require('fs/promises');
const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');
const { crawlSite, normalizeUrl } = require('./crawler');
const { scanPageWithAxe } = require('./scanner');
const { validateHtml }    = require('./validators/html');
const { validateCss }     = require('./validators/css');
const {
  setStatus,
  updateScanCounts,
  addPageResult,
  addError,
  getScanEmailData,
  isStopRequested,
} = require('./jobStore');
const { sendScanCompleteEmail } = require('./email');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

// ─── Screenshot persistence ───────────────────────────────────────────────────

async function saveScreenshot(scanId, base64DataUrl) {
  const filename = `${uuidv4()}.png`;
  const dir      = path.join(DATA_DIR, 'screenshots', scanId);
  await fs.mkdir(dir, { recursive: true });
  const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, '');
  await fs.writeFile(path.join(dir, filename), Buffer.from(base64, 'base64'));
  return `${scanId}/${filename}`;
}

// Separate screenshot from location position data, save file, return clean finding.
async function processFinding(scanId, finding) {
  const { location, ...rest } = finding;
  let screenshotPath = null;
  let positionData   = location?.position ?? null;

  if (location?.screenshot) {
    screenshotPath = await saveScreenshot(scanId, location.screenshot).catch(() => null);
  }

  return {
    ...rest,
    location:        positionData ? { position: positionData } : null,
    screenshot_path: screenshotPath,
  };
}

async function runAllValidators(page, url, options, seenStylesheets) {
  const tasks = [
    scanPageWithAxe(page, url, {
      tags:               options.tags,
      captureScreenshots: options.captureScreenshots ?? false,
    }),
  ];

  // HTML validation — requires vnu server running locally
  if (options.validateHtml) {
    tasks.push(
      page.content()
        .then((html) => validateHtml(html, url))
        .then((findings) => ({ findings, passes_count: 0, incomplete_count: 0, scanned_at: new Date().toISOString(), url }))
        .catch(() => ({ findings: [], url }))
    );
  }

  // CSS validation — deduplicated via seenStylesheets Set shared across pages
  if (options.validateCss) {
    tasks.push(
      validateCss(page, url, seenStylesheets)
        .then((findings) => ({ findings, passes_count: 0, incomplete_count: 0, scanned_at: new Date().toISOString(), url }))
        .catch(() => ({ findings: [], url }))
    );
  }

  const results = await Promise.all(tasks);

  return {
    url,
    findings:         results.flatMap((r) => r.findings || []),
    passes_count:     results[0]?.passes_count     ?? 0,
    incomplete_count: results[0]?.incomplete_count ?? 0,
    scanned_at:       results[0]?.scanned_at       ?? new Date().toISOString(),
  };
}

async function appendResult(scanId, result) {
  const processed = await Promise.all(
    result.findings.map((f) => processFinding(scanId, f))
  );
  await addPageResult(scanId, { ...result, findings: processed });
}

// ─── Job runner ───────────────────────────────────────────────────────────────

async function runJob(job) {
  const { id, input } = job;
  const opts          = input.options || {};
  const browser       = await chromium.launch();
  const context       = await browser.newContext();
  const shouldStop    = () => isStopRequested(id);

  // Tracks stylesheet URLs already validated — shared across all pages in this
  // scan so each external CSS file is only checked once, not once per page.
  const seenStylesheets = new Set();

  try {
    if (input.mode === 'crawl') {
      await setStatus(id, 'crawling');

      const { visitedUrls, errors } = await crawlSite(
        context,
        input.rootUrl,
        opts,
        async ({ url, page }) => {
          await setStatus(id, 'scanning');
          const result = await runAllValidators(page, url, opts, seenStylesheets);
          await appendResult(id, result);
        },
        shouldStop
      );

      await updateScanCounts(id, { pagesDiscovered: visitedUrls.length });
      for (const err of errors) await addError(id, err);

    } else if (input.mode === 'list') {
      await setStatus(id, 'scanning');

      for (const rawUrl of input.urls) {
        if (shouldStop()) break;
        const url  = normalizeUrl(rawUrl) || rawUrl;
        const page = await context.newPage();
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          if (!shouldStop()) {
            const result = await runAllValidators(page, url, opts, seenStylesheets);
            await appendResult(id, result);
          }
        } catch (err) {
          if (!shouldStop()) await addError(id, { url, error: err.message });
        } finally {
          await page.close().catch(() => {});
        }
      }
    } else {
      throw new Error(`Unknown job mode: ${input.mode}`);
    }

    await setStatus(id, shouldStop() ? 'stopped' : 'done');
  } catch (err) {
    await addError(id, { error: err.message }).catch(() => {});
    await setStatus(id, 'error').catch(() => {});
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  // Send completion notification — runs after browser is closed, never blocks
  getScanEmailData(id)
    .then(data => sendScanCompleteEmail(data))
    .catch(err => console.error('Notification error:', err.message));
}

module.exports = { runJob };
