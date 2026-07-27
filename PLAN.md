# PLAN.md

Where Pinkerton Agent goes from the scaffold. Nothing here is committed to —
it's a menu with opinions attached, written so the reasoning survives even if
the choices change.

---

## 1. What exists today

Three tables, full CRUD, and a working client.

| Table        | Purpose                                                        |
| ------------ | -------------------------------------------------------------- |
| `contacts`   | People — buyer / seller / both, with a pipeline `stage`.        |
| `listings`   | Properties, with a nullable FK to the seller contact.           |
| `activities` | The interaction log: calls, emails, showings, notes, and tasks. |

`activities` deliberately doubles as the task table: `completedAt IS NULL` means
open, backed by a partial index. That's one fewer table until tasks need
something activities don't have (assignment, recurrence, reminders).

Screens: dashboard, contacts list + detail, listings list. Create/edit modals for
contacts and listings.

---

## 2. Tables worth adding

Ordered roughly by when you'll want them.

### Tier 1 — needed before real use

**`users`** — the agent. Even single-tenant, everything downstream (who logged
this call, whose task is this) needs a subject. Fields: `email`, `passwordHash`,
`name`, `licenseNumber`, `role`, `lastLoginAt`.

**`organizations`** — the brokerage or team. Add `organizationId` to every table
**now, before there's data**, even if it's always the same value at first.
Retrofitting multi-tenancy onto a live CRM is one of the genuinely painful
migrations, because every query and every index has to change at once.

**`deals`** (or `transactions`) — the thing a CRM actually manages, and the
biggest gap in the current schema. A deal joins a contact, optionally a listing,
and a side (`listing` vs `buyer`), and carries the money and the dates:
`stage`, `contractPriceCents`, `commissionRate`, `commissionCents`,
`contractDate`, `optionEndsOn`, `financingContingencyOn`, `appraisalDueOn`,
`closingDate`, `actualClosedOn`, `status`.

Why it matters: a contact's `stage` can't express "under contract on one
property while still shopping for another." Deals also make the numbers an
agent actually cares about — pipeline value, GCI, closings this quarter —
queryable instead of derived by hand.

**`buyer_preferences`** (or `saved_searches`) — criteria per buyer: price range,
beds/baths, areas, must-haves. Feeds "which of my buyers match this new
listing," which is the single most useful automation in an agent CRM.

⚠️ **Fair housing constraint.** Preferences may describe *property*, never
*people*. No fields for the racial, religious, ethnic, or family composition of
a neighborhood; no free-text "school quality" proxy that gets used for steering.
Keep the criteria on price, size, features, and geography. This is a legal line
(Fair Housing Act §804), not a style preference, and the schema is the right
place to make crossing it impossible.

**`consents`** — per contact and per channel (`sms`, `email`, `call`), with
`grantedAt`, `revokedAt`, `source`, and the captured consent text. See §5.

### Tier 2 — quality of life

- **`tags` + `contact_tags`** — free-form segmentation ("past client", "sphere",
  "investor"). Cheap, and agents ask for it immediately.
- **`documents`** — object-storage keys plus metadata, attached to a deal or
  listing. Store keys, never blobs, in Postgres.
- **`listing_media`** — photo URLs with ordering and a primary flag.
- **`showings`** — if showing feedback and scheduling get real, split them out of
  `activities`: they need a time range, attendees, and structured feedback.
- **`vendors`** — inspectors, lenders, title companies, photographers. Agents
  refer these constantly and track who's reliable.
- **`contact_relationships`** — self-referential: spouse, referred-by,
  co-borrower. Referral attribution is worth real money to an agent.
- **`open_houses`** — date, listing, and the sign-in sheet that feeds new leads.

### Tier 3 — scale and rigor

- **`email_messages`** — synced correspondence, threaded to a contact.
- **`audit_log`** — who changed what, when. Useful for a team; occasionally
  required in a dispute.
- **`custom_fields`** / **`custom_field_values`** — only if you're selling this
  to other agents. It's a real complexity tax; skip it for a single-agent tool.
- **`market_areas`** — the farm: named geographies for reporting.

### Schema notes

- Keep **money in integer cents** everywhere, as `listings` already does.
- Prefer **`DATEONLY` for calendar dates** (closing date, listed-on) and
  timestamptz only for true instants. A closing date is a day, and giving it a
  timezone creates off-by-one bugs at month boundaries.
- Add **`deletedAt` soft deletes** on `contacts` and `deals` before launch.
  Agents delete things by accident, and a contact record can have legal
  significance.
- When free-text search outgrows `ILIKE`, reach for **`pg_trgm`** with a GIN
  index before reaching for Elasticsearch. It'll carry you a long way.

---

## 3. Packages worth adding

### Backend

| Package                          | Why                                                                       |
| -------------------------------- | ------------------------------------------------------------------------- |
| **zod** + `@hono/zod-validator`  | Replace the hand-rolled validators in `server/http.ts`. One schema per route, typed and self-documenting. Highest-value addition on this list. |
| **argon2** (`@node-rs/argon2`)   | Password hashing. Argon2id over bcrypt for new work.                       |
| **pino** + `hono-pino`           | Structured JSON logs. `hono/logger` is fine for dev, thin for production.  |
| **BullMQ** (+ Redis)             | Background jobs: drip campaigns, MLS sync, nightly digests. Only once something actually needs to run out of band. |
| **papaparse**                    | CSV import/export. Every agent arrives with a spreadsheet.                 |
| **dotenv**                       | Node 24 has `--env-file`, so possibly unnecessary — check before adding.   |

### Frontend

| Package                    | Why                                                             |
| -------------------------- | --------------------------------------------------------------- |
| **mantine-react-table**    | Sorting, column visibility, and CSV export without rebuilding the tables by hand. |
| **@dnd-kit/core**          | Drag-and-drop kanban for the deal pipeline. Agents expect a board view. |
| **recharts**               | Dashboard charts. Integrates cleanly with Mantine's theming.     |
| **@mantine/modals**        | Imperative confirm dialogs — better than a `useState` per delete button. |
| **@mantine/spotlight**     | ⌘K jump-to-contact. Small effort, disproportionate daily value.  |

### Testing (currently none)

**Vitest** for both halves, **@testing-library/react** for components, and
**supertest**-style route tests against a throwaway Postgres schema. Worth
standing up before the schema gets complicated rather than after.

### Auth

For a single-agent or small-team tool, **session cookies + argon2** written by
hand is genuinely fine and avoids a large dependency. If you'd rather not own it:
**Better Auth** is the best current fit for a self-hosted Node + Postgres stack.
Avoid a hosted identity provider unless you specifically want SSO — it adds a
network dependency to your login path for little gain at this size.

---

## 4. Services worth wiring in

Grouped by what they unlock. The first two are the ones that make this a real
product rather than a database with a form on it.

### MLS data — the big one

Listing data comes from the MLS, and access is per-MLS and permissioned. The
modern path is the **RESO Web API** with the **RESO Data Dictionary** (a
standardized field vocabulary — worth reading before designing the listing
schema further, so your column names match the industry's).

Aggregators that resell normalized access:

- **Bridge Interactive** (Zillow Group) — broad coverage, free for approved uses.
- **Trestle** (CoreLogic) — very wide coverage, paid.
- **MLS Grid** — RESO-native, clean, growing coverage.
- **Spark Platform** (FBS) — good docs, narrower footprint.

Practical notes: every one requires broker authorization and an MLS-approved use
case. Most licenses **forbid storing listing data beyond a cache window** and
require attribution and periodic refresh. Design listing sync as a **cache with
a TTL and a provenance column**, not as your system of record — that constraint
is contractual, and it's much cheaper to build for it than to retrofit it.

### Communication

- **Twilio** — SMS and voice, with a number that logs both directions into
  `activities`. The highest-value integration after MLS.
- **Resend**, **Postmark**, or **SendGrid** — transactional email. Postmark for
  deliverability on transactional; Resend for developer experience.
- **Gmail API / Microsoft Graph** — sync existing correspondence so the agent
  doesn't have to BCC the CRM. Users consistently want this and consistently
  won't change their email habits to get it.

### Documents and signature

- **DocuSign** or **Dropbox Sign** — offers and disclosures.
- **dotloop** or **SkySlope** — full transaction management. Many brokerages
  mandate one; integrating beats competing with it.
- **S3** or **Cloudflare R2** — document storage. R2 for zero egress fees.

### Calendar and scheduling

- **Google Calendar** / **Microsoft Graph** — two-way sync for showings and
  closings. Two-way is much harder than one-way; start by pushing only.
- **Cal.com** (self-hostable) — buyer-facing showing booking.

### Enrichment

- **Mapbox** or **Google Maps Platform** — geocoding and map views. Mapbox is
  usually cheaper at low volume; check current terms on storing geocodes.
- **County appraisal district data** — public records for owner, assessed value,
  and characteristics. Free, and useful for seller lead-gen.
- **Melissa** or **Smarty** — address validation and standardization at input.
  Dedupes listings before bad data multiplies.

### Operations

- **Sentry** — error tracking, both halves.
- **Uptime Kuma** (self-hosted) or **BetterStack** — pointed at `/api/health`,
  which already reports dependency status.
- **pgBackRest** or a nightly `pg_dump` to object storage. A CRM losing a book
  of business is unrecoverable for the user in a way an outage never is.

---

## 5. Compliance — read before shipping outbound messaging

Not optional, and cheaper to design for than to retrofit.

- **TCPA** — SMS and automated calls need prior express written consent, stored
  with timestamp, source, and the exact text shown. Statutory damages run
  \$500–\$1,500 *per message*. This is why `consents` is a Tier 1 table.
- **DNC** — scrub against the National Do Not Call Registry; honor internal
  opt-outs immediately and permanently.
- **CAN-SPAM** — working unsubscribe honored within 10 business days, and a
  physical postal address in every marketing email.
- **Fair Housing** — no segmentation, filtering, or ad targeting on protected
  classes. This constrains what `buyer_preferences` and any future audience
  builder may express (see §2).
- **State license law** — most states require the agent's license number and
  brokerage name in advertising and often in outbound email signatures.
- **MLS licensing** — display rules, attribution, and retention limits, per MLS.

---

## 6. A suggested order

**Phase 1 — make it usable**
Auth (`users`, sessions) → `organizationId` on every table → soft deletes →
zod validation → Vitest + first tests → a Dockerfile and
`docker-compose.prod.yml`.

**Phase 2 — make it a CRM**
`deals` and a kanban pipeline → `tags` → activity timeline on contact and
listing detail → CSV import → global search (⌘K).

**Phase 3 — make it worth paying for**
`buyer_preferences` + listing-to-buyer matching → Twilio and email with
`consents` enforced → calendar sync → dashboard reporting (GCI, pipeline,
conversion by source).

**Phase 4 — make it authoritative**
MLS sync via RESO (cache + TTL + provenance) → document storage and e-sign →
`audit_log` → background jobs.

The scaffold is built to make Phase 1 mechanical: the field allowlists,
`apiError` shape, and migration discipline are all in place already.
