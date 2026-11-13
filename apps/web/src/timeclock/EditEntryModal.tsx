import { useState } from "react";
import { Button, Group, Modal, Select, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ApiError } from "../api/client";
import type { TimeEntry } from "../api/types";
import { describeError } from "./errors";
import { formatDay, formatDuration, formatLongDay, fromLocalInput, toLocalInput } from "./format";
import { namesIncluding } from "./options";
import { useTimeOptions, useUpdateTimeEntry } from "./queries";

interface Props {
  /** The entry being edited. The caller only renders this while there is one. */
  entry: TimeEntry;
  onClose: () => void;
}

// Edit one finished entry: what it was, and when. Everything about the entry is
// on one small form so a correction is open-fix-save, with no second screen.
//
// The caller mounts this per entry (keyed by id), so the initial state below is
// always that entry's values and nothing has to be reset by hand.
export default function EditEntryModal({ entry, onClose }: Props) {
  const update = useUpdateTimeEntry();
  const options = useTimeOptions();
  const [fields, setFields] = useState({
    category: entry.category,
    task: entry.task,
    reference: entry.reference ?? "",
    workType: entry.workType,
    notes: entry.notes ?? "",
    startedAt: toLocalInput(entry.startedAt),
    // Only completed entries are editable, so there is always an end.
    endedAt: toLocalInput(entry.endedAt ?? entry.startedAt),
  });
  // Field errors the server sent back (it is the authority on all of this).
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const set = (patch: Partial<typeof fields>) => {
    setFields((current) => ({ ...current, ...patch }));
    // Any edit makes the last response stale; don't keep shouting about a
    // problem the user may have just fixed.
    setServerErrors({});
  };

  // Checked on every keystroke so the form shows the resulting duration — the
  // thing a time correction is actually about — and says why Save is off.
  const start = fromLocalInput(fields.startedAt);
  const end = fromLocalInput(fields.endedAt);
  const timeProblem =
    !start || !end
      ? "Enter both a start and an end time."
      : end.getTime() <= start.getTime()
        ? "The end time must be after the start time."
        : null;
  const minutes = start && end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)) : 0;
  const taskProblem = fields.task.trim() ? null : "Enter a task description.";

  const handleSave = () => {
    if (!start || !end || timeProblem || taskProblem) return;
    update.mutate(
      {
        id: entry.id,
        category: fields.category,
        task: fields.task.trim(),
        // Blank optional fields go as null, not "" — nullable means unknown.
        reference: fields.reference.trim() || null,
        workType: fields.workType,
        notes: fields.notes.trim() || null,
        startedAt: start.toISOString(),
        endedAt: end.toISOString(),
      },
      {
        onSuccess: () => {
          // An entry lives on the day it started. Changing that date moves it
          // out of the list it was opened from, which without a word looks
          // exactly like the save deleted it.
          const before = formatDay(new Date(entry.startedAt));
          const after = formatDay(start);
          notifications.show({
            color: "green",
            message:
              before === after ? "Entry updated" : `Entry moved to ${formatLongDay(after)}`,
          });
          onClose();
        },
        onError: (error) => {
          if (error instanceof ApiError && error.details) {
            setServerErrors(error.details);
            return;
          }
          notifications.show({
            color: "red",
            title: "Couldn't save",
            message: describeError(error),
          });
        },
      }
    );
  };

  return (
    <Modal opened onClose={onClose} title="Edit entry" centered size="lg">
      {/* A real form, so Enter in any text field saves. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSave();
        }}
      >
        <Stack gap="sm">
          <TextInput
            label="Task description"
            withAsterisk
            maxLength={200}
            data-autofocus
            value={fields.task}
            error={serverErrors.task ?? (fields.task ? null : taskProblem)}
            onChange={(event) => set({ task: event.currentTarget.value })}
          />
          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <Select
              label="Category"
              data={namesIncluding(options.data?.categories, fields.category)}
              allowDeselect={false}
              value={fields.category}
              error={serverErrors.category}
              onChange={(value) => value && set({ category: value })}
            />
            <Select
              label="Work type"
              data={namesIncluding(options.data?.workTypes, fields.workType)}
              allowDeselect={false}
              value={fields.workType}
              error={serverErrors.workType}
              onChange={(value) => value && set({ workType: value })}
            />
            {/* The browser's own date-time control, on purpose: on a phone it
                opens the native wheel picker, which beats any custom popover
                for nudging a time by a few minutes. step=1 keeps the seconds,
                so opening and saving an entry untouched doesn't shave them
                off and change its duration. */}
            <TextInput
              label="Start"
              type="datetime-local"
              step={1}
              value={fields.startedAt}
              error={serverErrors.startedAt}
              onChange={(event) => set({ startedAt: event.currentTarget.value })}
            />
            <TextInput
              label="End"
              type="datetime-local"
              step={1}
              value={fields.endedAt}
              error={serverErrors.endedAt ?? timeProblem}
              onChange={(event) => set({ endedAt: event.currentTarget.value })}
            />
          </SimpleGrid>
          <TextInput
            label="Anonymous file reference"
            placeholder="e.g., File A"
            maxLength={100}
            value={fields.reference}
            error={serverErrors.reference}
            onChange={(event) => set({ reference: event.currentTarget.value })}
          />
          <TextInput
            label="Notes"
            maxLength={1000}
            value={fields.notes}
            error={serverErrors.notes}
            onChange={(event) => set({ notes: event.currentTarget.value })}
          />

          <Group justify="space-between" mt="xs">
            <Text size="sm" c="dimmed">
              {timeProblem ? "Duration: —" : `Duration: ${formatDuration(minutes)} (${minutes} min)`}
            </Text>
            <Group>
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={update.isPending}
                disabled={Boolean(timeProblem || taskProblem)}
              >
                Save
              </Button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
