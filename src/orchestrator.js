const path = require('path');
const fs   = require('fs/promises');
const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');
const { crawlSite, normalizeUrl } = require('./crawler');
const { scanPageWithAxe } = require('./scanner');
const {
  setStatus,
  updateScanCounts,
  addPageResult,
  addError,
  isStopRequested,
} = require('./jobStore');

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

async function appendResult(scanId, result) {
  const processed = await Promise.all(
    result.findings.map((f) => processFinding(scanId, f))
  );
  await addPageResult(scanId, { ...result, findings: processed });
}

// ─── Job runner ───────────────────────────────────────────────────────────────

async function runJob(job) {
  const { id, input } = job;
  const browser       = await chromium.launch();
  const context       = await browser.newContext();
  const shouldStop    = () => isStopRequested(id);

  try {
    if (input.mode === 'crawl') {
      await setStatus(id, 'crawling');

      const { visitedUrls, errors } = await crawlSite(
        context,
        input.rootUrl,
        input.options || {},
        async ({ url, page }) => {
          await setStatus(id, 'scanning');
          const result = await scanPageWithAxe(page, url, {
            tags:               input.options?.tags,
            captureScreenshots: input.options?.captureScreenshots ?? false,
          });
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
          await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
          if (!shouldStop()) {
            const result = await scanPageWithAxe(page, url, {
              tags:               input.options?.tags,
              captureScreenshots: input.options?.captureScreenshots ?? false,
            });
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
}

module.exports = { runJob };
