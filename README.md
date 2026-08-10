# A11y Tool — WebDepend

Accessibility crawler and axe-core scanner with a web UI. Scans sites or URL lists against WCAG rules, stores results in PostgreSQL, and captures element screenshots to disk.

---

## Deploying to DigitalOcean

### 1. Create a Droplet

In the DigitalOcean panel:
- **Image**: Ubuntu 24.04 LTS
- **Size**: Basic, 2GB RAM / 1 vCPU ($12/mo) — recommended for Playwright
- **Region**: closest to you
- Add your SSH key so you can connect

Note the Droplet's IP address.

### 2. Add a DNS A record

At your domain registrar, add:

```
Type: A
Name: a11y          (or a11y.webdepend.dev if using full domain)
Value: YOUR_DROPLET_IP
TTL: 300
```

Do this now — DNS needs to propagate before Caddy can issue the SSL certificate.

### 3. Run the server setup script (once)

Copy the project to the server, then SSH in and run the setup script:

```bash
# From your local machine — upload the project
./scripts/deploy.sh root@YOUR_DROPLET_IP

# SSH into the server
ssh root@YOUR_DROPLET_IP

# Run setup (installs Node, PostgreSQL, Caddy, PM2, Playwright deps)
bash /var/www/a11y-tool/scripts/setup.sh
```

The script prints a `DATABASE_URL` at the end — **save it**.

### 4. Create .env on the server

Still on the server:

```bash
nano /var/www/a11y-tool/.env
```

Paste:

```
DATABASE_URL=postgresql://a11y_user:YOUR_GENERATED_PASS@localhost:5432/a11y_tool
DATA_DIR=/var/data/a11y-tool
PORT=3000
# Required only if you'll scan password-protected sites (basic auth / login form) —
# generate with: openssl rand -hex 32
CREDENTIALS_ENCRYPTION_KEY=
```

Then restart the app:

```bash
pm2 restart a11y-tool
```

### 5. Done

Visit **https://a11y.webdepend.dev** — Caddy issues the SSL certificate automatically on first request.

---

## Subsequent deploys

From your local machine, in the project folder:

```bash
./scripts/deploy.sh root@YOUR_DROPLET_IP
```

This rsyncs the code (skipping `.env` and `data/`), runs migrations, and restarts PM2.

---

## Local development (without Docker)

**Prerequisites**: Node 18+, PostgreSQL running locally.

```bash
cp .env.example .env
# Edit .env with your local DATABASE_URL

npm install
npm run db:migrate
npm start
```

Open http://localhost:3000.

## Local development (with Docker)

```bash
docker compose up
```

PostgreSQL starts, migrations run automatically. App at http://localhost:3000.

---

## Environment variables

These are read by the running app itself (`src/server.js`), so they belong in
whichever `.env` is next to the app when it starts — the server's
`/var/www/a11y-tool/.env` in production, or your own project-root `.env` for
local development.

| Variable       | Default   | Description                                       |
|----------------|-----------|---------------------------------------------------|
| `DATABASE_URL` | —         | PostgreSQL connection string (required)           |
| `PORT`         | `3000`    | HTTP port                                          |
| `DATA_DIR`     | `./data`  | Directory for screenshot files                     |

`SLACK_RELEASE_WEBHOOK_URL` is a separate case — it's not read by the app at
all, only by the release script on *your own machine*. See "Changelog &
release announcements" below.

## API endpoints

| Method | Path                 | Description                   |
|--------|----------------------|-------------------------------|
| POST   | `/api/scan`          | Start a new scan              |
| GET    | `/api/scan/:id`      | Get job status + findings     |
| POST   | `/api/scan/:id/stop` | Request scan stop             |
| GET    | `/api/scans`         | List all past scans           |
| GET    | `/api/screenshots/*` | Serve screenshot files        |
| GET    | `/health`            | Health check (includes DB)    |

## Database schema

Three tables: `scans`, `findings`, `scan_errors`.
Migrations live in `db/schema.sql` — safe to re-run (`CREATE TABLE IF NOT EXISTS`).

---

## Version control & branching strategy

### Initial GitHub setup

```bash
# On GitHub.com: create a new repo called 'a11y-tool' (private)
# Then in the project folder:

git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/webdepend/a11y-tool.git
git push -u origin main

# Create the develop branch
git checkout -b develop
git push -u origin develop
```

### Branch structure

| Branch | Purpose | Deploys to |
|--------|---------|------------|
| `main` | Production-ready code | a11y.webdepend.dev |
| `develop` | Integration / staging | staging.a11y.webdepend.dev |
| `feature/*` | Feature development | Local only |
| `fix/*` | Bug fixes | Local only |

### Day-to-day workflow

```bash
# 1. Start a new feature branch from develop
git checkout develop
git pull origin develop
git checkout -b feature/my-feature

# 2. Do work, commit regularly
git add .
git commit -m "feat: add my feature"

# 3. Merge feature branch into develop when done
git checkout develop
git pull origin develop
git merge feature/my-feature
git push origin develop

# 4. Delete the feature branch (no longer needed)
git branch -d feature/my-feature
git push origin --delete feature/my-feature

# 5. Deploy to staging and test
./scripts/deploy.sh staging

# 6. When happy with staging, release to production
./scripts/promote.sh        # merges develop → main, creates a version tag
./scripts/deploy.sh production
```

> **Note:** `promote.sh` only handles `develop → main`. Steps 1–4 (the feature
> branch lifecycle) happen before that, and are your responsibility to complete
> before deploying to staging.

### Changelog & release announcements

Release notes live in [`CHANGELOG.md`](CHANGELOG.md) and are shown at
[/changelog](https://a11y.webdepend.dev/changelog) (public, no login needed)
and in the version footer on every page.

- As you work on a feature/fix branch, add a bullet point per notable change
  under the `## [Unreleased]` heading in `CHANGELOG.md`.
- `./scripts/promote.sh` stamps that section with the version number and
  today's date (as `## [X.Y.Z] - YYYY-MM-DD`) when it merges `develop` into
  `main`, and leaves `[Unreleased]` empty for the next cycle. It refuses to
  run if `[Unreleased]` is empty — there'd be nothing to release notes-wise.
- `./scripts/deploy.sh production` posts the newly released version's notes
  to WebDepend's `#webdepend-labs` Slack channel once the deploy succeeds
  (staging deploys never post to Slack). This step runs `scripts/notify-slack-release.js`
  **on your own machine** (deploy.sh itself runs locally, not on the server),
  so it reads `SLACK_RELEASE_WEBHOOK_URL` from the project's `.env` **in your
  local working copy** — not the server's `.env`, and not something you need
  for local `npm start` development either. One-time setup:

  1. At [api.slack.com/apps](https://api.slack.com/apps), create a new app
     "From scratch" in the WebDepend workspace (e.g. "A11y Scanner Releases").
  2. Under **Incoming Webhooks**, activate the feature, then **Add New
     Webhook to Workspace** and pick `#webdepend-labs`.
  3. Copy the generated `https://hooks.slack.com/services/...` URL.
  4. In your local `a11y-tool` project folder (the one you run `./scripts/deploy.sh`
     from), add it to `.env`:
     ```
     SLACK_RELEASE_WEBHOOK_URL=https://hooks.slack.com/services/...
     ```
     `.env` is gitignored — never commit this value.

  If the variable isn't set, `deploy.sh production` still succeeds — it just
  skips the Slack step with a warning.

### Setting up the staging environment (one-time)

1. Add DNS A record: `staging.a11y.webdepend.dev` → `104.248.164.90`

2. Add staging redirect URI to your Google OAuth app:
   `https://staging.a11y.webdepend.dev/auth/google/callback`

3. SSH into the server and run:
   ```bash
   bash /var/www/a11y-tool/scripts/setup-staging.sh
   ```

4. Create `/var/www/a11y-tool-staging/.env` with the credentials the script prints.

5. Deploy:
   ```bash
   ./scripts/deploy.sh staging
   ```
