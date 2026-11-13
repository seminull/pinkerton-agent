import { Hono } from "hono";
import { Op, QueryTypes, UniqueConstraintError, type WhereOptions } from "sequelize";
import type { AuthEnv } from "../auth";
import { apiError, parsePage, pickFields, requireUuid } from "../http";
import { sequelize, TimeEntry } from "../sequelize/models";
import type { TimeSummary } from "../types";

// Mounted at /api/time-entries. The Time Clock: start a task, stop it, and the
// span is recorded.
//
// Every query here is scoped to the signed-in user. That scoping is the access
// control — there is no route that takes a user id — so a new query added to
// this file must carry `userId` too.
//
// Timestamps are the SERVER's clock, never a value from the request. A browser
// clock can be wrong or deliberately changed, and a time study is only worth
// anything if its start and stop times can't be typed in.

const app = new Hono<AuthEnv>();

// The pick lists. Mirrored in apps/web/src/timeclock/options.ts for the
// dropdowns; this copy is the one that is enforced.
const CATEGORIES = [
  "Closing Preparation",
  "Title / Curative",
  "Email / Correspondence",
  "Phone Calls / Interruptions",
  "HOA / Survey / Payoffs",
  "Qualia / Administration",
  "Assistant Training / Delegation",
  "Assistant Work Review",
  "Escalations / Rework",
  "Time Study Administration",
  "Lunch / Break",
  "Other",
] as const;

const WORK_TYPES = [
  "My work",
  "Training / supervising assistant",
  "Reviewing assistant work",
  "Assistant work (not my time)",
] as const;

// The two values the totals treat specially. Named so the SQL below and the
// lists above can't drift apart silently if a label is reworded.
const BREAK_CATEGORY: (typeof CATEGORIES)[number] = "Lunch / Break";
const ASSISTANT_WORK_TYPE: (typeof WORK_TYPES)[number] = "Assistant work (not my time)";

const WRITABLE_ON_START = ["category", "task", "reference", "workType", "notes"] as const;

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
       COALESCE(SUM(minutes) FILTER (
         WHERE category <> :breakCategory AND "workType" <> :assistantWorkType), 0)::int
         AS "workMinutes",
       COALESCE(SUM(minutes) FILTER (WHERE category = :breakCategory), 0)::int
         AS "breakMinutes",
       COALESCE(SUM(minutes) FILTER (WHERE "workType" = :assistantWorkType), 0)::int
         AS "assistantMinutes",
       COUNT(*)::int AS "entryCount"
     FROM (
       SELECT category, "workType",
              GREATEST(0, ROUND(EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) / 60)) AS minutes
         FROM time_entries
        WHERE "userId" = :userId
          AND "endedAt" IS NOT NULL
          AND (CAST(:from AS timestamptz) IS NULL OR "startedAt" >= :from)
          AND (CAST(:to AS timestamptz) IS NULL OR "startedAt" < :to)
     ) AS completed`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        userId: c.get("auth").user.id,
        from,
        to,
        breakCategory: BREAK_CATEGORY,
        assistantWorkType: ASSISTANT_WORK_TYPE,
      },
    }
  );
  return c.json({ summary: row });
});

// POST /api/time-entries/start  { category, task, reference?, workType, notes? }
app.post("/start", async (c) => {
  const values = pickFields(await c.req.json(), WRITABLE_ON_START);

  const details: Record<string, string> = {};
  const task = typeof values.task === "string" ? values.task.trim() : "";
  if (!task || task.length > MAX_TASK) {
    details.task = `Enter a task description (up to ${MAX_TASK} characters).`;
  }
  if (!CATEGORIES.includes(values.category as never)) details.category = "Choose a category.";
  if (!WORK_TYPES.includes(values.workType as never)) details.workType = "Choose a work type.";
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
