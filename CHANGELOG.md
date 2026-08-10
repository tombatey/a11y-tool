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
