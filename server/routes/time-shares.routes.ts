import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { QueryTypes } from "sequelize";
import type { AuthEnv } from "../auth";
import { apiError, parsePage, pickFields } from "../http";
import { sequelize, TimeShare, User, type TimeShareInstance } from "../sequelize/models";
import type { TimeDayTotals, TimeSummary } from "../types";

const privateApp = new Hono<AuthEnv>();
const publicApp = new Hono();

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAILY_RANGE_DAYS = 75;

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const parseTimeZone = (raw: unknown): string => {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 100) {
    throw apiError(422, "invalid_time_zone");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    throw apiError(422, "invalid_time_zone");
  }
};

// Date-only strings are parsed by components rather than `new Date(raw)`, so
// impossible dates cannot silently roll into the following month.
const parseDay = (raw: unknown, error = "invalid_day"): string => {
  if (typeof raw !== "string" || !DAY_RE.test(raw)) throw apiError(400, error);
  const [year, month, day] = raw.split("-").map(Number);
  const roundTrip = new Date(Date.UTC(year!, month! - 1, day!)).toISOString().slice(0, 10);
  if (roundTrip !== raw) throw apiError(400, error);
  return raw;
};

const todayIn = (timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

// POST /api/time-shares  { scope, day, timeZone }
// The raw token is returned once. Only its SHA-256 is retained, following the
// same rule as session cookies: a database reader should not gain the link.
privateApp.post("/", async (c) => {
  const values = pickFields(await c.req.json(), ["scope", "day", "timeZone"] as const);
  const scope = values.scope;
  if (scope !== "calendar" && scope !== "day") {
    throw apiError(422, "validation_failed", { scope: "Choose calendar or day." });
  }
  const timeZone = parseTimeZone(values.timeZone);
  const day = parseDay(values.day);
  if (day > todayIn(timeZone)) {
    throw apiError(422, "validation_failed", { day: "Choose today or an earlier day." });
  }

  const token = randomBytes(32).toString("base64url");
  const share = await TimeShare.create({
    userId: c.get("auth").user.id,
    tokenHash: sha256Hex(token),
    scope,
    day,
    timeZone,
  });

  return c.json(
    {
      share: {
        token,
        scope,
        day,
        timeZone,
        createdAt: share.createdAt,
      },
    },
    201
  );
});

const resolveShare = async (raw: string | undefined): Promise<TimeShareInstance> => {
  // Hashing only canonical token-shaped strings avoids turning arbitrary-size
  // path input into work and makes every malformed/unknown link look the same.
  if (!raw || !TOKEN_RE.test(raw)) throw apiError(404, "time_share_not_found");
  const share = await TimeShare.findOne({ where: { tokenHash: sha256Hex(raw) } });
  if (!share) throw apiError(404, "time_share_not_found");

  // Disabling an account closes every way its data can be read, including
  // links that were created before it was disabled.
  const activeOwner = await User.count({ where: { id: share.userId, status: "active" } });
  if (activeOwner === 0) throw apiError(404, "time_share_not_found");
  return share;
};

const publicShare = (share: TimeShareInstance) => ({
  scope: share.scope === "day" ? ("day" as const) : ("calendar" as const),
  day: share.day,
  timeZone: share.timeZone,
  createdAt: share.createdAt,
});

// GET /api/public/time-shares/:token
publicApp.get("/:token", async (c) => {
  const share = await resolveShare(c.req.param("token"));
  return c.json({ share: publicShare(share) });
});

interface SharedEntryRow {
  id: string;
  category: string;
  task: string;
  workType: string;
  notes: string | null;
  startedAt: Date;
  endedAt: Date;
  kind: "work" | "break" | "assistant";
  totalCount: number;
}

const requestedDay = (share: TimeShareInstance, raw: string | undefined): string => {
  // A day-scoped capability never accepts another date from its caller. The
  // restriction is enforced here at the data boundary, not by hidden UI.
  if (share.scope === "day") return share.day;
  return parseDay(raw);
};

// GET /api/public/time-shares/:token/entries?day=&limit=&offset=
// `reference` is deliberately absent from the SELECT. It therefore cannot be
// recovered from browser state, source maps, or a hand-written API request.
publicApp.get("/:token/entries", async (c) => {
  const share = await resolveShare(c.req.param("token"));
  const query = c.req.query();
  const day = requestedDay(share, query.day);
  const { limit, offset } = parsePage(query);

  const rows = await sequelize.query<SharedEntryRow>(
    `SELECT e.id,
            e.category,
            e.task,
            e."workType",
            e.notes,
            e."startedAt",
            e."endedAt",
            CASE
              WHEN COALESCE(c."isBreak", false) THEN 'break'
              WHEN COALESCE(NOT w."countsAsOwnTime", false) THEN 'assistant'
              ELSE 'work'
            END AS kind,
            COUNT(*) OVER()::int AS "totalCount"
       FROM time_entries e
       LEFT JOIN time_categories c
         ON c."userId" = e."userId" AND c.name = e.category
       LEFT JOIN time_work_types w
         ON w."userId" = e."userId" AND w.name = e."workType"
      WHERE e."userId" = :userId
        AND e."endedAt" IS NOT NULL
        AND e."startedAt" >= (CAST(:day AS date) AT TIME ZONE :timeZone)
        AND e."startedAt" < ((CAST(:day AS date) + 1) AT TIME ZONE :timeZone)
      ORDER BY e."startedAt" DESC
      LIMIT :limit OFFSET :offset`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        userId: share.userId,
        day,
        timeZone: share.timeZone,
        limit,
        offset,
      },
    }
  );

  const results = rows.map(({ totalCount: _totalCount, ...entry }) => entry);
  return c.json({ results, total: rows[0]?.totalCount ?? 0 });
});

// GET /api/public/time-shares/:token/daily?fromDay=&toDay=
// Calendar shares fetch only the padded month currently on screen. Limiting
// the span prevents one public URL from becoming an unbounded reporting query.
publicApp.get("/:token/daily", async (c) => {
  const share = await resolveShare(c.req.param("token"));
  if (share.scope !== "calendar") throw apiError(404, "time_share_not_found");
  const query = c.req.query();
  const fromDay = parseDay(query.fromDay, "invalid_range");
  const toDay = parseDay(query.toDay, "invalid_range");
  const span = (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000;
  if (span <= 0 || span > MAX_DAILY_RANGE_DAYS) throw apiError(400, "invalid_range");

  const days = await sequelize.query<TimeDayTotals>(
    `SELECT
       to_char(day, 'YYYY-MM-DD') AS day,
       COALESCE(SUM(minutes) FILTER (WHERE NOT is_break AND NOT is_assistant), 0)::int
         AS "workMinutes",
       COALESCE(SUM(minutes) FILTER (WHERE is_break), 0)::int AS "breakMinutes",
       COALESCE(SUM(minutes) FILTER (WHERE is_assistant), 0)::int AS "assistantMinutes",
       COUNT(*)::int AS "entryCount"
     FROM (
       SELECT COALESCE(c."isBreak", false) AS is_break,
              COALESCE(NOT w."countsAsOwnTime", false) AS is_assistant,
              (e."startedAt" AT TIME ZONE :timeZone)::date AS day,
              GREATEST(0, ROUND(EXTRACT(EPOCH FROM (e."endedAt" - e."startedAt")) / 60)) AS minutes
         FROM time_entries e
         LEFT JOIN time_categories c
           ON c."userId" = e."userId" AND c.name = e.category
         LEFT JOIN time_work_types w
           ON w."userId" = e."userId" AND w.name = e."workType"
        WHERE e."userId" = :userId
          AND e."endedAt" IS NOT NULL
          AND e."startedAt" >= (CAST(:fromDay AS date) AT TIME ZONE :timeZone)
          AND e."startedAt" < (CAST(:toDay AS date) AT TIME ZONE :timeZone)
     ) AS completed
     GROUP BY day
     ORDER BY day`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        userId: share.userId,
        timeZone: share.timeZone,
        fromDay,
        toDay,
      },
    }
  );
  return c.json({ days });
});

// GET /api/public/time-shares/:token/summary
// A day share is restricted to its fixed day. A calendar share reports the
// all-time card shown under the private calendar, without exposing its rows.
publicApp.get("/:token/summary", async (c) => {
  const share = await resolveShare(c.req.param("token"));
  const dayPredicate =
    share.scope === "day"
      ? `AND e."startedAt" >= (CAST(:day AS date) AT TIME ZONE :timeZone)
         AND e."startedAt" < ((CAST(:day AS date) + 1) AT TIME ZONE :timeZone)`
      : "";

  const [summary] = await sequelize.query<TimeSummary>(
    `SELECT
       COALESCE(SUM(minutes) FILTER (WHERE NOT is_break AND NOT is_assistant), 0)::int
         AS "workMinutes",
       COALESCE(SUM(minutes) FILTER (WHERE is_break), 0)::int AS "breakMinutes",
       COALESCE(SUM(minutes) FILTER (WHERE is_assistant), 0)::int AS "assistantMinutes",
       COUNT(*)::int AS "entryCount"
     FROM (
       SELECT COALESCE(c."isBreak", false) AS is_break,
              COALESCE(NOT w."countsAsOwnTime", false) AS is_assistant,
              GREATEST(0, ROUND(EXTRACT(EPOCH FROM (e."endedAt" - e."startedAt")) / 60)) AS minutes
         FROM time_entries e
         LEFT JOIN time_categories c
           ON c."userId" = e."userId" AND c.name = e.category
         LEFT JOIN time_work_types w
           ON w."userId" = e."userId" AND w.name = e."workType"
        WHERE e."userId" = :userId
          AND e."endedAt" IS NOT NULL
          ${dayPredicate}
     ) AS completed`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        userId: share.userId,
        day: share.day,
        timeZone: share.timeZone,
      },
    }
  );
  return c.json({ summary });
});

export { publicApp as publicTimeShareRoutes };
export default privateApp;
