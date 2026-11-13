import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Pagination,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import type { TimeEntry } from "../api/types";
import EditEntryModal from "./EditEntryModal";
import { describeError } from "./errors";
import { entryMinutes, formatClockTime, formatDay } from "./format";
import { useDeleteTimeEntry, useTimeEntries, type TimeRange } from "./queries";

const PAGE_SIZE = 25;

interface Props {
  /** The day (or span) to list. Both tabs show one day at a time. */
  range: TimeRange;
  /** What to say when the range has no entries. */
  emptyText: string;
}

// The completed entries for one day, with edit and delete. Shared by the Today tab and
// the Calendar tab's day view, so a day looks and behaves the same from either.
//
// There is no Date column: every row is from the day named in the heading above
// the table. (The CSV export, which spans days, has one.)
export default function EntriesTable({ range, emptyText }: Props) {
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<TimeEntry | null>(null);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const entries = useTimeEntries((page - 1) * PAGE_SIZE, PAGE_SIZE, range);
  const remove = useDeleteTimeEntry();

  const handleDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => notifications.show({ color: "green", message: "Entry deleted" }),
      onError: (error) =>
        notifications.show({
          color: "red",
          title: "Couldn't delete",
          message: describeError(error),
        }),
      onSettled: () => setDeleting(null),
    });
  };

  const totalPages = entries.data ? Math.ceil(entries.data.total / PAGE_SIZE) : 0;

  return (
    <Stack>
      {entries.isError && (
        <Alert color="red" title="Couldn't load the entries">
          {describeError(entries.error)}
        </Alert>
      )}

      {!entries.data ? (
        // Don't spin forever beside an error that already explains itself.
        !entries.isError && (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        )
      ) : entries.data.results.length === 0 ? (
        <Text c="dimmed" size="sm">
          {emptyText}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={820}>
          <Table highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Start</Table.Th>
                <Table.Th>End</Table.Th>
                <Table.Th>Minutes</Table.Th>
                <Table.Th>Category</Table.Th>
                <Table.Th>Task</Table.Th>
                <Table.Th>File ref.</Table.Th>
                <Table.Th>Work type</Table.Th>
                <Table.Th>Notes</Table.Th>
                <Table.Th w={84} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.data.results.map((entry) => (
                // The whole row opens the editor — the biggest possible target
                // for the most common action. The pencil button at the end is
                // the same action for keyboard and screen-reader users, who
                // can't "click a row".
                <Table.Tr
                  key={entry.id}
                  onClick={() => setEditing(entry)}
                  style={{ cursor: "pointer" }}
                >
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
                    <Group gap={4} wrap="nowrap">
                      <ActionIcon
                        variant="subtle"
                        aria-label={`Edit ${entry.task}`}
                        onClick={(event) => {
                          // Don't also fire the row's click underneath.
                          event.stopPropagation();
                          setEditing(entry);
                        }}
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={`Delete ${entry.task}`}
                        onClick={(event) => {
                          // Without this, pressing Delete would open the
                          // editor behind the confirmation.
                          event.stopPropagation();
                          setDeleting(entry);
                        }}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
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

      {/* Mounted only while editing, and keyed by the entry, so the form's
          state is created fresh from that entry each time it opens. */}
      {editing && (
        <EditEntryModal key={editing.id} entry={editing} onClose={() => setEditing(null)} />
      )}

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
    </Stack>
  );
}
