import { useState, type ChangeEvent } from "react";
import { Alert, Button, Group, List, Modal, ScrollArea, Stack, Table, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconUpload } from "@tabler/icons-react";
import { ApiError } from "../api/client";
import { parseTimeCsv, summarizeByDay, type CsvImport } from "./csvImport";
import { formatDuration, formatLongDay } from "./format";
import { useImportTimeEntries, useTimeOptions } from "./queries";

interface Props {
  opened: boolean;
  onClose: () => void;
  /** Called with the earliest imported day, so the calendar can jump to it. */
  onImported: (firstDay: string) => void;
}

// Mirrors MAX_IMPORT_ENTRIES in server/routes/time-entries.routes.ts. Checked
// here so an oversized file is refused with a sentence instead of a 413.
const MAX_ENTRIES = 2000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
// How many unreadable rows to list before summarising the rest.
const PROBLEMS_SHOWN = 6;

const plural = (count: number, one: string, many: string): string =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

// Backfill: bring in time that was tracked somewhere else, on the dates it
// happened. Choose a CSV, see exactly what it contains, then import.
//
// The preview is the point. An import writes dozens of rows across days the
// user isn't looking at, so everything it is about to do — which days, how
// much time, what it will add to Setup, which rows it can't read — is shown
// before anything is saved.
export default function ImportEntriesModal({ opened, onClose, onImported }: Props) {
  const importEntries = useImportTimeEntries();
  const options = useTimeOptions();
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<CsvImport | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const reset = () => {
    setFileName("");
    setParsed(null);
    setFileError(null);
    importEntries.reset();
  };

  const close = () => {
    // Don't let the dialog vanish mid-save and leave the outcome unknown.
    if (importEntries.isPending) return;
    reset();
    onClose();
  };

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    // Cleared so choosing the SAME file again (after fixing it) still fires.
    event.currentTarget.value = "";
    if (!file) return;

    setParsed(null);
    setFileError(null);
    setFileName(file.name);

    if (file.size > MAX_FILE_BYTES) {
      setFileError("That file is larger than 5 MB — too big to be a time log.");
      return;
    }
    try {
      const result = parseTimeCsv(await file.text());
      if (result.rows.length === 0) {
        setFileError(
          result.problems.length > 0
            ? `None of the ${plural(result.problems.length, "row", "rows")} could be read. First problem — line ${result.problems[0]!.line}: ${result.problems[0]!.reason}.`
            : "That file has column names but no entries."
        );
        return;
      }
      if (result.rows.length > MAX_ENTRIES) {
        setFileError(
          `That file has ${result.rows.length.toLocaleString()} entries; one import can take ${MAX_ENTRIES.toLocaleString()}. Split it into smaller files.`
        );
        return;
      }
      setParsed(result);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "That file couldn't be read.");
    }
  };

  const days = parsed ? summarizeByDay(parsed.rows) : [];
  const totalMinutes = days.reduce((sum, day) => sum + day.minutes, 0);

  // Names in the file that aren't in the user's Setup yet. The server adds
  // them; this just says so up front. Compared case-insensitively, as the
  // server does, so "lunch / break" isn't announced as new.
  const newNames = (wanted: string[], existing: { name: string }[] | undefined): string[] => {
    const have = new Set((existing ?? []).map((option) => option.name.toLowerCase()));
    return [...new Set(wanted)].filter((name) => !have.has(name.toLowerCase()));
  };
  const newCategories = parsed
    ? newNames(parsed.rows.map((row) => row.category), options.data?.categories)
    : [];
  const newWorkTypes = parsed
    ? newNames(parsed.rows.map((row) => row.workType), options.data?.workTypes)
    : [];

  const submit = () => {
    if (!parsed) return;
    importEntries.mutate(
      // Listed field by field rather than spread: `line` is for the preview
      // only, and the API should get exactly what it documents.
      parsed.rows.map((row) => ({
        category: row.category,
        task: row.task,
        reference: row.reference,
        workType: row.workType,
        notes: row.notes,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
      })),
      {
        onSuccess: (result) => {
          const added = [...result.createdCategories, ...result.createdWorkTypes];
          notifications.show({
            color: result.imported > 0 ? "green" : "yellow",
            title: "Import complete",
            message: [
              `${plural(result.imported, "entry", "entries")} imported.`,
              result.duplicates > 0
                ? `${plural(result.duplicates, "was", "were")} already there and skipped.`
                : "",
              added.length > 0 ? `Added to Setup: ${added.join(", ")}.` : "",
            ]
              .filter(Boolean)
              .join(" "),
            // Longer than the default: it lists names worth reading.
            autoClose: 9000,
          });
          const firstDay = days[0]?.day;
          reset();
          onClose();
          if (firstDay) onImported(firstDay);
        },
        onError: (error) => {
          // The server names the offending row as "entries.<index>.<field>".
          // Translate the index back to the file's own line number.
          const detail = error instanceof ApiError ? Object.entries(error.details ?? {})[0] : null;
          const index = detail ? Number(/^entries\.(\d+)\./.exec(detail[0])?.[1]) : Number.NaN;
          const line = Number.isNaN(index) ? null : parsed.rows[index]?.line;
          notifications.show({
            color: "red",
            title: "Nothing was imported",
            message: line
              ? `Line ${line} of the file was rejected (${detail![1].replace(/_/g, " ")}). Fix it and try again.`
              : error instanceof ApiError
                ? error.code.replace(/_/g, " ")
                : "The server didn't respond. Please try again.",
          });
        },
      }
    );
  };

  return (
    <Modal opened={opened} onClose={close} title="Import time entries" size="lg">
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Bring in time tracked outside this app. Choose a CSV with columns for Date, Start,
          End, Category, and Task (Work Type, File Reference, and Notes are optional) — the
          format this app&apos;s own export uses. Entries are added on the dates in the file.
        </Text>

        <Group>
          <Button
            component="label"
            variant={parsed ? "light" : "filled"}
            leftSection={<IconUpload size={16} />}
            disabled={importEntries.isPending}
          >
            {parsed ? "Choose another file" : "Choose CSV file"}
            <input hidden type="file" accept=".csv,text/csv" onChange={readFile} />
          </Button>
          {fileName && (
            <Text size="sm" c="dimmed">
              {fileName}
            </Text>
          )}
        </Group>

        {fileError && (
          <Alert color="red" title="Can't import this file">
            {fileError}
          </Alert>
        )}

        {parsed && (
          <>
            <Text size="sm">
              <Text span fw={600}>
                {plural(parsed.rows.length, "entry", "entries")}
              </Text>{" "}
              across {plural(days.length, "day", "days")}, {formatDuration(totalMinutes)} in total.
            </Text>

            <ScrollArea.Autosize mah={220} type="auto">
              <Table striped withTableBorder verticalSpacing={6}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Day</Table.Th>
                    <Table.Th>Entries</Table.Th>
                    <Table.Th>Time</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {days.map((day) => (
                    <Table.Tr key={day.day}>
                      <Table.Td>{formatLongDay(day.day)}</Table.Td>
                      <Table.Td>{day.entries}</Table.Td>
                      <Table.Td>{formatDuration(day.minutes)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>

            {(newCategories.length > 0 || newWorkTypes.length > 0) && (
              <Alert color="blue" title="These will be added to your Setup">
                <Text size="sm">
                  The file uses names you don&apos;t have yet. They&apos;ll be created as
                  ordinary work time — if one of them is a break, switch it on the Setup tab
                  afterwards and the totals will follow.
                </Text>
                <List size="sm" mt="xs">
                  {newCategories.map((name) => (
                    <List.Item key={`c-${name}`}>Category: {name}</List.Item>
                  ))}
                  {newWorkTypes.map((name) => (
                    <List.Item key={`w-${name}`}>Work type: {name}</List.Item>
                  ))}
                </List>
              </Alert>
            )}

            {parsed.problems.length > 0 && (
              <Alert
                color="yellow"
                title={`${plural(parsed.problems.length, "row", "rows")} will be left out`}
              >
                <List size="sm">
                  {parsed.problems.slice(0, PROBLEMS_SHOWN).map((problem) => (
                    <List.Item key={problem.line}>
                      Line {problem.line}: {problem.reason}
                    </List.Item>
                  ))}
                </List>
                {parsed.problems.length > PROBLEMS_SHOWN && (
                  <Text size="sm" mt={4}>
                    …and {parsed.problems.length - PROBLEMS_SHOWN} more.
                  </Text>
                )}
              </Alert>
            )}

            <Text size="xs" c="dimmed">
              Times are read as your local time. Entries already in the app (same start, end,
              and task) are skipped, so importing a file twice won&apos;t double anything.
            </Text>
          </>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={close} disabled={importEntries.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={importEntries.isPending} disabled={!parsed}>
            {parsed ? `Import ${plural(parsed.rows.length, "entry", "entries")}` : "Import"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
