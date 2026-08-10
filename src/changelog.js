// src/changelog.js
// Parses CHANGELOG.md into structured release data. Deliberately a small
// regex/line-scan parser rather than a markdown dependency — the file's
// format is constrained to "## [X.Y.Z] - YYYY-MM-DD" headings with plain
// "- " bullets underneath, so a full markdown parser isn't needed.

const fs = require('fs');
const path = require('path');

const CHANGELOG_PATH = path.join(__dirname, '..', 'CHANGELOG.md');

// Matches "## [1.2.3] - 2026-08-07" — captures version + date.
const RELEASE_HEADING_RE = /^##\s*\[(\d+\.\d+\.\d+)\]\s*-\s*(\d{4}-\d{2}-\d{2})\s*$/;
const UNRELEASED_HEADING_RE = /^##\s*\[Unreleased\]\s*$/i;

// Parses raw CHANGELOG.md text into an array of releases, newest first
// (matches how the file is written — new releases are inserted highest).
// Bullets under "## [Unreleased]" are intentionally not captured into any
// release object, so unreleased notes never leak onto the public page.
function parseChangelog(raw) {
  const lines = raw.split(/\r?\n/);
  const releases = [];
  let current = null;
  let inUnreleased = false;

  for (const line of lines) {
    if (UNRELEASED_HEADING_RE.test(line)) {
      if (current) releases.push(current);
      current = null;
      inUnreleased = true;
      continue;
    }

    const releaseMatch = line.match(RELEASE_HEADING_RE);
    if (releaseMatch) {
      if (current) releases.push(current);
      current = { version: releaseMatch[1], date: releaseMatch[2], notes: [] };
      inUnreleased = false;
      continue;
    }

    if (/^##\s/.test(line)) {
      // Any other level-2 heading (e.g. malformed) ends whatever we were capturing.
      if (current) releases.push(current);
      current = null;
      inUnreleased = false;
      continue;
    }

    if (inUnreleased) continue;

    const bulletMatch = line.match(/^-\s+(.*\S)\s*$/);
    if (bulletMatch && current) {
      current.notes.push(bulletMatch[1]);
    }
  }

  if (current) releases.push(current);
  return releases;
}

function readChangelog() {
  const raw = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  return parseChangelog(raw);
}

function getLatestRelease() {
  const releases = readChangelog();
  return releases[0] || null;
}

module.exports = { CHANGELOG_PATH, parseChangelog, readChangelog, getLatestRelease };
