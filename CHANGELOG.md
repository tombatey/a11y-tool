# Changelog

All notable changes to the A11y Scanner are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/). Dates are in
`YYYY-MM-DD` format.

Add bullet points under `## [Unreleased]` as part of your feature/fix commits.
Keep each bullet to a single line — `scripts/promote.sh` stamps this section
with a version number and today's date when it merges `develop` into `main`,
then leaves `[Unreleased]` empty for the next cycle.

## [Unreleased]

## [0.6.0] - 2026-09-20

New feature - integration with Testing Manager

- Easily raise bugs in Testing Manager directly from A11y Scanner results.
- Once your organisation is connected, select a project from the dropdown when starting a scan.
- From results, group by issue and click Raise Bug - complete the modal to send the issue to Testing Manager.
- Bug includes all occurrences of that issue including URL and location.
- If needed, a CSV with all occurrences is automatically added to the bug as an attachment.
- Once raised, issue reference displayed in A11y Scanner.

## [0.5.0] - 2026-09-12

- New feature - ability to group findings that occur on each URL into a single issue containing all the URLs and locations where each occurrence is found. This condenses the results into an easier to read list of issues.
- New By issue tab switches the results of a scan to group occurrences by issue.
- When By issue is selected, click on an issue to expand and show all the occurrences of that issue.
- Updated filtering and severity counts when switching between By occurrence and By issue tabs.
- When expanding pages canned list, it is now possible to click on a page to show a filtered list of issues just for that page. Click the close icon next to the page chip to go back to all results.

## [0.4.1] - 2026-08-24

- Fixed PDF export showing "URL list (0 URLs)" as the target for sitemap-mode scans instead of the sitemap URL.

## [0.4.0] - 2026-08-20

- Added new method of starting a scan by scanning a sitemap to obtain list of URLs, including nested sitemaps.
- Results tidy-up to improve filtering of different results types, display accessibility pills for each A11y issue found, hide location column when filtering by CSS and HTML issue types and a few other fixes.

## [0.3.0] - 2026-08-10

- Add public `/changelog` page, version footer on every page, and an automatic Slack release announcement to `#webdepend-labs`.
- Ability to scan password-protected sites - basic auth (.htaccess style) for staging or test sites and login form access for live websites and web applications.

## [0.2.2] - 2026-08-04

- Improved CSV and PDF exports.

## [0.2.1] - 2026-07-20

- Styling updates.

## [0.2.0] - 2026-07-18

- Ability to rescan previous scans - prepopulates the scanner fields with the same URLs and settings as the past scan.
- Ability to export results by csv or pdf.

## [0.1.1] - 2026-07-17

- Scanned page list stored for reference during scanning or when viewing results.

## [0.1.0] - 2026-07-10

- Added HTML validation using Nu markup checker.
- Added CSS validation using W3C Compliance and linting.
- Google OAuth authentication for WebDepend team members.
- Full scan history with per-scan detail views.
- Severity and type filtering on results.
- All findings persisted to PostgreSQL database.

## [0.0.2] - 2026-07-04

- Proof of concept deployed to a11y.webdepend.dev.
- Ability to stop in progress scans.
- Ability to capture screenshots of issues.

## [0.0.1] - 2026-06-30

- Initial proof of concept.
