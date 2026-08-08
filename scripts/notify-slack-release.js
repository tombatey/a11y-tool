#!/usr/bin/env node
// scripts/notify-slack-release.js
// Posts the latest CHANGELOG.md entry to WebDepend's #webdepend-labs Slack
// channel via an Incoming Webhook. Run locally after a production deploy —
// invoked automatically by `scripts/deploy.sh production`.
//
// Requires SLACK_RELEASE_WEBHOOK_URL in .env (see README for setup). If it's
// not set, this exits 0 (not a failure) so it's always safe to call from deploy.sh.

require('dotenv').config();
const { version: pkgVersion } = require('../package.json');
const { getLatestRelease } = require('../src/changelog');

async function main() {
  const webhookUrl = process.env.SLACK_RELEASE_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('⚠  SLACK_RELEASE_WEBHOOK_URL is not set — skipping Slack announcement.');
    process.exit(0);
  }

  let latest;
  try {
    latest = getLatestRelease();
  } catch (err) {
    console.warn('⚠  Could not read CHANGELOG.md — skipping Slack announcement.');
    process.exit(0);
  }

  if (!latest) {
    console.warn('⚠  No releases found in CHANGELOG.md — skipping Slack announcement.');
    process.exit(0);
  }

  if (latest.version !== pkgVersion) {
    console.warn(
      `⚠  CHANGELOG.md latest version (${latest.version}) does not match package.json ` +
      `(${pkgVersion}) — skipping Slack announcement. Run scripts/promote.sh first.`
    );
    process.exit(0);
  }

  const notesText = latest.notes.length
    ? latest.notes.map((n) => `• ${n}`).join('\n')
    : '_No release notes recorded for this version._';

  const payload = {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🚀 New A11y Scanner release', emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*v${latest.version}* — released ${latest.date}` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: notesText },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: '<https://a11y.webdepend.dev/changelog|View full changelog>' },
        ],
      },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`✗ Slack webhook responded ${res.status}: ${body}`);
    process.exit(1);
  }

  console.log(`✓ Posted v${latest.version} release notes to #webdepend-labs.`);
}

main().catch((err) => {
  console.error('✗ Failed to post Slack release announcement:', err.message);
  process.exit(1);
});
