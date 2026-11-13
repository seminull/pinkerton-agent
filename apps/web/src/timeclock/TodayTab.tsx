import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Grid,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPlayerPlayFilled, IconPlayerStopFilled } from "@tabler/icons-react";
import { ApiError } from "../api/client";
import PageStack from "../motion/PageStack";
import EntriesTable from "./EntriesTable";
import { describeError } from "./errors";
import { dayRange, formatClockTime, formatDuration, formatElapsed, parseDay } from "./format";
import { CATEGORIES, WORK_TYPES } from "./options";
import { useActiveEntry, useStartTask, useStopTask, useTimeSummary } from "./queries";
import Stat from "./Stat";
import { useToday } from "./useToday";

// The ticking readout, isolated in its own component so the once-a-second
// re-render touches these few characters and not the whole tab and its table.
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

const BLANK = {
  category: CATEGORIES[0]!,
  task: "",
  reference: "",
  workType: WORK_TYPES[0]!,
  notes: "",
};

// The working tab: start and stop a task, and see what today adds up to.
// Earlier days live on the Calendar tab.
export default function TodayTab() {
  const [fields, setFields] = useState(BLANK);
  const [taskError, setTaskError] = useState<string | null>(null);

  // Everything "today" on this tab hangs off this one value, so the totals and
  // the list roll over together at midnight.
  const today = useToday();
  const todayRange = dayRange(parseDay(today));
  const active = useActiveEntry();
  const totals = useTimeSummary(todayRange);
  const start = useStartTask();
  const stop = useStopTask();

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
          notifications.show({
            color: "red",
            title: "Couldn't start",
            message: describeError(error),
          });
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
        notifications.show({
          color: "red",
          title: "Couldn't stop",
          message: describeError(error),
        }),
    });

  return (
    <PageStack>
      {active.isError && (
        <Alert color="red" title="Couldn't load the time clock">
          {describeError(active.error)}
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
              value={formatDuration(totals.data?.summary.workMinutes ?? 0)}
            />
            <Stat
              label="Break time"
              value={formatDuration(totals.data?.summary.breakMinutes ?? 0)}
            />
            <Stat label="Completed tasks" value={String(totals.data?.summary.entryCount ?? 0)} />
          </SimpleGrid>
        </Stack>
      </Card>

      <Card withBorder>
        <Stack>
          <Title order={4}>Today&apos;s tasks</Title>
          {/* Keyed by the date so the table's page number resets at midnight
              along with its contents. */}
          <EntriesTable key={today} range={todayRange} emptyText="No tasks recorded yet today." />
        </Stack>
      </Card>

      <Text size="xs" c="dimmed">
        Start and end times come from the server&apos;s clock and are shown in your local time
        zone. A running task keeps running if you close this tab or sign out — stop it when
        you&apos;re done. Idle time and gaps between tasks aren&apos;t detected.
      </Text>
    </PageStack>
  );
}
