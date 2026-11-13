import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  Modal,
  Pagination,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconDownload,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconTrash,
} from "@tabler/icons-react";
import { ApiError } from "../api/client";
import type { TimeEntry } from "../api/types";
import PageStack from "../motion/PageStack";
import {
  dayRange,
  entryMinutes,
  formatClockTime,
  formatDay,
  formatDuration,
  formatElapsed,
} from "./format";
import { CATEGORIES, WORK_TYPES } from "./options";
import {
  fetchAllTimeEntries,
  useActiveEntry,
  useDeleteTimeEntry,
  useStartTask,
  useStopTask,
  useTimeEntries,
  useTimeSummary,
} from "./queries";

const PAGE_SIZE = 25;

const ERROR_MESSAGES: Record<string, string> = {
  task_already_running:
    "A task is already running — it may have been started in another tab or on another device.",
  no_task_running: "That task was already stopped.",
  time_entry_not_found: "That entry was already deleted.",
};

const describe = (error: unknown): string =>
  error instanceof ApiError
    ? (ERROR_MESSAGES[error.code] ?? error.code)
    : "The server didn't respond. Please try again.";

// The ticking readout, isolated in its own component so the once-a-second
// re-render touches these few characters and not the whole page and its table.
function RunningClock({ startedAt }: { startedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    // Elapsed time is always recomputed from the start instant, never
    // accumulated tick by tick — browsers throttle timers in background tabs,
    // and a counter that added one second per tick would fall behind.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return (
    <Text
      fz={{ base: 34, sm: 40 }}
      fw={700}
      lh={1.1}
      // Fixed-width digits, so the readout doesn't jitter sideways as it counts.
      style={{ fontVariantNumeric: "tabular-nums" }}
      aria-live="off"
    >
      {formatElapsed(startedAt ? now - new Date(startedAt).getTime() : 0)}
    </Text>
  );
}

// Today's date as YYYY-MM-DD, re-checked every half minute so "Today's totals"
// rolls over at midnight on a page left open overnight. State only changes
// when the date does, so the check itself costs no re-render.
const useToday = (): string => {
  const [today, setToday] = useState(() => formatDay(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setToday(formatDay(new Date())), 30_000);
    return () => clearInterval(timer);
  }, []);
  return today;
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fz="xl" fw={700}>
        {value}
      </Text>
    </Paper>
  );
}

const csvCell = (value: string | number | null): string =>
  `"${String(value ?? "").replace(/"/g, '""')}"`;

const downloadCsv = (entries: TimeEntry[]): void => {
  const rows: (string | number | null)[][] = [
    [
      "Date",
      "Start",
      "End",
      "Minutes",
      "Hours",
      "Category",
      "Task",
      "File Reference",
      "Work Type",
      "Notes",
    ],
    ...entries.map((entry) => {
      const minutes = entryMinutes(entry);
      return [
        formatDay(new Date(entry.startedAt)),
        formatClockTime(entry.startedAt),
        entry.endedAt ? formatClockTime(entry.endedAt) : "",
        minutes,
        (minutes / 60).toFixed(2),
        entry.category,
        entry.task,
        entry.reference,
        entry.workType,
        entry.notes,
      ];
    }),
  ];
  // The leading BOM is what makes Excel read the file as UTF-8; without it an
  // accented character or a dash in a task name comes out as mojibake.
  const blob = new Blob(["﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Time_Clock_${formatDay(new Date())}.csv`;
  link.click();
  // Released after a beat: revoking in the same tick can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

const BLANK = {
  category: CATEGORIES[0]!,
  task: "",
  reference: "",
  workType: WORK_TYPES[0]!,
  notes: "",
};

export default function TimeClock() {
  const [fields, setFields] = useState(BLANK);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<TimeEntry | null>(null);
  const [exporting, setExporting] = useState(false);

  const today = useToday();
  const active = useActiveEntry();
  const history = useTimeEntries((page - 1) * PAGE_SIZE, PAGE_SIZE);
  // `today` is in the dependency chain via the range, so the query key changes
  // — and the totals refetch — when the date rolls over.
  const [year, month, day] = today.split("-").map(Number);
  const todayTotals = useTimeSummary(dayRange(new Date(year!, month! - 1, day!)));
  const allTotals = useTimeSummary();

  const start = useStartTask();
  const stop = useStopTask();
  const remove = useDeleteTimeEntry();

  const running = active.data?.entry ?? null;

  // While a task runs, the form shows THAT task, read-only — including after a
  // reload or on another device, where the local field state would be blank.
  // What is on screen is always what is being timed.
  const shown = running
    ? {
        category: running.category,
        task: running.task,
        reference: running.reference ?? "",
        workType: running.workType,
        notes: running.notes ?? "",
      }
    : fields;
  const locked = Boolean(running);

  const set = (patch: Partial<typeof BLANK>) => setFields((current) => ({ ...current, ...patch }));

  const handleStart = () => {
    const task = fields.task.trim();
    if (!task) {
      setTaskError("Enter a task description first");
      return;
    }
    setTaskError(null);
    start.mutate(
      {
        category: fields.category,
        task,
        // Blank optional fields go as null, not "" — nullable means unknown.
        reference: fields.reference.trim() || null,
        workType: fields.workType,
        notes: fields.notes.trim() || null,
      },
      {
        onError: (error) => {
          if (error instanceof ApiError && error.details?.task) {
            setTaskError(error.details.task);
            return;
          }
          notifications.show({ color: "red", title: "Couldn't start", message: describe(error) });
        },
      }
    );
  };

  const handleStop = () =>
    stop.mutate(undefined, {
      // Task and notes are per-task; category, file reference, and work type
      // usually carry over to the next one, so they stay.
      onSuccess: () => set({ task: "", notes: "" }),
      onError: (error) =>
        notifications.show({ color: "red", title: "Couldn't stop", message: describe(error) }),
    });

  const handleDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => notifications.show({ color: "green", message: "Entry deleted" }),
      onError: (error) =>
        notifications.show({ color: "red", title: "Couldn't delete", message: describe(error) }),
      onSettled: () => setDeleting(null),
    });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      downloadCsv(await fetchAllTimeEntries());
    } catch (error) {
      notifications.show({ color: "red", title: "Export failed", message: describe(error) });
    } finally {
      setExporting(false);
    }
  };

  const totalPages = history.data ? Math.ceil(history.data.total / PAGE_SIZE) : 0;

  return (
    <PageStack>
      <div>
        <Title order={2}>Time Clock</Title>
        <Text c="dimmed" size="sm">
          Enter a task, press Start, and press Stop when you&apos;re done. Start and end times
          are recorded automatically and saved to your account.
        </Text>
      </div>

      {active.isError && (
        <Alert color="red" title="Couldn't load the time clock">
          {describe(active.error)}
        </Alert>
      )}

      <Card withBorder>
        <Stack>
          <Title order={4}>Track a task</Title>
          <Grid>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Select
                label="Category"
                data={CATEGORIES}
                allowDeselect={false}
                disabled={locked}
                value={shown.category}
                onChange={(value) => value && set({ category: value })}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput
                label="Task description"
                placeholder="e.g., Review closing package"
                withAsterisk
                maxLength={200}
                disabled={locked}
                value={shown.task}
                error={taskError}
                onChange={(event) => {
                  set({ task: event.currentTarget.value });
                  setTaskError(null);
                }}
                // Enter starts the task — the fastest path for the common case
                // of typing a description and going.
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !locked) handleStart();
                }}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput
                label="Anonymous file reference"
                description="Optional. A label like “File A” — not a client name."
                placeholder="e.g., File A"
                maxLength={100}
                disabled={locked}
                value={shown.reference}
                onChange={(event) => set({ reference: event.currentTarget.value })}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Select
                label="Work type"
                data={WORK_TYPES}
                allowDeselect={false}
                disabled={locked}
                value={shown.workType}
                onChange={(value) => value && set({ workType: value })}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 8 }}>
              <TextInput
                label="Notes"
                description="Optional."
                placeholder="e.g., Interrupted by lender call"
                maxLength={1000}
                disabled={locked}
                value={shown.notes}
                onChange={(event) => set({ notes: event.currentTarget.value })}
              />
            </Grid.Col>
          </Grid>

          {/* Keyed by the running entry so each task gets a fresh clock: the
              component's "now" is initialised on mount, and reusing one across
              tasks would show the previous task's stale reading for a second. */}
          <RunningClock key={running?.id ?? "idle"} startedAt={running?.startedAt ?? null} />

          <Group>
            <Button
              leftSection={<IconPlayerPlayFilled size={16} />}
              onClick={handleStart}
              // Also off until the first load answers: starting before knowing
              // whether something is already running just earns a 409.
              disabled={locked || !active.data}
              loading={start.isPending}
            >
              Start task
            </Button>
            <Button
              color="red"
              leftSection={<IconPlayerStopFilled size={16} />}
              onClick={handleStop}
              disabled={!locked}
              loading={stop.isPending}
            >
              Stop task
            </Button>
            {/* Announced to screen readers, since starting and stopping change
                nothing else a non-sighted user would notice. */}
            <Text size="sm" c="dimmed" role="status">
              {running
                ? `Recording: ${running.task} (started ${formatClockTime(running.startedAt)})`
                : "No task currently running."}
            </Text>
          </Group>
        </Stack>
      </Card>

      <Card withBorder>
        <Stack>
          <Title order={4}>Today&apos;s totals</Title>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Stat
              label="My work time"
              value={formatDuration(todayTotals.data?.summary.workMinutes ?? 0)}
            />
            <Stat
              label="Break time"
              value={formatDuration(todayTotals.data?.summary.breakMinutes ?? 0)}
            />
            <Stat
              label="Completed tasks"
              value={String(todayTotals.data?.summary.entryCount ?? 0)}
            />
          </SimpleGrid>
        </Stack>
      </Card>

      <Card withBorder>
        <Stack>
          <Group justify="space-between">
            <Title order={4}>Task history</Title>
            <Button
              variant="default"
              leftSection={<IconDownload size={16} />}
              onClick={handleExport}
              loading={exporting}
              disabled={!history.data || history.data.total === 0}
            >
              Export for Excel (CSV)
            </Button>
          </Group>

          {history.isError && (
            <Alert color="red" title="Couldn't load the history">
              {describe(history.error)}
            </Alert>
          )}

          {!history.data ? (
            !history.isError && (
              <Group justify="center" py="xl">
                <Loader />
              </Group>
            )
          ) : history.data.results.length === 0 ? (
            <Text c="dimmed" size="sm">
              No tasks recorded yet.
            </Text>
          ) : (
            <Table.ScrollContainer minWidth={900}>
              <Table highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Start</Table.Th>
                    <Table.Th>End</Table.Th>
                    <Table.Th>Minutes</Table.Th>
                    <Table.Th>Category</Table.Th>
                    <Table.Th>Task</Table.Th>
                    <Table.Th>File ref.</Table.Th>
                    <Table.Th>Work type</Table.Th>
                    <Table.Th>Notes</Table.Th>
                    <Table.Th w={50} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {history.data.results.map((entry) => (
                    <Table.Tr key={entry.id}>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        {formatDay(new Date(entry.startedAt))}
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        {formatClockTime(entry.startedAt)}
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        {entry.endedAt ? formatClockTime(entry.endedAt) : "—"}
                      </Table.Td>
                      <Table.Td>{entryMinutes(entry)}</Table.Td>
                      <Table.Td>{entry.category}</Table.Td>
                      <Table.Td>{entry.task}</Table.Td>
                      <Table.Td>{entry.reference ?? "—"}</Table.Td>
                      <Table.Td>{entry.workType}</Table.Td>
                      <Table.Td>{entry.notes ?? "—"}</Table.Td>
                      <Table.Td>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={`Delete ${entry.task}`}
                          onClick={() => setDeleting(entry)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}

          {totalPages > 1 && (
            <Group justify="center">
              <Pagination value={page} onChange={setPage} total={totalPages} />
            </Group>
          )}
        </Stack>
      </Card>

      <Card withBorder>
        <Stack gap="xs">
          <Title order={4}>All recorded days</Title>
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <Stat label="Work" value={formatDuration(allTotals.data?.summary.workMinutes ?? 0)} />
            <Stat
              label="Breaks"
              value={formatDuration(allTotals.data?.summary.breakMinutes ?? 0)}
            />
            <Stat
              label="Assistant-performed work"
              value={formatDuration(allTotals.data?.summary.assistantMinutes ?? 0)}
            />
            <Stat
              label="Recorded entries"
              value={String(allTotals.data?.summary.entryCount ?? 0)}
            />
          </SimpleGrid>
        </Stack>
      </Card>

      <Text size="xs" c="dimmed">
        Start and end times come from the server&apos;s clock and are shown in your local time
        zone. A running task keeps running if you close this tab or sign out — stop it when
        you&apos;re done. Idle time and gaps between tasks aren&apos;t detected.
      </Text>

      {/* Deleting can't be undone and the row is someone's recorded time, so it
          asks first. A modal rather than window.confirm so it matches the app
          and works the same on a phone. */}
      <Modal
        opened={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this entry?"
        centered
      >
        <Stack>
          <Text size="sm">
            {deleting &&
              `“${deleting.task}” — ${entryMinutes(deleting)} min on ${formatDay(
                new Date(deleting.startedAt)
              )}. This can't be undone.`}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button color="red" onClick={handleDelete} loading={remove.isPending}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageStack>
  );
}
