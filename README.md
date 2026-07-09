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

| Variable       | Default   | Description                                       |
|----------------|-----------|---------------------------------------------------|
| `DATABASE_URL` | —         | PostgreSQL connection string (required)           |
| `PORT`         | `3000`    | HTTP port                                         |
| `DATA_DIR`     | `./data`  | Directory for screenshot files                    |

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
