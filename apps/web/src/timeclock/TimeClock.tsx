import { Tabs, Text, Title } from "@mantine/core";
import { IconCalendar, IconClock } from "@tabler/icons-react";
import { useSearchParams } from "react-router";
import PageStack from "../motion/PageStack";
import CalendarTab from "./CalendarTab";
import { formatDay, parseDay } from "./format";
import TodayTab from "./TodayTab";

// A ?day= value is only trusted if it is a real calendar date that isn't in the
// future. The query string is user-editable, and "2026-02-31" or next year
// would otherwise reach the API as a range nothing can match.
const validDay = (raw: string | null, today: string): string | null => {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  // Round-tripping catches impossible dates: JS quietly turns Feb 31 into
  // Mar 3, which then no longer formats back to what was asked for.
  if (formatDay(parseDay(raw)) !== raw) return null;
  return raw > today ? null : raw;
};

// The Time Clock page: a tab for working (Today) and a tab for looking back
// (Calendar).
//
// Which tab and which day are kept in the URL (?tab=calendar&day=2026-11-03)
// rather than in component state, so a reload, a bookmark, or the Back button
// returns to the same view instead of resetting to Today.
export default function TimeClock() {
  const [params, setParams] = useSearchParams();
  const today = formatDay(new Date());
  const tab = params.get("tab") === "calendar" ? "calendar" : "today";
  const day = validDay(params.get("day"), today) ?? today;

  const showTab = (next: string | null) =>
    // Today is the default, so it gets the clean URL with no parameters.
    setParams(next === "calendar" ? { tab: "calendar", day } : {});

  const showDay = (next: string) =>
    // `replace`: clicking through a dozen days shouldn't leave a dozen history
    // entries for the Back button to wade through.
    setParams({ tab: "calendar", day: next }, { replace: true });

  return (
    <PageStack>
      <div>
        <Title order={2}>Time Clock</Title>
        <Text c="dimmed" size="sm">
          Enter a task, press Start, and press Stop when you&apos;re done. Start and end times
          are recorded automatically and saved to your account.
        </Text>
      </div>

      {/* keepMounted={false}: only the visible tab exists. The hidden one would
          otherwise keep fetching, and re-mounting on switch is what replays the
          tab's load-in animation. The running task is unaffected — it lives on
          the server, not in the Today tab's state. */}
      <Tabs value={tab} onChange={showTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="today" leftSection={<IconClock size={16} />}>
            Today
          </Tabs.Tab>
          <Tabs.Tab value="calendar" leftSection={<IconCalendar size={16} />}>
            Calendar
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="today" pt="md">
          <TodayTab />
        </Tabs.Panel>
        <Tabs.Panel value="calendar" pt="md">
          <CalendarTab day={day} onDayChange={showDay} />
        </Tabs.Panel>
      </Tabs>
    </PageStack>
  );
}
