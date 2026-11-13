import { Hono, type Context } from "hono";
import { QueryTypes, type ModelStatic } from "sequelize";
import type { AuthEnv } from "../auth";
import { apiError, pickFields, requireNonEmpty, requireUuid } from "../http";
import {
  sequelize,
  TimeCategory,
  TimeWorkType,
  type TimeCategoryInstance,
  type TimeWorkTypeInstance,
} from "../sequelize/models";
import { withTimeOptions } from "../time-options";
import type { TimeOption } from "../types";

// Mounted at /api/time-options. The Setup tab: each user's own categories and
// work types for the Time Clock.
//
// The two lists behave identically apart from one flag (a category can be a
// break; a work type can be someone else's time), so every route below is
// written once and takes the list as a path segment:
//
//   /api/time-options/categories/...   /api/time-options/work-types/...
//
// Like the entries, everything is scoped to the signed-in user. There is no
// route that takes a user id.

const app = new Hono<AuthEnv>();
app.use("*", withTimeOptions);

type OptionInstance = TimeCategoryInstance | TimeWorkTypeInstance;

interface ListSpec {
  model: ModelStatic<OptionInstance>;
  /** The boolean this list carries, and what the API calls it. */
  flag: "isBreak" | "countsAsOwnTime";
  /** The time_entries column that stores this list's names. */
  entryColumn: "category" | "workType";
}

// The path segment is looked up here and nowhere else, so `entryColumn` — which
// is interpolated into SQL below — can only ever be one of these two literals.
const LISTS: Record<string, ListSpec> = {
  categories: {
    model: TimeCategory as ModelStatic<OptionInstance>,
    flag: "isBreak",
    entryColumn: "category",
  },
  "work-types": {
    model: TimeWorkType as ModelStatic<OptionInstance>,
    flag: "countsAsOwnTime",
    entryColumn: "workType",
  },
};

const listFor = (c: Context): ListSpec => {
  const list = LISTS[c.req.param("list") ?? ""];
  if (!list) throw apiError(404, "not_found");
  return list;
};

const MAX_NAME = 80;

const cleanName = (value: unknown): string => {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > MAX_NAME) {
    throw apiError(422, "validation_failed", {
      name: `Enter a name (up to ${MAX_NAME} characters).`,
    });
  }
  return name;
};

const flagValue = (row: OptionInstance, flag: ListSpec["flag"]): boolean =>
  (row as unknown as Record<string, boolean>)[flag] === true;

// How many of the user's entries use each name. This is what the Setup tab
// uses to decide between offering Delete (unused) and Archive (used).
const usage = async (userId: string, list: ListSpec): Promise<Map<string, number>> => {
  const rows = await sequelize.query<{ name: string; count: number }>(
    `SELECT "${list.entryColumn}" AS name, COUNT(*)::int AS count
       FROM time_entries WHERE "userId" = :userId GROUP BY 1`,
    { type: QueryTypes.SELECT, replacements: { userId } }
  );
  return new Map(rows.map((row) => [row.name, row.count]));
};

const present = (row: OptionInstance, list: ListSpec, entryCount: number): TimeOption => ({
  id: row.id,
  name: row.name,
  archived: row.archivedAt !== null,
  entryCount,
  [list.flag]: flagValue(row, list.flag),
});

const loadList = async (userId: string, list: ListSpec): Promise<TimeOption[]> => {
  const [rows, counts] = await Promise.all([
    // createdAt breaks position ties, so two rows that somehow share a
    // position still come back in a stable order.
    list.model.findAll({
      where: { userId },
      order: [
        ["position", "ASC"],
        ["createdAt", "ASC"],
      ],
    }),
    usage(userId, list),
  ]);
  return rows.map((row) => present(row, list, counts.get(row.name) ?? 0));
};

const findOwn = async (c: Context<AuthEnv>, list: ListSpec): Promise<OptionInstance> => {
  const id = requireUuid(c.req.param("id"));
  const row = await list.model.findOne({ where: { id, userId: c.get("auth").user.id } });
  if (!row) throw apiError(404, "option_not_found");
  return row;
};

// Names are compared case-insensitively: "Email" and "email" in one dropdown is
// a mistake nobody makes on purpose. (The database index is case-sensitive; it
// is the backstop for races, this is the rule.)
const assertNameFree = async (
  userId: string,
  list: ListSpec,
  name: string,
  exceptId?: string
): Promise<void> => {
  const rows = await list.model.findAll({ where: { userId }, attributes: ["id", "name"] });
  if (rows.some((row) => row.id !== exceptId && row.name.toLowerCase() === name.toLowerCase())) {
    throw apiError(409, "name_in_use", { name: "You already have one with this name." });
  }
};

// The dropdown can't be empty — there would be nothing to start a task with.
const assertNotLastActive = async (userId: string, list: ListSpec, row: OptionInstance) => {
  if (row.archivedAt !== null) return;
  const active = await list.model.count({ where: { userId, archivedAt: null } });
  if (active <= 1) throw apiError(409, "last_active_option");
};

// GET /api/time-options — both lists, archived rows included.
app.get("/", async (c) => {
  const userId = c.get("auth").user.id;
  const [categories, workTypes] = await Promise.all([
    loadList(userId, LISTS.categories!),
    loadList(userId, LISTS["work-types"]!),
  ]);
  return c.json({ categories, workTypes });
});

// POST /api/time-options/:list  { name, isBreak? | countsAsOwnTime? }
app.post("/:list", async (c) => {
  const list = listFor(c);
  const userId = c.get("auth").user.id;
  const values = pickFields(await c.req.json(), ["name", list.flag] as const);
  const name = cleanName(values.name);
  await assertNameFree(userId, list, name);

  // New options go to the end of the list.
  const last = ((await list.model.max("position", { where: { userId } })) as number | null) ?? -1;
  const row = await list.model.create({
    userId,
    name,
    position: last + 1,
    archivedAt: null,
    // Omitted means the common case: a normal working category, the user's
    // own time.
    [list.flag]:
      typeof values[list.flag] === "boolean" ? values[list.flag] : list.flag === "countsAsOwnTime",
  } as never);
  return c.json({ option: present(row, list, 0) }, 201);
});

// POST /api/time-options/:list/reorder  { ids: [...] }
// The complete list of ids in the order wanted. Requiring all of them (rather
// than "move this one up") means the result never depends on what order the
// server happened to have, so two tabs can't interleave into a scramble.
app.post("/:list/reorder", async (c) => {
  const list = listFor(c);
  const userId = c.get("auth").user.id;
  const body: unknown = await c.req.json().catch(() => null);
  const ids = (body as { ids?: unknown } | null)?.ids;
  const rows = await list.model.findAll({ where: { userId }, attributes: ["id"] });

  const valid =
    Array.isArray(ids) &&
    ids.length === rows.length &&
    new Set(ids).size === ids.length &&
    ids.every((id) => typeof id === "string" && rows.some((row) => row.id === id));
  if (!valid) throw apiError(422, "ids_must_list_every_option_once");

  await sequelize.transaction(async (transaction) => {
    for (const [position, id] of (ids as string[]).entries()) {
      await list.model.update({ position } as never, { where: { id, userId }, transaction });
    }
  });
  return c.json({ options: await loadList(userId, list) });
});

// PATCH /api/time-options/:list/:id  { name?, isBreak? | countsAsOwnTime?, archived? }
app.patch("/:list/:id", async (c) => {
  const list = listFor(c);
  const userId = c.get("auth").user.id;
  const values = pickFields(await c.req.json(), ["name", list.flag, "archived"] as const);
  requireNonEmpty(values);
  const row = await findOwn(c, list);

  const changes: Record<string, unknown> = {};
  let renamedFrom: string | null = null;

  if ("name" in values) {
    const name = cleanName(values.name);
    if (name !== row.name) {
      await assertNameFree(userId, list, name, row.id);
      renamedFrom = row.name;
      changes.name = name;
    }
  }
  if (list.flag in values) {
    if (typeof values[list.flag] !== "boolean") {
      throw apiError(422, "validation_failed", { [list.flag]: "Must be true or false." });
    }
    changes[list.flag] = values[list.flag];
  }
  if ("archived" in values) {
    if (typeof values.archived !== "boolean") {
      throw apiError(422, "validation_failed", { archived: "Must be true or false." });
    }
    if (values.archived) await assertNotLastActive(userId, list, row);
    // Keep the original timestamp if it is already archived.
    changes.archivedAt = values.archived ? (row.archivedAt ?? new Date()) : null;
  }

  await sequelize.transaction(async (transaction) => {
    // Cast to one member of the union: the two models' `update` signatures
    // differ only in their attribute types, which TypeScript can't call as a
    // union, and `changes` is already built from this list's own fields.
    await (row as TimeCategoryInstance).update(changes as never, { transaction });
    // Entries store the name as text, so a rename has to carry them along —
    // in the same transaction, or a failure halfway would orphan them from
    // their category and silently turn recorded breaks into work time.
    if (renamedFrom !== null) {
      await sequelize.query(
        `UPDATE time_entries SET "${list.entryColumn}" = :to, "updatedAt" = now()
          WHERE "userId" = :userId AND "${list.entryColumn}" = :from`,
        { replacements: { userId, from: renamedFrom, to: changes.name }, transaction }
      );
    }
  });

  const counts = await usage(userId, list);
  return c.json({ option: present(row, list, counts.get(row.name) ?? 0) });
});

// DELETE /api/time-options/:list/:id
// Only for an option no entry uses. One that has been used is archived
// instead: deleting it would leave those entries pointing at a name with no
// row, and with it no record of whether that time was a break.
app.delete("/:list/:id", async (c) => {
  const list = listFor(c);
  const userId = c.get("auth").user.id;
  const row = await findOwn(c, list);

  const counts = await usage(userId, list);
  if ((counts.get(row.name) ?? 0) > 0) throw apiError(409, "option_in_use");
  await assertNotLastActive(userId, list, row);

  await row.destroy();
  return c.body(null, 204);
});

export default app;
