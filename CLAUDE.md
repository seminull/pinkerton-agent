# CLAUDE.md

Context for AI-assisted sessions on this repo. Read this first.

**This file is self-contained on purpose.** The conventions below were adapted
from another project of Mike's during the initial scaffold, but that project is
no longer a reference — do not go looking for it, do not read from it, and do
not cite it. If a convention isn't written down here, it isn't a convention yet:
follow the code already in this repo, and if that's ambiguous, ask.

## What this is

Pinkerton Agent — a CRM for residential real estate agents. Tracks contacts
(buyers and sellers), listings, and the interaction log between them. Postgres
in Docker, a Node/Hono API, and a React + Mantine client in a pnpm workspace.

Package name: `pinkertonagent-app`. See `readme.md` for setup and `PLAN.md`
for the schema and integrations this is built to grow into.

## Stack

| Layer    | Choice                                             |
| -------- | -------------------------------------------------- |
| Runtime  | Node 24 (`.nvmrc`), **not** Bun or Deno            |
| API      | Hono via `@hono/node-server`                        |
| Database | Postgres 17 in Docker, Sequelize 6 + sequelize-cli  |
| Client   | React 19, Mantine 9, TanStack Query 5, React Router 7 |
| Build    | Vite, TypeScript strict                             |
| Packages | pnpm workspaces (`apps/*`, `packages/*`)            |

Don't swap any of these out without asking. In particular: pnpm, not npm or
yarn; Sequelize, not Prisma or Drizzle; Mantine, not shadcn or MUI.

## Layout

```
server/                  API. TypeScript, run with tsx.
  index.ts               Entry: middleware, health, the session gate, route mounting.
  auth.ts                Sessions, cookies, the requireSession gate, the allowlist.
  password.ts            Argon2id hashing (node:crypto — no dependency).
  admin.ts               The admin role: how it's granted, and the adminOnly gate.
  create-user.ts         CLI: `pnpm user:create`. Makes the first account.
  set-admin.ts           CLI: `pnpm user:admin`. Makes the first admin.
  http.ts                Shared request helpers (pagination, allowlists, errors).
  types.ts               Wire types — what the API sends, not what the table holds.
  routes/*.routes.ts     One file per resource.
  sequelize/
    models/              CommonJS models + hand-written index.d.ts for types.
    migrations/          Every schema change. Never edit a merged migration.
    seeders/             Demo data.
apps/web/                Vite + React client (@pinkertonagent/web).
  src/api/               fetch wrapper and wire types.
  src/admin/             Users screen (admins only): create, edit, disable.
  src/timeclock/         Time Clock: start/stop task timer, history, CSV export.
  src/auth/              AuthProvider, the AuthGate around the router, the login page.
  src/<resource>/        Feature folder: queries.ts + components, colocated.
  src/routes/            Layout, error, 404, dashboard.
  src/router.tsx         Route table, kept out of main.tsx so it's testable.
```

## Conventions that matter

**Comments explain _why_, not _what_.** This is the strongest convention in the
repo. Every non-obvious constant, config block, and design decision carries a
comment giving the reason behind it — the constraint, the bug it prevents, the
tradeoff taken. Don't write `// loop over contacts`. Do write the sentence that
saves the next person from re-deriving the decision. Match the existing density;
it is higher than most codebases.

**Money is integer cents.** `listPriceCents`, never a float dollar amount. The
client converts at the edges (`apps/web/src/format.ts`).

**Allowlists over denylists.** Writable fields (`WRITABLE` in each route file),
sortable columns (`SORT_FIELDS`), and CORS origins are all explicit lists. A
client can never write a column or sort by one a route didn't opt into. Extend
the list deliberately; never replace it with a passthrough.

**Every API error is JSON.** `{ error: "snake_case_code", details?: {...} }`.
Throw via `apiError()` from `server/http.ts` — it attaches the JSON body to the
exception, which is required because sub-apps mounted with `app.route()` handle
their own errors and never reach the root `onError`.

**The API is closed by position.** `server/index.ts` mounts `requireSession` on
`/api/*` partway down the file: routers mounted below that line need a session,
the ones above it (health, auth) don't. New resource routers go below. There is
no sign-up route and there must not be one — this is a private CRM, and accounts
come only from `pnpm user:create`, an admin on the Users screen, or a Google
sign-in by an address in `AUTH_ALLOWED_EMAILS`. `/api/admin/*` adds a second
gate (`adminOnly`) the same way. The client-side `AuthGate` is a convenience; the server
check is the control.

**The client calls relative `/api` paths.** Never an absolute origin — that URL
would be resolved by the visitor's browser on their machine. Vite proxies `/api`
in dev; a reverse proxy will do it in production.

**Schema changes go through migrations.** Write the migration and update the
model together, plus `server/sequelize/models/index.d.ts` so the routes stay
typed. `sequelize.sync()` is never used.

**Nullable means unknown.** A blank optional field is stored as NULL, not `""`.
The forms convert empty strings to null before sending.

**Ports:** API 3040, web 5174, Postgres 5434 on the host. All non-default so
this stack can run beside other local projects.

## Working commands

```bash
pnpm install
pnpm services:up          # Postgres in Docker
pnpm db:migrate           # apply migrations
pnpm db:seed              # demo data
pnpm dev                  # services + migrate + API and web together
pnpm check                # typecheck + lint — run before calling work done
```

`pnpm dev:api` and `pnpm dev:web` run the halves separately. The API reads
`.env` (copy `.env.example`).

## Things not built yet

No tests, no CI. Auth exists (see "Sign-in" in `readme.md`) but stops at
"who are you": there is no `organizationId` or owner on the CRM tables, so every
signed-in user sees all data, and no password-reset or change-password flow.
These are known gaps, not oversights — see `PLAN.md` for the order they're meant
to land in. Don't quietly add a dependency for one of them without raising it.
