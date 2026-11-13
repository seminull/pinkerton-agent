import { Hono } from "hono";
import { Op, QueryTypes, UniqueConstraintError, type WhereOptions } from "sequelize";
import type { AuthEnv } from "../auth";
import { apiError, parsePage, pickFields, requireNonEmpty, requireUuid } from "../http";
import { sequelize, TimeEntry } from "../sequelize/models";
import { activeOptionNames, withTimeOptions } from "../time-options";
import type { TimeDayTotals, TimeSummary } from "../types";

// Mounted at /api/time-entries. The Time Clock: start a task, stop it, and the
// span is recorded.
//
// Every query here is scoped to the signed-in user. That scoping is the access
// control — there is no route that takes a user id — so a new query added to
// this file must carry `userId` too.
//
// Start and Stop stamp the SERVER's clock, never a value from the request: a
// browser clock can be wrong, and the recorded span should be what happened.
// Times can still be corrected afterwards through PATCH — people forget to press
// Stop — but that is a deliberate edit of a finished entry, with its own checks,
// not something the timer itself accepts.

const app = new Hono<AuthEnv>();

// Categories and work types are each user's own lists (the Setup tab — see
// routes/time-options.routes.ts). This makes sure the signed-in user has theirs
// before any route below validates against them or joins to them.
app.use("*", withTimeOptions);

// How the totals decide what an entry counts as. Entries store their category
// and work type as text; these joins look each up in the user's own lists to
// find out whether it is a break and whether it is their own time.
//
// LEFT JOIN + COALESCE(false): an entry whose name matches no row counts as
// ordinary work. That shouldn't happen — a rename updates the entries and a
// used option can only be archived, not deleted — but if it ever does, the
// honest fallback is "work", not dropping the time from every total.
//
// Fixed strings with no request data in them, so they are safe to splice into
// the two queries below.
const CLASSIFY = `COALESCE(c."isBreak", false) AS is_break,
              COALESCE(NOT w."countsAsOwnTime", false) AS is_assistant`;
const CLASSIFY_JOINS = `LEFT JOIN time_categories c ON c."userId" = e."userId" AND c.name = e.category
         LEFT JOIN time_work_types w ON w."userId" = e."userId" AND w.name = e."workType"`;

const WRITABLE_ON_START = ["category", "task", "reference", "workType", "notes"] as const;
const WRITABLE_ON_EDIT = [...WRITABLE_ON_START, "startedAt", "endedAt"] as const;

// How far past "now" an edited end time may be. Not zero: the user's clock and
// the server's are never exactly in step, and rejecting "now" as "the future"
// because of a few seconds of drift would be maddening.
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const MAX_TASK = 200;
const MAX_REFERENCE = 100;
const MAX_NOTES = 1000;

// Trim, and turn blank into null — "nullable means unknown", not "".
const optionalText = (value: unknown, max: number, field: string): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > max) {
    throw apiError(422, "validation_failed", { [field]: `Up to ${max} characters.` });
  }
  return value.trim() || null;
};

// ?from=&to= are ISO instants bounding startedAt: [from, to). The CLIENT works
// out where "today" starts and ends, because only the browser knows the user's
// time zone — the server's midnight is not theirs.
const parseRange = (query: Record<string, string | undefined>): WhereOptions | null => {
  const bound = (raw: string | undefined): Date | null => {
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) throw apiError(400, "invalid_range");
    return date;
  };
  const from = bound(query.from);
  const to = bound(query.to);
  if (!from && !to) return null;
  return {
    startedAt: {
      ...(from ? { [Op.gte]: from } : {}),
      ...(to ? { [Op.lt]: to } : {}),
    },
  };
};

// GET /api/time-entries?from=&to=&limit=&offset=
// Completed entries only, newest first. The running task is not history yet;
// it has its own route below.
app.get("/", async (c) => {
  const query = c.req.query();
  const { limit, offset } = parsePage(query);
  const range = parseRange(query);

  const { rows, count } = await TimeEntry.findAndCountAll({
    where: {
      userId: c.get("auth").user.id,
      endedAt: { [Op.not]: null },
      ...(range ?? {}),
    },
    order: [["startedAt", "DESC"]],
    limit,
    offset,
  });
  return c.json({ results: rows, total: count });
});

// GET /api/time-entries/active — the running task, or null.
// 200 with null rather than 404: "nothing is running" is the normal state of
// the page, not an error.
app.get("/active", async (c) => {
  const entry = await TimeEntry.findOne({
    where: { userId: c.get("auth").user.id, endedAt: null },
  });
  return c.json({ entry });
});

// GET /api/time-entries/summary?from=&to=
// Totals over completed entries. Done in SQL, not by summing a page of rows in
// the browser, so "all recorded days" stays correct past the first page.
//
// Each entry is rounded to whole minutes BEFORE summing, so a total always
// equals the sum of the Minutes column the user can see. Rounding the grand
// total instead would leave the two disagreeing by a minute here and there.
app.get("/summary", async (c) => {
  const query = c.req.query();
  // Validated through the same parser as the list, then passed as plain
  // parameters — nothing from the request is ever spliced into the SQL.
  parseRange(query);
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;

  const [row] = await sequelize.query<TimeSummary>(
    `SELECT
       COALESCE(SUM(minutes) FILTER (WHERE NOT is_break AND NOT is_assistant), 0)::int
         AS "workMinutes",
       COALESCE(SUM(minutes) FILTER (WHERE is_break), 0)::int AS "breakMinutes",
       COALESCE(SUM(minutes) FILTER (WHERE is_assistant), 0)::int AS "assistantMinutes",
       COUNT(*)::int AS "entryCount"
     FROM (
       SELECT ${CLASSIFY},
              GREATEST(0, ROUND(EXTRACT(EPOCH FROM (e."endedAt" - e."startedAt")) / 60)) AS minutes
         FROM time_entries e
         ${CLASSIFY_JOINS}
        WHERE e."userId" = :userId
          AND e."endedAt" IS NOT NULL
          AND (CAST(:from AS timestamptz) IS NULL OR e."startedAt" >= :from)
          AND (CAST(:to AS timestamptz) IS NULL OR e."startedAt" < :to)
     ) AS completed`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        userId: c.get("auth").user.id,
        from,
        to,
      },
    }
  );
  return c.json({ summary: row });
});

// An IANA zone name ("America/Chicago"), checked by asking the runtime whether
// it knows it. Postgres would reject a bad one too, but as a 500; this makes it
// the 400 it is.
const parseTimeZone = (raw: string | undefined): string => {
  if (!raw) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    throw apiError(400, "invalid_time_zone");
  }
};

// GET /api/time-entries/daily?from=&to=&tz=
// One row of totals per calendar day that has completed entries — what the
// calendar view paints into its cells. Days with nothing recorded are simply
// absent.
//
// "Which day" depends on where the user is: 11pm Tuesday in Dallas is already
// Wednesday in UTC. So the browser sends its zone and the grouping happens in
// it. An entry belongs to the day it STARTED on, the same rule the range
// filter and Today's totals use, so a task that runs past midnight is counted
// once, on the day it began.
app.get("/daily", async (c) => {
  const query = c.req.query();
  parseRange(query);
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;

  const days = await sequelize.query<TimeDayTotals>(
    `SELECT
       to_char(day, 'YYYY-MM-DD') AS day,
       COALESCE(SUM(minutes) FILTER (WHERE NOT is_break AND NOT is_assistant), 0)::int
         AS "workMinutes",
       COALESCE(SUM(minutes) FILTER (WHERE is_break), 0)::int AS "breakMinutes",
       COALESCE(SUM(minutes) FILTER (WHERE is_assistant), 0)::int AS "assistantMinutes",
       COUNT(*)::int AS "entryCount"
     FROM (
       SELECT ${CLASSIFY},
              (e."startedAt" AT TIME ZONE :tz)::date AS day,
              GREATEST(0, ROUND(EXTRACT(EPOCH FROM (e."endedAt" - e."startedAt")) / 60)) AS minutes
         FROM time_entries e
         ${CLASSIFY_JOINS}
        WHERE e."userId" = :userId
          AND e."endedAt" IS NOT NULL
          AND (CAST(:from AS timestamptz) IS NULL OR e."startedAt" >= :from)
          AND (CAST(:to AS timestamptz) IS NULL OR e."startedAt" < :to)
     ) AS completed
     GROUP BY day
     ORDER BY day`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        userId: c.get("auth").user.id,
        from,
        to,
        tz: parseTimeZone(query.tz),
      },
    }
  );
  return c.json({ days });
});

// POST /api/time-entries/start  { category, task, reference?, workType, notes? }
app.post("/start", async (c) => {
  const values = pickFields(await c.req.json(), WRITABLE_ON_START);

  const details: Record<string, string> = {};
  const task = typeof values.task === "string" ? values.task.trim() : "";
  if (!task || task.length > MAX_TASK) {
    details.task = `Enter a task description (up to ${MAX_TASK} characters).`;
  }
  // Only what is currently offered — an archived option can't start new time.
  const allowed = await activeOptionNames(c.get("auth").user.id);
  if (!allowed.categories.has(values.category as string)) details.category = "Choose a category.";
  if (!allowed.workTypes.has(values.workType as string)) details.workType = "Choose a work type.";
  if (Object.keys(details).length > 0) throw apiError(422, "validation_failed", details);

  try {
    const entry = await TimeEntry.create({
      userId: c.get("auth").user.id,
      category: values.category as string,
      task,
      reference: optionalText(values.reference, MAX_REFERENCE, "reference"),
      workType: values.workType as string,
      notes: optionalText(values.notes, MAX_NOTES, "notes"),
      startedAt: new Date(),
      endedAt: null,
    });
    return c.json({ entry }, 201);
  } catch (err) {
    // The one-running-task-per-user index. Reaching it means a task is already
    // running — started in another tab or on another device.
    if (err instanceof UniqueConstraintError) throw apiError(409, "task_already_running");
    throw err;
  }
});

// POST /api/time-entries/stop — ends whatever is running.
// Takes no id: a user has at most one running task, so there is nothing to
// choose, and nothing for a stale tab to get wrong.
app.post("/stop", async (c) => {
  const entry = await TimeEntry.findOne({
    where: { userId: c.get("auth").user.id, endedAt: null },
  });
  if (!entry) throw apiError(409, "no_task_running");
  await entry.update({ endedAt: new Date() });
  return c.json({ entry });
});

// PATCH /api/time-entries/:id
//   { category?, task?, reference?, workType?, notes?, startedAt?, endedAt? }
//
// Corrects a finished entry: fix a typo, recategorise, or repair the times
// after a forgotten Stop. Only completed entries — the running task is changed
// by stopping it, and letting an edit set its end time would be a second,
// subtly different way to stop the clock.
app.patch("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const values = pickFields(await c.req.json(), WRITABLE_ON_EDIT);
  requireNonEmpty(values);

  // Scoped by userId like every query here: someone else's entry is a 404.
  const entry = await TimeEntry.findOne({ where: { id, userId: c.get("auth").user.id } });
  if (!entry) throw apiError(404, "time_entry_not_found");
  if (entry.endedAt === null) throw apiError(409, "task_still_running");

  const details: Record<string, string> = {};
  const changes: Record<string, unknown> = {};

  if ("task" in values) {
    const task = typeof values.task === "string" ? values.task.trim() : "";
    if (!task || task.length > MAX_TASK) {
      details.task = `Enter a task description (up to ${MAX_TASK} characters).`;
    }
    changes.task = task;
  }
  // An edit may keep the value the entry already has even if that option has
  // since been archived — otherwise fixing a typo in an old entry's notes would
  // force recategorising it. Anything it CHANGES to must be currently offered.
  const allowed = await activeOptionNames(c.get("auth").user.id);
  if ("category" in values) {
    if (values.category !== entry.category && !allowed.categories.has(values.category as string)) {
      details.category = "Choose a category.";
    }
    changes.category = values.category;
  }
  if ("workType" in values) {
    if (values.workType !== entry.workType && !allowed.workTypes.has(values.workType as string)) {
      details.workType = "Choose a work type.";
    }
    changes.workType = values.workType;
  }

  // Times are validated as a pair even when only one is sent, against the
  // stored value of the other — the rule is about the resulting span.
  const time = (field: "startedAt" | "endedAt", current: Date): Date => {
    if (!(field in values)) return current;
    const raw = values[field];
    const date = typeof raw === "string" ? new Date(raw) : new Date(Number.NaN);
    if (Number.isNaN(date.getTime())) {
      details[field] = "Enter a valid date and time.";
      return current;
    }
    changes[field] = date;
    return date;
  };
  const startedAt = time("startedAt", entry.startedAt);
  const endedAt = time("endedAt", entry.endedAt);
  if (!details.startedAt && !details.endedAt) {
    if (endedAt.getTime() <= startedAt.getTime()) {
      details.endedAt = "The end time must be after the start time.";
    } else if (endedAt.getTime() > Date.now() + CLOCK_SKEW_MS) {
      details.endedAt = "The end time can't be in the future.";
    }
  }

  if (Object.keys(details).length > 0) throw apiError(422, "validation_failed", details);

  // After the 422 above, so a length problem in an optional field (which
  // throws its own) is only reached once everything else is known good.
  if ("reference" in values) {
    changes.reference = optionalText(values.reference, MAX_REFERENCE, "reference");
  }
  if ("notes" in values) changes.notes = optionalText(values.notes, MAX_NOTES, "notes");

  await entry.update(changes as never);
  return c.json({ entry });
});

// DELETE /api/time-entries/:id
// `userId` in the WHERE is what stops one user deleting another's entry; a
// wrong owner and a missing id are deliberately the same 404.
app.delete("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const deleted = await TimeEntry.destroy({
    where: { id, userId: c.get("auth").user.id },
  });
  if (deleted === 0) throw apiError(404, "time_entry_not_found");
  return c.body(null, 204);
});

export default app;
