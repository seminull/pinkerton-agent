import { Hono } from "hono";
import { Op, QueryTypes, UniqueConstraintError, type WhereOptions } from "sequelize";
import type { AuthEnv } from "../auth";
import {
  apiError,
  parsePage,
  parseTimeZone,
  pickFields,
  requireNonEmpty,
  requireUuid,
} from "../http";
import { sequelize, TimeCategory, TimeEntry, TimeWorkType } from "../sequelize/models";
import { activeOptionNames, withTimeOptions } from "../time-options";
import type { TimeDayTotals, TimeImportResult, TimeSummary } from "../types";

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

// Per request. A full working month is well under a thousand rows; the cap is
// there so one request can't be made to do unbounded work, and it keeps the
// body comfortably inside the proxy's size limit (docker/nginx.conf).
const MAX_IMPORT_ENTRIES = 2000;
const MAX_OPTION_NAME = 80;

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

// POST /api/time-entries/import
//   { entries: [{ category, task, reference?, workType, notes?, startedAt, endedAt }] }
//
// Backfill: adds finished entries on the dates they actually happened — time
// tracked somewhere else before this app existed. The browser reads the CSV
// and sends instants, because "10:45:25 AM" only means something in the
// user's own time zone, which the server doesn't know.
//
// All-or-nothing: one bad row rejects the whole batch with that row named, and
// nothing is written. A half-imported file is the worst outcome — you can't
// tell which half, and running it again doubles the half that worked.
app.post("/import", async (c) => {
  const userId = c.get("auth").user.id;
  const body: unknown = await c.req.json().catch(() => null);
  const raw = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw apiError(422, "entries_must_be_a_nonempty_array");
  }
  if (raw.length > MAX_IMPORT_ENTRIES) {
    throw apiError(413, "too_many_entries", { entries: `maximum_${MAX_IMPORT_ENTRIES}` });
  }

  // Errors are keyed "entries.<index>.<field>" so the client can point at the
  // exact row of the file.
  const bad = (index: number, field: string, reason: string) =>
    apiError(422, "invalid_import_entry", { [`entries.${index}.${field}`]: reason });
  const text = (
    row: Record<string, unknown>,
    index: number,
    field: string,
    max: number,
    required: boolean
  ): string | null => {
    const value = row[field];
    if (value === undefined || value === null || value === "") {
      if (required) throw bad(index, field, "required");
      return null;
    }
    if (typeof value !== "string") throw bad(index, field, "must_be_a_string");
    const trimmed = value.trim();
    if (trimmed.length > max) throw bad(index, field, "too_long");
    if (!trimmed && required) throw bad(index, field, "required");
    return trimmed || null;
  };
  const instant = (row: Record<string, unknown>, index: number, field: string): Date => {
    const value = row[field];
    const date = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
    if (Number.isNaN(date.getTime())) throw bad(index, field, "invalid_date");
    return date;
  };

  const latestAllowed = Date.now() + CLOCK_SKEW_MS;
  const parsed = raw.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw bad(index, "entry", "must_be_an_object");
    }
    const row = item as Record<string, unknown>;
    const startedAt = instant(row, index, "startedAt");
    const endedAt = instant(row, index, "endedAt");
    // >= rather than >: a real log can hold a task stopped the same second it
    // was started, and refusing the whole file over a zero-length row would be
    // absurd. It just contributes no minutes.
    if (endedAt.getTime() < startedAt.getTime()) throw bad(index, "endedAt", "before_start");
    if (endedAt.getTime() > latestAllowed) throw bad(index, "endedAt", "in_the_future");
    return {
      category: text(row, index, "category", MAX_OPTION_NAME, true)!,
      task: text(row, index, "task", MAX_TASK, true)!,
      reference: text(row, index, "reference", MAX_REFERENCE, false),
      workType: text(row, index, "workType", MAX_OPTION_NAME, true)!,
      notes: text(row, index, "notes", MAX_NOTES, false),
      startedAt,
      endedAt,
    };
  });

  const result = await sequelize.transaction(async (transaction): Promise<TimeImportResult> => {
    // --- categories and work types ----------------------------------------
    // A file from elsewhere will name things this user doesn't have yet. They
    // are added to the user's lists rather than rejected: the alternative is
    // making someone hand-create a dozen options before an import can work.
    // Matching is case-insensitive and adopts the existing spelling, so
    // "lunch / break" in a file lands on the user's "Lunch / Break" — and
    // inherits its break setting — instead of becoming a second one.
    const resolve = async (
      model: typeof TimeCategory | typeof TimeWorkType,
      wanted: string[],
      defaults: Record<string, boolean>
    ): Promise<{ canonical: Map<string, string>; created: string[] }> => {
      const existing = await (model as typeof TimeCategory).findAll({
        where: { userId },
        attributes: ["name", "position"],
        transaction,
      });
      const canonical = new Map(existing.map((row) => [row.name.toLowerCase(), row.name]));
      let position = existing.reduce((max, row) => Math.max(max, row.position), -1);
      const created: string[] = [];
      for (const name of wanted) {
        if (canonical.has(name.toLowerCase())) continue;
        position += 1;
        await (model as typeof TimeCategory).create(
          { userId, name, position, archivedAt: null, ...defaults } as never,
          { transaction }
        );
        canonical.set(name.toLowerCase(), name);
        created.push(name);
      }
      return { canonical, created };
    };
    // New categories are ordinary work and new work types are the user's own
    // time — the safe guesses. Either can be flipped on the Setup tab, and the
    // totals follow.
    const categories = await resolve(
      TimeCategory,
      parsed.map((entry) => entry.category),
      { isBreak: false }
    );
    const workTypes = await resolve(
      TimeWorkType,
      parsed.map((entry) => entry.workType),
      { countsAsOwnTime: true }
    );

    // --- duplicates ---------------------------------------------------------
    // Same start, same end, same task = the same entry. Skipped, so importing a
    // file twice (or a second file that overlaps the first) adds nothing twice.
    const key = (startedAt: Date, endedAt: Date | null, task: string) =>
      `${startedAt.getTime()}|${endedAt?.getTime() ?? ""}|${task}`;
    const starts = parsed.map((entry) => entry.startedAt.getTime());
    const existing = await TimeEntry.findAll({
      where: {
        userId,
        startedAt: { [Op.between]: [new Date(Math.min(...starts)), new Date(Math.max(...starts))] },
      },
      attributes: ["startedAt", "endedAt", "task"],
      transaction,
    });
    const seen = new Set(existing.map((row) => key(row.startedAt, row.endedAt, row.task)));

    const rows = [];
    let duplicates = 0;
    for (const entry of parsed) {
      const id = key(entry.startedAt, entry.endedAt, entry.task);
      if (seen.has(id)) {
        duplicates += 1;
        continue;
      }
      // Added as we go, so a row repeated inside the file is caught too.
      seen.add(id);
      rows.push({
        ...entry,
        userId,
        category: categories.canonical.get(entry.category.toLowerCase())!,
        workType: workTypes.canonical.get(entry.workType.toLowerCase())!,
      });
    }
    if (rows.length > 0) await TimeEntry.bulkCreate(rows, { transaction });

    return {
      imported: rows.length,
      duplicates,
      createdCategories: categories.created,
      createdWorkTypes: workTypes.created,
    };
  });

  return c.json(result, 201);
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
