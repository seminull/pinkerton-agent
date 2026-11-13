import { Hono } from "hono";
import { QueryTypes } from "sequelize";
import type { AuthEnv } from "../auth";
import { parseTimeZone } from "../http";
import { sequelize } from "../sequelize/models";
import type { DashboardData } from "../types";

// GET /api/dashboard?tz=
//
// Every number on the dashboard, aggregated in Postgres. The dashboard used to
// sum the first page of /api/listings in the browser, which is only right
// until there are more rows than one page; this route is the "add an aggregate
// endpoint" that comment asked for. One request, one round of queries run in
// parallel, and the client never holds a whole table.
//
// Like the rest of the CRM tables (see "Things not built yet" in CLAUDE.md),
// contacts, listings and activities have no owner yet, so these numbers are
// for everything in the database. When they gain an owner, every query here
// needs the same scope.
//
// `tz` is the browser's IANA zone. Months and weeks are bucketed in it, so a
// lead created at 9 PM on the 31st in Dallas lands in that month, not the
// next one in UTC.

const app = new Hono<AuthEnv>();

// The pipeline's own order (the contacts.stage enum), so the funnel reads left
// to right the way a lead moves and an empty stage still gets its bar.
const STAGES = ["new", "contacted", "qualified", "active", "closed", "lost"] as const;

// Sources past the top few fold into "Other": a long tail of one-off sources
// would otherwise squeeze every bar to a sliver and push the useful ones off
// the chart.
const TOP_SOURCES = 6;

const MONTHS = 12;
const WEEKS = 12;
// The longest-listed homes are the ones that need a price conversation; ten is
// enough to find them without the chart becoming a full inventory report.
const DAYS_ON_MARKET_LIMIT = 10;

app.get("/", async (c) => {
  const tz = parseTimeZone(c.req.query("tz"));
  const replacements = { tz };
  const select = { type: QueryTypes.SELECT, replacements } as const;

  const [tiles, stageRows, leadsByMonth, touchpointsByWeek, sourceRows, daysOnMarket] =
    await Promise.all([
      sequelize.query<{
        contactCount: number;
        activeListingCount: number;
        activeVolumeCents: string;
        overdueFollowUps: number;
        dueThisWeek: number;
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM contacts) AS "contactCount",
           (SELECT COUNT(*)::int FROM listings WHERE status = 'active') AS "activeListingCount",
           -- Text, not a JS number from the driver: BIGINT sums arrive as
           -- strings, and the client converts at the edge like every price.
           (SELECT COALESCE(SUM("listPriceCents"), 0)::text
              FROM listings WHERE status = 'active') AS "activeVolumeCents",
           -- An open activity (completedAt NULL) whose time has passed is a
           -- follow-up that was missed, whatever its type.
           (SELECT COUNT(*)::int FROM activities
             WHERE "completedAt" IS NULL AND "occurredAt" < now()) AS "overdueFollowUps",
           (SELECT COUNT(*)::int FROM activities
             WHERE "completedAt" IS NULL
               AND "occurredAt" >= now()
               AND "occurredAt" < now() + interval '7 days') AS "dueThisWeek"`,
        select
      ),

      sequelize.query<{ stage: string; count: number }>(
        `SELECT stage::text AS stage, COUNT(*)::int AS count FROM contacts GROUP BY stage`,
        select
      ),

      // generate_series supplies every month, so a month with no leads is a
      // zero-height bar rather than a gap the axis silently closes up.
      sequelize.query<DashboardData["leadsByMonth"][number]>(
        `WITH months AS (
           SELECT generate_series(
                    date_trunc('month', now() AT TIME ZONE :tz) - interval '${MONTHS - 1} months',
                    date_trunc('month', now() AT TIME ZONE :tz),
                    interval '1 month'
                  ) AS month
         )
         SELECT to_char(m.month, 'YYYY-MM') AS month,
                COUNT(ct.id) FILTER (WHERE ct.type = 'buyer')::int AS buyer,
                COUNT(ct.id) FILTER (WHERE ct.type = 'seller')::int AS seller,
                COUNT(ct.id) FILTER (WHERE ct.type = 'both')::int AS both
           FROM months m
           LEFT JOIN contacts ct
             ON date_trunc('month', ct."createdAt" AT TIME ZONE :tz) = m.month
          GROUP BY m.month
          ORDER BY m.month`,
        select
      ),

      // Completed client-facing work only. Notes and tasks are the agent
      // talking to themselves, and an open item hasn't happened yet; counting
      // either would make a week of admin look like a week of prospecting.
      // Weeks start Monday (Postgres' ISO week).
      sequelize.query<DashboardData["touchpointsByWeek"][number]>(
        `WITH weeks AS (
           SELECT generate_series(
                    date_trunc('week', now() AT TIME ZONE :tz) - interval '${WEEKS - 1} weeks',
                    date_trunc('week', now() AT TIME ZONE :tz),
                    interval '1 week'
                  ) AS week
         )
         SELECT to_char(w.week, 'YYYY-MM-DD') AS week,
                COUNT(a.id) FILTER (WHERE a.type = 'call')::int AS calls,
                COUNT(a.id) FILTER (WHERE a.type IN ('text', 'email'))::int AS messages,
                COUNT(a.id) FILTER (WHERE a.type = 'showing')::int AS showings,
                COUNT(a.id) FILTER (WHERE a.type = 'meeting')::int AS meetings
           FROM weeks w
           LEFT JOIN activities a
             ON date_trunc('week', a."occurredAt" AT TIME ZONE :tz) = w.week
            AND a."completedAt" IS NOT NULL
          GROUP BY w.week
          ORDER BY w.week`,
        select
      ),

      // Source is free text. The convention in use is "Kind — detail"
      // ("Referral — J. Kim", "Open house — 4/12"), so grouping on the part
      // before the em dash counts referrals as one source rather than one per
      // referrer. A blank source is "Unknown", which is itself worth seeing.
      sequelize.query<{ source: string; contacts: number; closed: number }>(
        `SELECT COALESCE(NULLIF(trim(split_part(source, ' — ', 1)), ''), 'Unknown') AS source,
                COUNT(*)::int AS contacts,
                COUNT(*) FILTER (WHERE stage = 'closed')::int AS closed
           FROM contacts
          WHERE "createdAt" >= now() - interval '${MONTHS} months'
          GROUP BY 1
          ORDER BY contacts DESC, source`,
        select
      ),

      // Counted in the agent's own calendar days: listedOn is a date with no
      // zone, so "today" has to be the browser's today, not the server's.
      sequelize.query<DashboardData["daysOnMarket"][number]>(
        `SELECT id,
                "addressLine1" AS address,
                city,
                ((now() AT TIME ZONE :tz)::date - "listedOn")::int AS days,
                "listPriceCents"::text AS "listPriceCents"
           FROM listings
          WHERE status = 'active' AND "listedOn" IS NOT NULL
          ORDER BY days DESC, address
          LIMIT ${DAYS_ON_MARKET_LIMIT}`,
        select
      ),
    ]);

  const stageCounts = new Map(stageRows.map((row) => [row.stage, row.count]));
  const pipeline = STAGES.map((stage) => ({ stage, count: stageCounts.get(stage) ?? 0 }));

  const top = sourceRows.slice(0, TOP_SOURCES);
  const rest = sourceRows.slice(TOP_SOURCES);
  const leadSources =
    rest.length === 0
      ? top
      : [
          ...top,
          rest.reduce(
            (other, row) => ({
              source: "Other",
              contacts: other.contacts + row.contacts,
              closed: other.closed + row.closed,
            }),
            { source: "Other", contacts: 0, closed: 0 }
          ),
        ];

  const body: DashboardData = {
    tiles: tiles[0]!,
    pipeline,
    leadsByMonth,
    touchpointsByWeek,
    leadSources,
    daysOnMarket,
  };
  return c.json(body);
});

export default app;
