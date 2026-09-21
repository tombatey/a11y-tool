# WebDepend Accessibility Scanner — User Guide

**Tool URL:** https://a11y.webdepend.dev

---

## Contents

1. [Getting access](#1-getting-access)
2. [Running a scan](#2-running-a-scan)
3. [Scan options explained](#3-scan-options-explained)
4. [Understanding results](#4-understanding-results)
5. [Filtering results](#5-filtering-results)
6. [Scan history](#6-scan-history)
7. [Re-scanning](#7-re-scanning)
8. [Exporting results](#8-exporting-results)
9. [Raising bugs in Testing Manager](#9-raising-bugs-in-testing-manager)
10. [Team management](#10-team-management)
11. [Tips and best practices](#11-tips-and-best-practices)

---

## 1. Getting access

The scanner is restricted to WebDepend team members.

1. Go to **https://a11y.webdepend.dev**
2. Click **Sign in with Google**
3. Use your **@webdepend.co.uk** Google Workspace account

If you see an "not authorised" error, ask an existing team member to add you via the Team page (see [Team management](#10-team-management)).

---

## 2. Running a scan

The scanner has two modes — choose based on what you need.

### Crawl a site

Use this when you want the scanner to automatically discover and scan all pages on a site.

1. Select **Crawl a site**
2. Enter the **Site root URL** (e.g. `https://example.com`)
3. Set **Max pages** — how many pages to scan at most (default: 50)
4. Set **Max depth** — how many links deep to follow from the homepage (default: 3)
5. Configure your scan options (see [Section 3](#3-scan-options-explained))
6. Click **Start scan**

> **Note:** The crawler follows links within the same domain only. It skips PDFs, images, and other non-HTML files. If a site has many pages, increase Max pages accordingly — the default of 50 may not cover everything.

### Scan a URL list

Use this when you have a specific set of pages to check — for example, after a client provides a list of key pages, or when re-testing pages after fixes have been applied.

1. Select **Scan a URL list**
2. Paste your URLs into the text area, **one per line**
3. Configure your scan options
4. Click **Start scan**

### During a scan

- The status line below the Start button shows live progress
- Scans run independently of the browser — you can navigate away and the scan will continue
- You will receive an **email notification** when the scan completes
- To stop a running scan early, click **Stop scan**

---

## 3. Scan options explained

### WCAG Compliance Level

Selects which accessibility standard to test against. You can select multiple levels — each level includes the rules from levels below it.

| Tag | Standard | Use when |
|-----|----------|----------|
| **wcag2a** | WCAG 2.0 Level A | Minimum baseline — most fundamental requirements |
| **wcag2aa** | WCAG 2.0 Level AA | Legal requirement in most jurisdictions — recommended minimum |
| **wcag21aa** | WCAG 2.1 Level AA | Current widely-adopted standard — recommended default |
| **wcag22aa** | WCAG 2.2 Level AA | Latest standard — includes mobile-related criteria |
| **wcag2aaa** | WCAG 2.0 Level AAA | Strictest level — often aspirational rather than required |

**Recommended starting point:** wcag2a + wcag2aa + wcag21aa (the defaults).

### Additional checks

| Option | What it checks |
|--------|---------------|
| **best-practice** | Axe-core best practices — issues that aren't WCAG failures but represent poor accessibility practice |
| **experimental** | Axe-core experimental rules — newer rules still being validated; may produce more false positives |

### Validation

| Option | What it checks | Notes |
|--------|---------------|-------|
| **HTML validation** | Page markup against the W3C HTML standard | Catches malformed HTML, invalid attributes, missing required elements |
| **CSS validation** | Stylesheet compliance with W3C CSS spec + common coding issues | Checks external stylesheets and inline `<style>` blocks; each stylesheet is only validated once per scan even if shared across many pages |

### Options

| Option | What it does | When to use |
|--------|-------------|-------------|
| **Capture element screenshots** | Takes a screenshot of each affected element | Adds time to the scan — most useful for URL list scans where you want detailed evidence for a report |

> **Scan time:** Accessibility-only scans are typically fastest. Adding HTML/CSS validation adds moderate time. Element screenshots add the most time per page.

---

## 4. Understanding results

Once a scan completes, results appear in the Results panel.

### Summary cards

Six cards show at a glance:

- **Pages scanned** — total pages visited
- **Total findings** — all issues across all check types
- **Critical / Serious / Moderate / Minor** — breakdown by severity

### Two ways to view results: By occurrence vs By issue

A toggle above the results — **By occurrence** / **By issue** — switches between two ways of looking at the same findings:

- **By occurrence** (the default) — a flat table, one row per individual finding. This is the classic view described below.
- **By issue** — the same findings collapsed into one card per *distinct issue*, each listing every URL and location it was found at (e.g. "Select element must have an accessible name — 3 occurrences across 3 URLs"). This makes it much easier to see how widespread a single problem is across a site, instead of scrolling past the same issue repeated once per page. It's also where you raise bugs in Testing Manager — one per issue, rather than one per occurrence — see [Section 9](#9-raising-bugs-in-testing-manager).

Both views share the same severity, check-type, and page filters (see [Section 5](#5-filtering-results)) — switching between them keeps whatever filters are active. The severity summary cards adapt too: in **By occurrence** they count individual findings; in **By issue** they count distinct issues instead, so the numbers can look quite different between the two views for the same scan (e.g. one issue occurring on 30 pages counts as 30 in By occurrence but just 1 in By issue).

Click a group card in **By issue** to expand it and see every occurrence's URL, location, and a snippet of the affected HTML/CSS.

For accessibility (axe-core) and CSS-lint (stylelint) issues, grouping is based on the specific rule that was violated. HTML validation and general CSS validation issues don't have a stable rule identifier, so they're grouped by matching the underlying message template — e.g. `Attribute "foo" not allowed on element "div"` and `Attribute "bar" not allowed on element "span"` are recognised as the same kind of issue and grouped together.

### Findings table

Each row is one issue found on one page. The columns are:

| Column | Description |
|--------|-------------|
| **Impact** | Severity — Critical, Serious, Moderate, or Minor |
| **Rule** | The specific rule that was violated, with the check type badge (A11Y / HTML / CSS) |
| **URL** | The page where the issue was found |
| **Location** | Where on the page — DOM breadcrumb path and above/below-fold indicator for accessibility issues; line/column number for HTML and CSS issues |
| **Issue** | Plain-language description of the problem, with a **details** link to full documentation, and WCAG tag pills (WCAG 2.0 A/AA, Best Practice, etc.) for accessibility findings |

> The **By issue** view shows the same WCAG tag pills on each group card, and a URL/Location/Snippet table for its occurrences when expanded — see above.

### What the severity levels mean

| Level | Meaning | Priority |
|-------|---------|----------|
| **Critical** | Completely blocks access for some users — e.g. images with no alt text, form inputs with no label | Fix immediately |
| **Serious** | Significant barrier — e.g. insufficient colour contrast, missing button text | Fix before launch |
| **Moderate** | Meaningful inconvenience — e.g. missing landmark regions, redundant alt text | Fix in next sprint |
| **Minor** | Small improvement — e.g. decorative images not hidden from screen readers | Fix when convenient |

### Location information

For **accessibility findings**, the location column shows:
- A breadcrumb path through the DOM (e.g. `main › nav › a`) — the last segment is the affected element
- Whether the element is **above fold** or **below fold**, and how far down the page it sits as a percentage

For **HTML and CSS findings**, the location shows the line and column number within the source file.

If element screenshots were enabled, a thumbnail of the affected element appears above the breadcrumb. Click to enlarge.

---

## 5. Filtering results

Severity, check-type, and page filters all work the same way in both the **By occurrence** and **By issue** views (see [Section 4](#4-understanding-results)) — they combine, and switching the view keeps every filter you've set.

### Filter by severity

Click any of the four severity cards (Critical / Serious / Moderate / Minor) to filter the results:

- **First click** — isolates to that severity only
- **Second click on same card** — resets to show all
- **Click a different card while filtered** — shows both severities

In **By issue**, this filters which issue cards are shown by their worst impact; the numbers on the cards themselves always show the full count for each severity (among whatever check type/page is currently selected) regardless of which one is isolated, so you can see at a glance how many of each severity exist before picking one.

### Filter by check type

If a scan includes multiple check types (e.g. accessibility + HTML validation), a row of type filter buttons appears above the summary cards:

- **All** — show everything
- **A11Y** — accessibility findings only
- **HTML** — HTML validation findings only
- **CSS** — CSS validation findings only

### Filter by page

Click **Show pages scanned** to expand the pages panel. Clicking any URL row:

- Filters the results to just that page
- Switches to the **By occurrence** view (the clearest way to see everything on one page) — you can still switch to **By issue** afterwards and the page filter carries over, narrowing each issue card to just that page's occurrences
- Closes the pages panel, and shows the selected URL as a small chip above the results — click its **×** to clear the filter

> **CSS issues and page filtering:** CSS findings belong to the stylesheet they were found in, not a specific page, so they can never match a page filter — filtering to a page only ever shows that page's accessibility/HTML issues. The pages panel shows a note about this (and the per-page severity counts only include accessibility/HTML issues) whenever the scan has CSS results. Use the **CSS** check-type filter instead to see all CSS issues regardless of page.

### No results?

If a combination of filters excludes every finding, the results area shows **"No findings match the current filters"** (By occurrence) or **"No issues match this filter"** (By issue) instead of an empty table — try widening the check type, severity, or page filter.

---

## 6. Scan history

Click **History** in the top navigation to view all past scans.

### The scan list

Each row shows:
- Date and time
- Mode (Crawl or URL List) and target URL
- Status (Done, Stopped, Error)
- Pages scanned
- Findings breakdown by severity

### Viewing a past scan

Click **View results** on any scan to open the full detail view, which shows:
- Scan metadata (date, target, mode, WCAG tags, status)
- The same summary cards, type filters, pages panel, and findings table as a live scan
- Export buttons for PDF and CSV

---

## 7. Re-scanning

From any scan's detail view in History, two re-scan options appear in the metadata card:

### ↻ Re-scan

Loads the scanner form pre-filled with the exact same settings as the original scan — same mode (crawl or URL list), same URLs, same WCAG tags, and same options. You can review and adjust before starting.

### ↻ Re-scan URLs *(crawl scans only)*

Converts the crawl's discovered page list into a URL list scan using the same tags and options. Useful for iterative testing — crawl once to discover all pages, then repeatedly re-scan just those specific URLs as fixes are applied, without the overhead of re-crawling each time.

After clicking either option, you are taken to the Scanner page with all fields pre-filled. A blue banner at the top confirms which scan the settings were loaded from. You can modify any setting before clicking Start scan.

---

## 8. Exporting results

Both export options are available from the findings panel (after a live scan completes) and from any scan detail view in History.

> Exports always use the full flat findings list (the **By occurrence** view), regardless of which view or filters you currently have selected on screen — they are not grouped by issue.

### Export PDF

Generates a professionally formatted report suitable for sharing with clients. The PDF contains:

- **Scan Details** — target, date, mode, WCAG tags, pages scanned, status
- **Summary** — findings count by severity and by check type
- **Pages Scanned** — all URLs visited, with severity breakdown per page; URLs link to the live page, severity counts link to the findings section
- **Findings** — full findings table sorted by severity, with "details" links to documentation

The WebDepend logo links to webdepend.co.uk and the footer links to webdepend.dev.

> PDF generation takes a few seconds as it renders using a headless browser.

### Export CSV

Generates a structured spreadsheet suitable for importing into Excel, Google Sheets, or data analysis tools. The CSV contains the same sections as the PDF:

- Scan details metadata
- Severity summary
- Check type summary
- Pages scanned with per-page severity counts
- Full findings list with all columns (URL, Impact, Type, Source Tool, Rule ID, Issue, Location, Help URL)

The CSV uses UTF-8 with a BOM so it opens correctly in Excel without encoding issues.

---

## 9. Raising bugs in Testing Manager

A11y Scanner can raise bugs directly in Testing Manager from your scan results, so you don't have to manually copy issue details across.

### 9.1 Linking an organisation (one-off admin setup)

Before a client's scans can raise bugs, their organisation needs linking to Testing Manager. This only needs doing once per client.

1. Click **Organisations** in the top navigation
2. Enter a **Name** (for your own reference in A11y Scanner)
3. Enter the client's **Testing Manager organisation ID** (found on their organisation record in Testing Manager)
4. Click **Add organisation**

> A11y Scanner checks the ID against Testing Manager before saving, so a typo is caught immediately rather than failing later when someone tries to raise a bug.

### 9.2 Selecting a project when starting a scan

In the scan form, under **Testing Manager**:

1. Choose the client's **Organisation** from the dropdown
2. Once selected, choose the **Project** to raise bugs into — only that organisation's active Testing Manager projects are listed

Both fields are optional. If you skip them, the scan runs normally but won't offer **Raise bug** on its results — useful for exploratory scans, or sites that don't have a Testing Manager project set up yet.

### 9.3 Raising a bug from results

Once a scan with an organisation and project selected has completed:

1. Switch to the **By issue** view (see [Section 4](#4-understanding-results))
2. Click **Raise bug** on the issue you want to report — it sits in its own column on the right of each issue card
3. Review the pre-filled modal:

| Field | Pre-filled with | Editable? |
|-------|-----------------|-----------|
| **Title** | The issue's title | Yes |
| **Description** | The issue summary, relevant WCAG/category tags, a details link, and a full list of every URL and location the issue occurs at | Yes |
| **Severity** | Mapped from the issue's impact level (Critical → Critical, Serious → Major, Moderate → Minor, Minor → Trivial) | Yes |
| **Assign to** | Not pre-filled | Choose from active users who belong to the client's organisation, or WebDepend staff |

4. Click **Raise bug**

Once raised, the button is replaced with a **Raised: BUG-123** badge — click it to open the bug directly in Testing Manager. Each issue can only be raised once per scan; the button doesn't reappear afterwards.

> **Large issues:** if an issue occurs across many pages, the full list of URLs and locations may be too long to fit in Testing Manager's description field. When that happens, A11y Scanner automatically attaches the complete list as a CSV file on the bug instead, and the description notes that it's attached.

---

## 10. Team management

Click **Team** in the top navigation to manage who can access the scanner.

### Adding a team member

1. Enter their **@webdepend.co.uk** Google Workspace email
2. Enter their full name
3. Click **Add team member**

They will be able to sign in immediately with their Google account.

### Removing a team member

Click **Remove** on the right side of any team member row. They will lose access immediately. A confirmation prompt appears before removal.

> You cannot remove yourself.

---

## 11. Tips and best practices

### When to use Crawl vs URL list

| Situation | Recommended mode |
|-----------|-----------------|
| First scan of a new client site | **Crawl** — to discover all pages |
| Re-testing after fixes | **URL list** (use Re-scan URLs) — faster, targets known pages |
| Client provides a list of key pages | **URL list** |
| Site has very deep link structure | **URL list** with sitemap from client |
| Quick spot-check of a specific page | **URL list** with a single URL |

### Getting the most out of the crawler

- If the site has more pages than the default limit (50), increase **Max pages** before scanning
- If important pages are buried deep in the site structure, increase **Max depth** beyond 3
- Blog posts and articles are often discovered late in a crawl — if they are missing, use URL list mode with the full page list from the client's sitemap or Google Search Console

### Choosing WCAG levels for a client

- For most web projects, **wcag2a + wcag2aa + wcag21aa** is the right choice — it reflects current legal standards in the UK and EU
- Add **wcag22aa** if the client wants to target the very latest standard or their audience includes mobile users as a priority
- Avoid **wcag2aaa** for standard audits — it sets requirements few sites can fully meet and may overwhelm the report with findings the client cannot reasonably address

### Interpreting colour contrast findings

Colour contrast findings (`color-contrast`) are the most common result and are always classified as **Serious**. They are worth prioritising because:
- They directly affect users with low vision
- They are straightforward to fix (adjust colours in CSS)
- They are one of the most frequently cited accessibility failures in legal cases

### Element screenshots

Enable **Capture element screenshots** when:
- Producing a client-facing report where visual evidence helps explain findings
- Investigating ambiguous selectors where the DOM path alone is unclear

Leave it off for large crawl scans — it adds significant time per page.

### Sharing results with clients

- Use **Export PDF** for the formal deliverable — it includes your WebDepend branding and is self-contained
- Use **Export CSV** if the client wants to import findings into their own project tracking tool
- The direct link to a scan (e.g. `https://a11y.webdepend.dev/history.html?id=...`) is not accessible to clients since the tool is login-protected — always export before sharing

---

*For tool access issues or questions, contact the WebDepend team.*
