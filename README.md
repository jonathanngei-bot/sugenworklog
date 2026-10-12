# Sugen Work Diary

A daily work log for the Sugen / Afya Yangu team: staff check-in, work entries
per project, and an admin portal for managing the team.

**Live site:** https://sugenworklogdiary.netlify.app

## How it works

```
public/index.html   ← the UI (vanilla JS, no build step)
public/sync.js      ← mirrors localStorage ↔ the REST API
        │
        ▼  fetch()
netlify/functions/  ← the backend (Netlify Functions)
        │
        ▼
netlify/database/   ← Postgres (Netlify Database), migrations apply on deploy
```

The app was originally `localStorage`-only, which meant every browser had its
own private copy of the data. `sync.js` keeps the original app code untouched
and layers the API underneath it:

- every write to a Work Diary storage key is debounced and pushed to the API
- on boot, server data is merged in, then anything local-only is uploaded
- deletions are detected by diffing against the last synced snapshot
- if the API is unreachable, the app still works, purely in `localStorage`

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/entries` | List work entries (newest first) |
| `POST` | `/api/entries` | Create or upsert an entry |
| `PUT` | `/api/entries/:id` | Replace an entry |
| `DELETE` | `/api/entries/:id` | Delete an entry |
| `GET` | `/api/members` | List staff members |
| `POST` | `/api/members` | Add or upsert a staff member |
| `PATCH` | `/api/members/:id` | Activate / deactivate a member |
| `DELETE` | `/api/members/:id` | Remove a member |
| `GET` | `/api/attendance?date=` | Check-in status for a day |
| `POST` | `/api/attendance` | Check a member in or out |
| `GET` | `/api/settings` | All key/value settings |
| `GET` | `/api/settings/:key` | One setting |
| `PUT` | `/api/settings/:key` | Save a setting |
| `POST` | `/api/pins` | Set a PIN, or verify a staff login |

## Staff login

Staff choose their name and enter a PIN. PINs are stored **hashed** (SHA-256,
server-side) — the API never returns them, and they are not readable from the
browser. Until an admin sets a PIN, the default is **`1234`**.

Administrator access is gated in the UI (`jonathanngei5@gmail.com` / `1027`).

> **Known gap:** there is no real session auth yet. The admin gate is
> client-side only, and the API itself is unauthenticated. Anything written
> above should move behind Netlify Identity before this holds sensitive data.

## Local development

```bash
npm install
netlify dev                 # starts the local DB + serves http://localhost:8888
```

Database commands:

```bash
netlify database status                       # applied vs pending migrations
netlify database migrations apply             # apply pending locally
netlify database connect --query "SELECT 1"   # one-shot query
```

## Deploying

Push to `main` — Netlify applies migrations, then publishes. Migrations in
`netlify/database/migrations/` are applied automatically at deploy time.

```bash
git add -A
git commit -m "Describe the change"
git push origin main
```

Manual deploy instead:

```bash
netlify deploy --prod
```

## Layout

```
netlify.toml                    build + publish + function config
netlify/functions/              API endpoints
netlify/lib/db.mts              shared Postgres client + helpers
netlify/database/migrations/    SQL migrations (applied at deploy)
public/                         static site (index.html, sync.js)
```
