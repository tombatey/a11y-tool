// Authentication against the *scanned* site (staging .htaccess protection,
// application login forms) — not to be confused with src/auth.js, which is
// this app's own Google OAuth login gating who may use the tool.

// Basic auth: returned options are merged into browser.newContext(). Applies
// to every request made in that context, including the crawler's page loads
// and the CSS validator's stylesheet fetches (see validators/css.js).
function basicAuthContextOptions(auth) {
  return {
    httpCredentials: {
      username: auth.username,
      password: auth.password,
    },
  };
}

// Form login: runs once, before the crawl/list loop starts, using the same
// BrowserContext the scan will go on to use — so the session cookies set by
// a successful login are already present for every page load that follows.
// Throws a descriptive error on any failure; the caller should record it as
// a scan error and abort rather than proceeding to crawl unauthenticated.
async function performFormLogin(context, form) {
  const {
    loginUrl,
    usernameSelector,
    passwordSelector,
    submitSelector,
    username,
    password,
    waitForSelector,
  } = form;

  const page = await context.newPage();
  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForSelector(usernameSelector, { timeout: 10000 })
      .catch(() => { throw new Error(`Login failed: username field not found (selector: ${usernameSelector})`); });
    await page.fill(usernameSelector, username);

    await page.waitForSelector(passwordSelector, { timeout: 10000 })
      .catch(() => { throw new Error(`Login failed: password field not found (selector: ${passwordSelector})`); });
    await page.fill(passwordSelector, password);

    await page.waitForSelector(submitSelector, { timeout: 10000 })
      .catch(() => { throw new Error(`Login failed: submit button not found (selector: ${submitSelector})`); });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null),
      page.click(submitSelector),
    ]);

    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 15000 })
        .catch(() => { throw new Error(`Login failed: success element not found after submit (selector: ${waitForSelector}) — check your credentials and selectors`); });
    }
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { basicAuthContextOptions, performFormLogin };
