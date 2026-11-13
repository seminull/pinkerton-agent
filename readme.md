# Pinkerton Agent

A CRM for residential real estate agents. Tracks contacts, listings, and the
interaction log between them.

Postgres in Docker, a Node/Hono API, and a React + Mantine client, in a pnpm
workspace.

## Requirements

- Node 24 (`.nvmrc` — `nvm use`)
- pnpm 11 (`corepack enable`)
- Docker with Compose

## Setup

```bash
cp .env.example .env
pnpm install
pnpm services:up      # Postgres on host port 5434
pnpm db:migrate
pnpm db:seed          # optional demo data
pnpm user:create you@example.com Your Name   # an account to sign in with
pnpm dev
```

- Web: http://localhost:5174
- API: http://localhost:3040
- Health: http://localhost:3040/api/health

`pnpm dev` brings up Postgres, applies migrations, then runs the API and the
Vite dev server together. To run the halves separately, use `pnpm dev:api` and
`pnpm dev:web`.

## Scripts

| Command                 | Does                                             |
| ----------------------- | ------------------------------------------------ |
| `pnpm dev`              | Services + migrations + API and web              |
| `pnpm check`            | Typecheck both halves, then lint                 |
| `pnpm db:migrate`       | Apply pending migrations                         |
| `pnpm db:migrate:undo`  | Roll back the last migration                     |
| `pnpm db:seed`          | Insert demo data                                 |
| `pnpm user:create`      | Create an account, or reset its password         |
| `pnpm services:up/down` | Start / stop Postgres                            |
| `pnpm build:web`        | Production build of the client                   |

## API

All responses are JSON. Errors are `{ error: "snake_case_code", details?: {} }`.
Lists return `{ results: [...], total: n }` and accept `limit` (max 100) and
`offset`.

Everything except `/api/health` and `/api/auth/*` requires a session and
answers `401 { "error": "authentication_required" }` without one.

```
GET    /api/health

GET    /api/auth/me                 { user | null, providers } — 200 either way
POST   /api/auth/login              { email, password }
POST   /api/auth/logout
GET    /api/auth/google/start       browser redirect to Google
GET    /api/auth/google/callback    where Google sends the browser back

GET    /api/contacts        ?q= &stage= &type= &sort= &dir= &limit= &offset=
POST   /api/contacts
GET    /api/contacts/:id    includes the contact's listings
PATCH  /api/contacts/:id
DELETE /api/contacts/:id

GET    /api/listings        ?q= &status= &city= &minPrice= &maxPrice= &sort= &dir=
POST   /api/listings
GET    /api/listings/:id    includes the seller contact
PATCH  /api/listings/:id
DELETE /api/listings/:id

GET    /api/activities      ?contactId= &listingId= &type= &open=true
POST   /api/activities
PATCH  /api/activities/:id
DELETE /api/activities/:id
```

Prices are **integer cents** on the wire and in the database. `?open=true` on
activities returns everything not yet completed — the follow-up queue.

## Sign-in

The app is closed: signed out, every URL shows the login screen and every data
route returns 401. There is **no sign-up page**. An account exists for one of
two reasons:

1. **Someone with a shell created it.** `pnpm user:create <email> [first] [last]`
   prompts for a password (12–128 characters). Run it again on the same address
   to reset the password.
2. **An invited address signed in with Google.** Addresses listed in
   `AUTH_ALLOWED_EMAILS` get an account on their first Google sign-in. Anyone
   else is turned away. The list only governs *creating* accounts — to remove
   someone who already has one, set their `users.status` to `disabled`, which
   ends their sessions on the next request.

A Google sign-in whose verified address matches an existing account is linked
to it, so an account made with `user:create` can use either method afterwards.

**Enabling Google.** In Google Cloud, create an OAuth 2.0 client of type *Web
application*, configure its consent screen, and add the exact redirect URI:
`http://localhost:5174/api/auth/google/callback` for development,
`https://<your domain>/api/auth/google/callback` for production. Put
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `.env`
and restart. The button appears only when all three are set. Only
`openid email profile` is requested, and no Google token is stored.

Sessions are an opaque token in an HttpOnly, SameSite=Lax cookie (Secure in
production), stored server-side as a SHA-256 hash, valid 30 days, and revoked
on sign-out. Passwords are hashed with Argon2id.

Not built yet: password reset by email, a screen to change your own password,
session review, and MFA.

## Schema

`contacts` → `listings` (seller, `ON DELETE SET NULL`, so listing history
survives a deleted contact) and `contacts`/`listings` → `activities`
(`ON DELETE CASCADE`, since an interaction log has no meaning without its
subject).

`users` → `auth_identities` (one row per linked provider) and `users` →
`user_sessions`, both `ON DELETE CASCADE`. Users are not yet connected to the
CRM tables: every signed-in user sees the same contacts and listings.

Schema changes go through `sequelize-cli` migrations under
`server/sequelize/migrations/`. `sequelize.sync()` is never used.

## Ports

API 3040, web 5174, Postgres 5434 — all non-default so this runs beside other
local projects.

## Production

The host needs Docker and nothing else — no Node, no pnpm. One command builds
the images from the working tree, applies pending migrations, and starts
everything:

```bash
cp .env.example .env    # first time only — then set a strong POSTGRES_PASSWORD
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --wait
```

Re-run the same command to deploy a new version after `git pull`. It is
idempotent, and a failed migration stops the deploy before the running API is
replaced.

| Container            | Role                                             | Host port        |
| -------------------- | ------------------------------------------------ | ---------------- |
| `pinkerton-web`      | nginx: serves the built client, proxies `/api`   | `127.0.0.1:8090` |
| `pinkerton-api`      | The Hono server                                  | none             |
| `pinkerton-migrate`  | One-shot `sequelize-cli db:migrate`, then exits  | none             |
| `pinkerton-postgres` | Database                                         | `127.0.0.1:5434` |

Everything binds to loopback, so the stack is unreachable from the network
until something on the host is pointed at the web port — a tunnel or a TLS
reverse proxy. Set `WEB_PORT` in `.env` if 8090 is taken.

A fresh deploy has no accounts, so nobody can sign in until you create one. The
command needs a terminal for the password prompt:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  run --rm api node --import tsx server/create-user.ts you@example.com Your Name
```

Session cookies are `Secure` in production, so sign-in only works over https.
Make sure whatever fronts the stack redirects http to https.

Demo data is not loaded by a deploy. To seed a fresh database on purpose:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  run --rm migrate node_modules/.bin/sequelize-cli db:seed:all
```

## Not built yet

No tests, no CI, no per-user or per-organization data separation. See [PLAN.md](PLAN.md) for the
schema, packages, and integrations this is designed to grow into, and
[CLAUDE.md](CLAUDE.md) for the conventions to follow when adding to it.
