import type { MiddlewareHandler } from "hono";
import type { AuthEnv } from "./auth";
import { TimeCategory, TimeWorkType } from "./sequelize/models";

// The Time Clock's pick lists: the defaults a new user starts with, and the
// lookups the entry routes validate against. The lists themselves are edited
// through routes/time-options.routes.ts (the Setup tab).

// What every user starts with. These are the names the Time Clock shipped with
// when the lists were constants in the code, so entries recorded before the
// Setup tab existed match a row here and keep their break / assistant meaning.
// Changing a name in this list does NOT rename anything for existing users —
// it only affects accounts seeded afterwards.
export const DEFAULT_CATEGORIES: { name: string; isBreak: boolean }[] = [
  { name: "Closing Preparation", isBreak: false },
  { name: "Title / Curative", isBreak: false },
  { name: "Email / Correspondence", isBreak: false },
  { name: "Phone Calls / Interruptions", isBreak: false },
  { name: "HOA / Survey / Payoffs", isBreak: false },
  { name: "Qualia / Administration", isBreak: false },
  { name: "Assistant Training / Delegation", isBreak: false },
  { name: "Assistant Work Review", isBreak: false },
  { name: "Escalations / Rework", isBreak: false },
  { name: "Time Study Administration", isBreak: false },
  { name: "Lunch / Break", isBreak: true },
  { name: "Other", isBreak: false },
];

export const DEFAULT_WORK_TYPES: { name: string; countsAsOwnTime: boolean }[] = [
  { name: "My work", countsAsOwnTime: true },
  { name: "Training / supervising assistant", countsAsOwnTime: true },
  { name: "Reviewing assistant work", countsAsOwnTime: true },
  { name: "Assistant work (not my time)", countsAsOwnTime: false },
];

// Users already checked in this process. Seeding is "does this user have any
// rows" — two COUNTs — and without this it would run on every Time Clock
// request forever. A restart just means one more check per user.
const checked = new Set<string>();

// Give a user the default lists if they have none. Lazily, on first use, rather
// than in the migration or at account creation: it then also covers accounts
// that existed before this feature and accounts created by any future path.
//
// "None" includes archived rows, so a user who has archived everything is not
// re-seeded — only one who has no rows at all.
export const ensureTimeOptions = async (userId: string): Promise<void> => {
  if (checked.has(userId)) return;

  if ((await TimeCategory.count({ where: { userId } })) === 0) {
    await TimeCategory.bulkCreate(
      DEFAULT_CATEGORIES.map((category, position) => ({
        userId,
        ...category,
        position,
        archivedAt: null,
      })),
      // Two first requests can race here (the page fires several at once). The
      // unique (userId, name) index makes the loser's rows conflict; this turns
      // that into a no-op instead of a 500.
      { ignoreDuplicates: true }
    );
  }
  if ((await TimeWorkType.count({ where: { userId } })) === 0) {
    await TimeWorkType.bulkCreate(
      DEFAULT_WORK_TYPES.map((workType, position) => ({
        userId,
        ...workType,
        position,
        archivedAt: null,
      })),
      { ignoreDuplicates: true }
    );
  }
  checked.add(userId);
};

// Mounted on both Time Clock routers, so the lists exist before any route that
// reads, validates against, or joins to them runs.
export const withTimeOptions: MiddlewareHandler<AuthEnv> = async (c, next) => {
  await ensureTimeOptions(c.get("auth").user.id);
  await next();
};

// The names a user may currently pick: everything not archived.
export const activeOptionNames = async (
  userId: string
): Promise<{ categories: Set<string>; workTypes: Set<string> }> => {
  const [categories, workTypes] = await Promise.all([
    TimeCategory.findAll({ where: { userId, archivedAt: null }, attributes: ["name"] }),
    TimeWorkType.findAll({ where: { userId, archivedAt: null }, attributes: ["name"] }),
  ]);
  return {
    categories: new Set(categories.map((row) => row.name)),
    workTypes: new Set(workTypes.map((row) => row.name)),
  };
};
