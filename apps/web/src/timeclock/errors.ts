import { ApiError } from "../api/client";

// Error codes from server/routes/time-entries.routes.ts, as sentences.
const ERROR_MESSAGES: Record<string, string> = {
  task_already_running:
    "A task is already running — it may have been started in another tab or on another device.",
  no_task_running: "That task was already stopped.",
  time_entry_not_found: "That entry was already deleted.",
  task_still_running: "That task is still running — stop it before editing it.",
};

export const describeError = (error: unknown): string =>
  error instanceof ApiError
    ? (ERROR_MESSAGES[error.code] ?? error.code)
    : "The server didn't respond. Please try again.";
