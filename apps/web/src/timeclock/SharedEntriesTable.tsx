import { useState } from "react";
import { Alert, Group, Loader, Pagination, Stack, Table, Text } from "@mantine/core";
import { describeError } from "./errors";
import { entryMinutes, formatClockTime } from "./format";
import { useSharedEntries } from "./sharedQueries";

const PAGE_SIZE = 25;

interface Props {
  token: string;
  day: string;
  timeZone: string;
}

// Purpose-built rather than a readOnly flag on EntriesTable: this component
// has no edit/delete state, mutations, or file-reference column to accidentally
// expose if the private table changes later.
export default function SharedEntriesTable({ token, day, timeZone }: Props) {
  const [page, setPage] = useState(1);
  const entries = useSharedEntries(token, day, (page - 1) * PAGE_SIZE, PAGE_SIZE);
  const totalPages = entries.data ? Math.ceil(entries.data.total / PAGE_SIZE) : 0;

  return (
    <Stack>
      {entries.isError && (
        <Alert color="red" title="Couldn't load the entries">
          {describeError(entries.error)}
        </Alert>
      )}

      {!entries.data ? (
        !entries.isError && (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        )
      ) : entries.data.results.length === 0 ? (
        <Text c="dimmed" size="sm">
          Nothing was recorded on this day.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={700}>
          <Table highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Start</Table.Th>
                <Table.Th>End</Table.Th>
                <Table.Th>Minutes</Table.Th>
                <Table.Th>Category</Table.Th>
                <Table.Th>Task</Table.Th>
                <Table.Th>Work type</Table.Th>
                <Table.Th>Notes</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.data.results.map((entry) => (
                <Table.Tr key={entry.id}>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    {formatClockTime(entry.startedAt, timeZone)}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    {formatClockTime(entry.endedAt, timeZone)}
                  </Table.Td>
                  <Table.Td>{entryMinutes(entry)}</Table.Td>
                  <Table.Td>{entry.category}</Table.Td>
                  <Table.Td>{entry.task}</Table.Td>
                  <Table.Td>{entry.workType}</Table.Td>
                  <Table.Td>{entry.notes ?? "—"}</Table.Td>
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
  );
}
