# MLS.md

Everything about getting NTREIS listing data into this app, in one place.
Written to be skimmed — read §1 and §2, come back for the rest when you need it.

Expands on the "MLS data" bullet in `PLAN.md` §4.

---

## 1. The one thing to understand

**Three separate parties, and people conflate them constantly:**

| Party | Role |
| ----- | ---- |
| **NTREIS** | Owns the data. Decides if you get a feed. Sets the rules and any fee. |
| **Bridge / Trestle** | The pipe. Normalizes the data, hosts the API, routes your request. |
| **Your broker** | Signs the licence. A back-office feed is granted to the *brokerage*. |

Bridge does not decide whether you get NTREIS data. NTREIS does. Your Bridge
account is a developer identity with zero listing data attached to it.

⚠️ **Your Matrix login is not a data feed.** Scraping Matrix, or driving it
headless, breaches the subscriber agreement. The consequence is losing MLS
access, not a warning.

---

## 2. Where things stand

- ✅ Bridge account registered.
- ✅ This repo talks to Bridge's public demo dataset — see §5. No signup needed.
- ⬜ NTREIS feed requested. **This is the next real step.**
- ⬜ Local cache + sync job. Deliberately not built yet (§7).

**To request the feed:** Bridge dashboard → Data Access → find NTREIS → request.
Ask specifically for a **back-office / internal-use feed**, not IDX. Your broker
of record signs. Expect weeks.

**First, confirm NTREIS is in Bridge's catalog at all.** Coverage differs per hub
and I could not verify it from outside. If they aren't listed, Trestle is the
route instead (paid, but confirmed to carry NTREIS).

---

## 3. Which feed tier to ask for

| Tier | What it is | For a CRM |
| ---- | ---------- | --------- |
| **IDX** | Public display on a consumer website. Stripped fields, opt-outs removed, strict attribution rules. | ✗ Wrong |
| **VOW** | Virtual Office Website. More fields, but only for consumers who registered a broker relationship. | ✗ Wrong |
| **BBO** | Broker Back-Office. Full data for the brokerage's own internal use. | ✓ **This one** |

BBO is poorly documented everywhere because it needs broker sponsorship. Say the
use case is a CRM for the brokerage's own agents.

---

## 4. Bridge vs Trestle

| | **Bridge** (Zillow Group) | **Trestle** (CoreLogic/Cotality) |
| --- | --- | --- |
| Cost | Free for approved uses | Paid |
| Auth | Bearer server token | OAuth2 client_credentials, 8h token |
| NTREIS | Unconfirmed — check your dashboard | Confirmed |
| Demo data | Public `test` dataset, no approval | Sandbox on request |

Both speak **RESO Web API** (OData 4). **Build against the OData endpoint, not a
vendor's proprietary REST API** — then switching hubs is a base URL and an auth
block, not a rewrite.

⚠️ **RETS is dead.** Sunset industry-wide. Don't build on it.

*Note: Bridge is a Zillow subsidiary. Some brokers have opinions about routing
brokerage data through Zillow — worth raising before the application, not after.*

---

## 5. What's free right now

| Thing | Cost | Gate |
| ----- | ---- | ---- |
| Bridge demo dataset | Free | None |
| Bridge developer account | Free | Registration |
| NTREIS feed via Bridge | Free for approved uses | MLS approval + broker signature |
| NTREIS feed via Trestle | Paid | MLS approval + broker signature |
| County appraisal data | Already yours | Big District |

The demo dataset is what the **Test tab** runs on. Real RESO field names and
types; generated values. 10,000 properties, 1,000 members, 200 offices — and
**zero Media records**, so photo handling can't be prototyped until the live
feed lands.

⚠️ **Geography in the demo data is fake.** Every record's `CountyOrParish` is
the literal string `"County"`. Filtering to your four counties returns zero rows
there. The filter is correct; it starts working when the live feed does.

---

## 6. RESO field gotchas

- **`ListingKey` ≠ `ListingId`.** `ListingKey` is immutable and the only safe
  sync key. `ListingId` is the human-facing MLS number and it *changes* on
  relist, correction, or transfer. Key on the wrong one and a relist silently
  forks into two records.
- **`ListPrice` is dollars.** This repo stores integer cents everywhere. The
  conversion happens once, in `server/mls/bridge.ts`.
- **`ParcelNumber` is the Big District join key.** Carry it from day one —
  see §8.
- **`StandardStatus`** is normalized; **`MlsStatus`** is the MLS's own
  vocabulary. Map from the former, keep the latter if agents expect their words.
- **Most fields are empty.** A Property row is 620 fields on the demo dataset,
  386 null in every record. Check the **Field coverage** tab before modelling a
  column.

---

## 7. Sync design rules

The Test tab reads straight through. A real sync must not.

1. **Page on a watermark, not an offset.** Filter
   `ModificationTimestamp gt <last seen>`, order by the same column, carry the
   last value forward. `$skip` over a mutating dataset silently drops and
   duplicates rows.
2. **Deletes are invisible.** A listing leaving the feed never appears as a
   modification. You need the replication endpoint's removal reporting or a
   periodic full-key reconciliation, or the cache grows ghosts.
3. **The cache is not your system of record.** Licences cap retention and
   require attribution. Keep MLS rows in their own table with provenance and a
   TTL, separate from the agent-owned `listings` table, joined by nullable FK.
   Then a truncate-and-resync is safe and your own data survives a licence
   ending.
4. **Filter to your own listings where you can.** A BBO feed exposes
   `ListAgentMlsId`. Caching only your listings keeps the dataset tiny and cuts
   retention exposure.

**Why no cache table yet:** a cache built before the licence terms are known
usually gets rebuilt after they arrive.

---

## 8. Big District

Big District already has CAD data for **Collin, Dallas, Denton, Tarrant**.

- **Join on `ParcelNumber`.** Both sides key on parcel/account number. Carry it
  through from day one — retrofitting means fuzzy-matching MLS addresses against
  a CAD, which fails on abbreviations, unit designators, and annexation-era
  renames.
- **Coverage is partial.** NTREIS spans ~48,000 sq mi and 14 associations, so
  Rockwall, Ellis, Johnson, Parker, Kaufman and Grayson have no Big District
  data. CAD fields are nullable-unknown — never treat a missing assessed value
  as `$0`.
- **Fill rate varies by MLS.** Check `ParcelNumber` in the Field coverage tab
  once the live feed is on. That number decides how the join gets built.

---

## 9. What's in this repo

| Path | What |
| ---- | ---- |
| `server/mls/bridge.ts` | OData client. Config, filter allowlist, cents conversion. |
| `server/routes/mls.routes.ts` | Four read-only endpoints under `/api/mls`. |
| `apps/web/src/mls/` | Explorer, field coverage, raw-record drawer, in-app docs. |
| `apps/web/src/routes/TestLab.tsx` | The **Test** tab. |

Endpoints: `/api/mls/status`, `/search`, `/property/:key`, `/field-coverage`.

The token stays server-side — a server token in browser JS is liftable from
devtools, and Bridge doesn't send CORS headers a browser fetch would need.

**To go live:** set `BRIDGE_TOKEN` and `BRIDGE_DATASET` in `.env` (template in
`.env.example`). Nothing else in the code changes.

---

## 10. Links

**Bridge**
- Dashboard / register — https://bridgedataoutput.com/register
- API docs — https://bridgedataoutput.com/docs
- Web API reference — https://bridgedataoutput.com/docs/platform/API/bridge
- Registration & data access — https://bridgedataoutput.com/docs/platform/Dashboard/registration

**Trestle** (fallback if NTREIS isn't on Bridge)
- Subscribe — https://trestle.corelogic.com/SubscriptionWizard
- Getting started — https://trestle-documentation.corelogic.com/webapi.html

**RESO**
- Data Dictionary wiki — every field, defined — https://ddwiki.reso.org/
- Web API reference server — https://www.reso.org/web-api-developer-reference-server/

**NTREIS**
- https://www.ntreis.net/

**Background**
- IDX vs VOW vs BBO explained — https://cdatalabs.com/real-estate-data-compliance-101-idx-vow-and-bbo-broker-back-office-access-explained/

---

## 11. Compliance

Display rules, attribution, and retention limits are per-MLS and live in your
licence — read the actual agreement, not a summary. `PLAN.md` §5 covers the
outbound-messaging side (TCPA, DNC, CAN-SPAM, Fair Housing), which is separate
and applies regardless of where listing data comes from.
