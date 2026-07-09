#!/usr/bin/env node
// scripts/add-user.js
// Add a user to the whitelist from the server command line.
// Run before first login:
//   node scripts/add-user.js tom@webdepend.co.uk "Tom Batey"
require('dotenv').config();
const pool = require('../src/db');

async function main() {
  const [email, name] = process.argv.slice(2);
  if (!email) {
    console.error('Usage: node scripts/add-user.js email@webdepend.co.uk "Full Name"');
    process.exit(1);
  }
  await pool.query(
    `INSERT INTO users (email, name) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name`,
    [email.toLowerCase().trim(), name?.trim() || null]
  );
  console.log(`✓ ${email} can now sign in.`);
  await pool.end();
}

main().catch((err) => { console.error(err.message); process.exit(1); });
