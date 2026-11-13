// The Time Clock's pick lists. A mirror of the lists in
// server/routes/time-entries.routes.ts, which is the copy that is enforced —
// add a value there first, or the API will reject what this dropdown offers.

export const CATEGORIES = [
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
];

export const WORK_TYPES = [
  "My work",
  "Training / supervising assistant",
  "Reviewing assistant work",
  "Assistant work (not my time)",
];

// The two values the totals treat specially — breaks and assistant-performed
// work are both excluded from "my work time". Named here so the timeline's
// colours and the server's sums (BREAK_CATEGORY / ASSISTANT_WORK_TYPE in the
// route file) are visibly keyed on the same strings.
export const BREAK_CATEGORY = "Lunch / Break";
export const ASSISTANT_WORK_TYPE = "Assistant work (not my time)";
