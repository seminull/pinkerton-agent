import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Card,
  Center,
  Container,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Calendar } from "@mantine/dates";
import { useParams } from "react-router";
import type { TimeDayTotals, TimeShare, TimeSummary } from "../api/types";
import { BrandMark } from "../brand/Brand";
import PageStack from "../motion/PageStack";
import { describeError } from "./errors";
import { formatDay, formatDuration, formatLongDay, parseDay } from "./format";
import SharedEntriesTable from "./SharedEntriesTable";
import { useSharedDailyTotals, useSharedSummary, useSharedTimeClock } from "./sharedQueries";
import Stat from "./Stat";

const cellDuration = (minutes: number): string =>
  minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;

// Date-only bounds, not instants: the server applies the time zone saved with
// the share, so the viewer's own zone can never move an entry to another day.
const visibleRange = (day: string): { fromDay: string; toDay: string } => {
  const anchor = parseDay(day);
  return {
    fromDay: formatDay(new Date(anchor.getFullYear(), anchor.getMonth(), 1 - 7)),
    toDay: formatDay(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1 + 7)),
  };
};

const todayIn = (timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

function Totals({ summary }: { summary: TimeSummary | undefined }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }}>
      <Stat label="Work" value={formatDuration(summary?.workMinutes ?? 0)} />
      <Stat label="Breaks" value={formatDuration(summary?.breakMinutes ?? 0)} />
      <Stat
        label="Assistant-performed work"
        value={formatDuration(summary?.assistantMinutes ?? 0)}
      />
      <Stat label="Completed tasks" value={String(summary?.entryCount ?? 0)} />
    </SimpleGrid>
  );
}

function SharedDay({ token, share }: { token: string; share: TimeShare }) {
  const summary = useSharedSummary(token);
  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>{formatLongDay(share.day)}</Title>
        {summary.isError && (
          <Alert color="red" title="Couldn't load the totals">
            {describeError(summary.error)}
          </Alert>
        )}
        <Totals summary={summary.data?.summary} />
        <SharedEntriesTable token={token} day={share.day} timeZone={share.timeZone} />
      </Stack>
    </Card>
  );
}

function SharedCalendar({ token, share }: { token: string; share: TimeShare }) {
  const [day, setDay] = useState(share.day);
  const [shownMonth, setShownMonth] = useState(share.day);
  const range = visibleRange(shownMonth);
  const daily = useSharedDailyTotals(token, range.fromDay, range.toDay);
  const allTotals = useSharedSummary(token);
  const today = todayIn(share.timeZone);

  const byDay = useMemo(() => {
    const map = new Map<string, TimeDayTotals>();
    for (const row of daily.data?.days ?? []) map.set(row.day, row);
    return map;
  }, [daily.data]);
  const selected = byDay.get(day);

  return (
    <>
      {daily.isError && (
        <Alert color="red" title="Couldn't load the calendar">
          {describeError(daily.error)}
        </Alert>
      )}

      <Card withBorder>
        <Calendar
          fullWidth
          size="xl"
          date={shownMonth}
          onDateChange={setShownMonth}
          firstDayOfWeek={0}
          highlightToday
          maxDate={today}
          getDayProps={(date) => ({ selected: date === day, onClick: () => setDay(date) })}
          renderDay={(date) => {
            const totals = byDay.get(date);
            return (
              <Stack gap={2} align="center" justify="center" h="100%">
                <Text inherit fw={totals ? 700 : 400}>
                  {Number(date.slice(8))}
                </Text>
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
          styles={{ day: { height: 68, borderRadius: "var(--mantine-radius-md)" } }}
        />
      </Card>

      <Card withBorder>
        <Stack>
          <Title order={4}>{formatLongDay(day)}</Title>
          <Totals summary={selected} />
          <SharedEntriesTable key={day} token={token} day={day} timeZone={share.timeZone} />
        </Stack>
      </Card>

      <Card withBorder>
        <Stack>
          <Title order={4}>All recorded days</Title>
          {allTotals.isError && (
            <Alert color="red" title="Couldn't load the totals">
              {describeError(allTotals.error)}
            </Alert>
          )}
          <Totals summary={allTotals.data?.summary} />
        </Stack>
      </Card>
    </>
  );
}

export default function SharedTimeClock() {
  const token = useParams().token ?? "";
  const result = useSharedTimeClock(token);

  if (!result.data && !result.isError) {
    return (
      <Center mih="100dvh">
        <Loader />
      </Center>
    );
  }

  return (
    <Container size="xl" py="xl">
      <PageStack>
        <Group gap="sm">
          <BrandMark h={38} />
          <div>
            <Group gap="xs">
              <Title order={2}>Shared Time Clock</Title>
              <Badge variant="light">Read-only</Badge>
            </Group>
            <Text c="dimmed" size="sm">
              File references are omitted from this shared view.
            </Text>
          </div>
        </Group>

        {result.isError ? (
          <Alert color="red" title="This share link isn't available">
            It may be invalid or no longer available.
          </Alert>
        ) : result.data!.share.scope === "day" ? (
          <SharedDay token={token} share={result.data!.share} />
        ) : (
          <SharedCalendar token={token} share={result.data!.share} />
        )}
      </PageStack>
    </Container>
  );
}
