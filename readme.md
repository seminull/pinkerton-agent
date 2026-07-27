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
| `pnpm services:up/down` | Start / stop Postgres                            |
| `pnpm build:web`        | Production build of the client                   |

## API

All responses are JSON. Errors are `{ error: "snake_case_code", details?: {} }`.
Lists return `{ results: [...], total: n }` and accept `limit` (max 100) and
`offset`.

```
GET    /api/health

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

## Schema

`contacts` → `listings` (seller, `ON DELETE SET NULL`, so listing history
survives a deleted contact) and `contacts`/`listings` → `activities`
(`ON DELETE CASCADE`, since an interaction log has no meaning without its
subject).

Schema changes go through `sequelize-cli` migrations under
`server/sequelize/migrations/`. `sequelize.sync()` is never used.

## Ports

API 3040, web 5174, Postgres 5434 — all non-default so this runs beside other
local projects.

## Not built yet

No auth, no tests, no API Dockerfile, no CI. See [PLAN.md](PLAN.md) for the
schema, packages, and integrations this is designed to grow into, and
[CLAUDE.md](CLAUDE.md) for the conventions to follow when adding to it.
