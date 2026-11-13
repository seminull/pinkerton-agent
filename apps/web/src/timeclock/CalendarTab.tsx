import { useMemo, useState } from "react";
import { Alert, Button, Card, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { Calendar } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { IconDownload, IconShare3, IconUpload } from "@tabler/icons-react";
import type { TimeDayTotals, TimeShareScope } from "../api/types";
import PageStack from "../motion/PageStack";
import { downloadCsv } from "./csv";
import DayTimeline from "./DayTimeline";
import EntriesTable from "./EntriesTable";
import ImportEntriesModal from "./ImportEntriesModal";
import { describeError } from "./errors";
import { dayRange, formatDuration, formatLongDay, parseDay } from "./format";
import { fetchAllTimeEntries, useDailyTotals, useTimeSummary } from "./queries";
import Stat from "./Stat";
import ShareTimeClockModal from "./ShareTimeClockModal";
import { useToday } from "./useToday";

// Compact form for a calendar cell, where "2h 05m" is all there is room for and
// a sub-hour day reads better as "45m" than "0h 45m".
const cellDuration = (minutes: number): string =>
  minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;

// The span of days the month grid can show for the month containing `day`. A
// month view also displays the trailing days of the previous month and the
// leading days of the next, so the fetch is padded a week each side rather than
// cut at the 1st and the last — otherwise those edge cells would always look
// empty.
const visibleRange = (day: string): { from: string; to: string } => {
  const anchor = parseDay(day);
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1 - 7);
  const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1 + 7);
  return { from: from.toISOString(), to: to.toISOString() };
};

interface Props {
  /** The selected day, YYYY-MM-DD. Owned by the page so it can live in the URL. */
  day: string;
  onDayChange: (day: string) => void;
}

// Looking back: a month at a glance, with each day's work time in its cell.
// Pick a day and its totals and entries appear underneath.
export default function CalendarTab({ day, onDayChange }: Props) {
  const today = useToday();
  // The month on screen, tracked separately from the selected day: paging the
  // calendar forward or back is browsing, and shouldn't change which day's
  // entries are showing below until one is actually clicked.
  const [shownMonth, setShownMonth] = useState(day);
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [shareScope, setShareScope] = useState<TimeShareScope | null>(null);

  const daily = useDailyTotals(visibleRange(shownMonth));
  const allTotals = useTimeSummary();

  // Keyed by day for O(1) lookup — the calendar calls renderDay for all ~42
  // cells on every render.
  const byDay = useMemo(() => {
    const map = new Map<string, TimeDayTotals>();
    for (const row of daily.data?.days ?? []) map.set(row.day, row);
    return map;
  }, [daily.data]);

  const selected = byDay.get(day);

  const handleExport = async () => {
    setExporting(true);
    try {
      downloadCsv(await fetchAllTimeEntries());
    } catch (error) {
      notifications.show({ color: "red", title: "Export failed", message: describeError(error) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <PageStack>
      {daily.isError && (
        <Alert color="red" title="Couldn't load the calendar">
          {describeError(daily.error)}
        </Alert>
      )}

      <Card withBorder>
        <Calendar
          // Stretches to the card instead of sitting at its fixed picker size —
          // this is a page to read, not a dropdown to pick from.
          fullWidth
          size="xl"
          date={shownMonth}
          onDateChange={setShownMonth}
          // Sunday-first, the US convention; Mantine defaults to Monday.
          firstDayOfWeek={0}
          highlightToday
          // Nothing can have been recorded in the future, so those days are
          // not selectable. Computed from useToday so it advances at midnight.
          maxDate={today}
          getDayProps={(date) => ({
            selected: date === day,
            onClick: () => onDayChange(date),
          })}
          renderDay={(date) => {
            const totals = byDay.get(date);
            return (
              <Stack gap={2} align="center" justify="center" h="100%">
                <Text inherit fw={totals ? 700 : 400}>
                  {Number(date.slice(8))}
                </Text>
                {/* Always rendered, blank on an empty day, so the day numbers
                    sit at the same height in every cell. `inherit` colour: the
                    selected cell is filled rose with white text, and a fixed
                    colour here would vanish against it. */}
                <Text inherit fz={11} lh={1} opacity={0.75} style={{ whiteSpace: "nowrap" }}>
                  {totals ? cellDuration(totals.workMinutes) : " "}
                </Text>
              </Stack>
            );
          }}
          getDayAriaLabel={(date) => {
            const totals = byDay.get(date);
            return totals
              ? `${formatLongDay(date)}, ${formatDuration(totals.workMinutes)} of work`
              : `${formatLongDay(date)}, nothing recorded`;
          }}
          styles={{
            // Tall cells are what make it a "big" calendar and give the
            // duration line room under the date.
            day: { height: 68, borderRadius: "var(--mantine-radius-md)" },
          }}
        />
      </Card>

      <Card withBorder>
        <Stack>
          <Group justify="space-between">
            <Title order={4}>{formatLongDay(day)}</Title>
            <Group gap="sm">
              {day !== today && (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  onClick={() => {
                    onDayChange(today);
                    setShownMonth(today);
                  }}
                >
                  Jump to today
                </Button>
              )}
              <Button
                variant="default"
                size="compact-sm"
                leftSection={<IconShare3 size={16} />}
                onClick={() => setShareScope("day")}
              >
                Share this day
              </Button>
            </Group>
          </Group>
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <Stat label="Work" value={formatDuration(selected?.workMinutes ?? 0)} />
            <Stat label="Breaks" value={formatDuration(selected?.breakMinutes ?? 0)} />
            <Stat
              label="Assistant-performed work"
              value={formatDuration(selected?.assistantMinutes ?? 0)}
            />
            <Stat label="Completed tasks" value={String(selected?.entryCount ?? 0)} />
          </SimpleGrid>
          {/* No emptyText: on an empty day the table's own message below says
              so, and saying it twice in one card is clutter. */}
          <DayTimeline range={dayRange(parseDay(day))} />
          {/* Keyed by the day so picking another one resets the page number. */}
          <EntriesTable
            key={day}
            range={dayRange(parseDay(day))}
            emptyText="Nothing was recorded on this day."
          />
        </Stack>
      </Card>

      <Card withBorder>
        <Stack>
          <Group justify="space-between">
            <Title order={4}>All recorded days</Title>
            <Group gap="sm">
              <Button
                variant="default"
                leftSection={<IconShare3 size={16} />}
                onClick={() => setShareScope("calendar")}
              >
                Share calendar
              </Button>
              {/* Import sits beside Export because they are two directions of
                  the same file: what Export writes, Import can read back. */}
              <Button
                variant="default"
                leftSection={<IconUpload size={16} />}
                onClick={() => setImportOpen(true)}
              >
                Import CSV
              </Button>
              <Button
                variant="default"
                leftSection={<IconDownload size={16} />}
                onClick={handleExport}
                loading={exporting}
                disabled={!allTotals.data || allTotals.data.summary.entryCount === 0}
              >
                Export for Excel (CSV)
              </Button>
            </Group>
          </Group>
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

      <ImportEntriesModal
        opened={importOpen}
        onClose={() => setImportOpen(false)}
        // Show the user what they just imported: select the earliest day in
        // the file and turn the calendar to its month.
        onImported={(firstDay) => {
          onDayChange(firstDay);
          setShownMonth(firstDay);
        }}
      />

      {shareScope && (
        <ShareTimeClockModal
          scope={shareScope}
          day={day}
          onClose={() => setShareScope(null)}
        />
      )}
    </PageStack>
  );
}
