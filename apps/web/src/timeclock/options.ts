import type { TimeEntry, TimeOptions } from "../api/types";

// Helpers over the user's own categories and work types (GET /time-options,
// edited on the Setup tab). The lists used to be constants in this file; they
// are data now, so everything here takes them as an argument.

/** Names currently offered in a dropdown: everything not archived, in order. */
export const activeNames = (options: { name: string; archived: boolean }[] | undefined): string[] =>
  (options ?? []).filter((option) => !option.archived).map((option) => option.name);

// Dropdown data for editing an existing entry: the active names, plus the
// entry's own current value if that option has since been archived — otherwise
// opening an old entry would show a blank select and saving would be refused.
export const namesIncluding = (
  options: { name: string; archived: boolean }[] | undefined,
  current: string
): string[] => {
  const names = activeNames(options);
  return names.includes(current) ? names : [current, ...names];
};

export type EntryKind = "work" | "break" | "assistant";

// What an entry counts as, by the same rule the server's totals use: a break
// if its category is marked as one, otherwise assistant time if its work type
// isn't the user's own, otherwise work. An entry whose names match nothing
// (which shouldn't happen) is work, matching the server's fallback.
export const classifier = (options: TimeOptions | undefined) => {
  const breaks = new Set(
    (options?.categories ?? []).filter((c) => c.isBreak).map((c) => c.name)
  );
  const notOwnTime = new Set(
    (options?.workTypes ?? []).filter((w) => w.countsAsOwnTime === false).map((w) => w.name)
  );
  return (entry: Pick<TimeEntry, "category" | "workType">): EntryKind =>
    breaks.has(entry.category) ? "break" : notOwnTime.has(entry.workType) ? "assistant" : "work";
};
