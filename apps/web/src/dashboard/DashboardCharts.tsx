import { BarChart } from "@mantine/charts";
import { Anchor, Center, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Link } from "react-router";
import type { DashboardData } from "../api/types";
import { formatPriceCents } from "../format";
import { parseDay } from "../timeclock/format";
import ChartCard from "./ChartCard";
import "./chart-colors.css";

// The dashboard's charts. All of them are bar charts on purpose: every
// question here is "how many, per thing" — per week, per stage, per source,
// per listing — and lengths against a shared zero are the most accurately read
// mark there is. Each chart has one value axis; nothing here is dual-axis.
//
// Shared mark rules, so the charts read as one set:
// - Thin bars (maxBarWidth). Single bars are rounded only at the data end,
//   square at the baseline, so the zero line stays crisp; stacked columns
//   stay square, since rounding every segment would notch the stack.
// - Stacked segments are outlined in the card color, which draws the 2px gap
//   between touching colors.
// - Gridlines only across the value axis, and Mantine's muted grid color.
//   Mantine's gridAxis names the axis the lines are drawn from, so a column
//   chart's horizontal value lines are gridAxis="x" and a bar chart's are "y".
// - Legends only where there is more than one series; a single-series chart's
//   title already names what it shows.

const CHART_HEIGHT = 260;

const SERIES = {
  1: "var(--viz-1)",
  2: "var(--viz-2)",
  3: "var(--viz-3)",
  4: "var(--viz-4)",
} as const;

// Recharts 3 sorts legend items alphabetically by default. `null` keeps them
// in series order, which is the stack order, so the legend reads in the same
// sequence as the colors from the baseline up.
// No fixed height: at phone width the legend wraps to a second line, and a
// fixed height would clip the last series off the bottom.
const LEGEND = { verticalAlign: "bottom", itemSorter: null } as const;
// 4px of stroke for a 2px gap: the stroke is centered on each segment's edge,
// and the segment painted next covers the outer half of its neighbor's.
// strokeOpacity must be set: Mantine hides bar strokes by default (0), and
// our barProps are spread after its own. Keeping it at 1 while a series is
// dimmed is harmless — the stroke is the card's color, not the series'.
const STACK_GAP = { stroke: "var(--viz-surface)", strokeWidth: 4, strokeOpacity: 1 } as const;
const ROW_END = { radius: [0, 4, 4, 0] as [number, number, number, number] };

const STAGE_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  active: "Active",
  closed: "Closed",
  lost: "Lost",
};

const monthTick = (month: string): string =>
  parseDay(`${month}-01`).toLocaleDateString("en-US", { month: "short" });
const monthLong = (month: string): string =>
  parseDay(`${month}-01`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
const weekTick = (week: string): string =>
  parseDay(week).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const count = (value: number): string => value.toLocaleString();

function Empty({ children }: { children: string }) {
  return (
    <Center h={CHART_HEIGHT}>
      <Text size="sm" c="dimmed" ta="center" maw={320}>
        {children}
      </Text>
    </Center>
  );
}

// ---- touchpoints per week --------------------------------------------------

const TOUCHPOINT_SERIES = [
  { name: "calls", label: "Calls", color: SERIES[1] },
  { name: "messages", label: "Texts & emails", color: SERIES[2] },
  { name: "showings", label: "Showings", color: SERIES[3] },
  { name: "meetings", label: "Meetings", color: SERIES[4] },
] as const;

export function TouchpointsChart({ weeks }: { weeks: DashboardData["touchpointsByWeek"] }) {
  const data = weeks.map((week) => ({ ...week, label: weekTick(week.week) }));
  const total = (row: (typeof weeks)[number]) =>
    row.calls + row.messages + row.showings + row.meetings;

  return (
    <ChartCard
      title="Client touchpoints"
      description="Completed calls, messages, showings and meetings, per week (Monday start), last 12 weeks."
      table={{
        columns: ["Week of", ...TOUCHPOINT_SERIES.map((s) => s.label), "Total"],
        rows: weeks.map((row) => ({
          key: row.week,
          cells: [
            weekTick(row.week),
            ...TOUCHPOINT_SERIES.map((s) => count(row[s.name])),
            count(total(row)),
          ],
        })),
      }}
    >
      {weeks.every((row) => total(row) === 0) ? (
        <Empty>No completed activity in the last 12 weeks. Logged calls, texts and showings will build this chart.</Empty>
      ) : (
        <BarChart
          h={CHART_HEIGHT}
          data={data}
          dataKey="label"
          type="stacked"
          series={[...TOUCHPOINT_SERIES]}
          withLegend
          legendProps={LEGEND}
          gridAxis="x"
          tickLine="none"
          maxBarWidth={28}
          barProps={STACK_GAP}
          valueFormatter={count}
        />
      )}
    </ChartCard>
  );
}

// ---- pipeline by stage -----------------------------------------------------

export function PipelineChart({ pipeline }: { pipeline: DashboardData["pipeline"] }) {
  // Lost leads sit outside the funnel: they're where people leave it, not a
  // step on the way to closed. Charting them as a sixth bar would make the
  // biggest bar on the chart the one that matters least.
  const funnel = pipeline.filter((row) => row.stage !== "lost");
  const lost = pipeline.find((row) => row.stage === "lost")?.count ?? 0;
  const data = funnel.map((row) => ({ label: STAGE_LABELS[row.stage] ?? row.stage, count: row.count }));

  return (
    <ChartCard
      title="Pipeline"
      description={`Contacts at each stage today.${lost ? ` ${count(lost)} more marked lost.` : ""}`}
      table={{
        columns: ["Stage", "Contacts"],
        rows: pipeline.map((row) => ({
          key: row.stage,
          cells: [STAGE_LABELS[row.stage] ?? row.stage, count(row.count)],
        })),
      }}
    >
      {funnel.every((row) => row.count === 0) ? (
        <Empty>No contacts yet.</Empty>
      ) : (
        <BarChart
          h={CHART_HEIGHT}
          data={data}
          dataKey="label"
          orientation="vertical"
          series={[{ name: "count", label: "Contacts", color: SERIES[1] }]}
          gridAxis="y"
          tickLine="none"
          yAxisProps={{ width: 80 }}
          maxBarWidth={24}
          barProps={ROW_END}
          // Five bars, and the counts are the point: label each one so the
          // funnel reads without hovering.
          withBarValueLabel
          valueFormatter={count}
        />
      )}
    </ChartCard>
  );
}

// ---- new leads per month ---------------------------------------------------

const LEAD_SERIES = [
  { name: "buyer", label: "Buyers", color: SERIES[1] },
  { name: "seller", label: "Sellers", color: SERIES[2] },
  { name: "both", label: "Buying & selling", color: SERIES[3] },
] as const;

export function LeadsByMonthChart({ months }: { months: DashboardData["leadsByMonth"] }) {
  const data = months.map((month) => ({ ...month, label: monthTick(month.month) }));
  const total = (row: (typeof months)[number]) => row.buyer + row.seller + row.both;

  return (
    <ChartCard
      title="New leads"
      description="Contacts added each month, by what they're looking to do, last 12 months."
      table={{
        columns: ["Month", ...LEAD_SERIES.map((s) => s.label), "Total"],
        rows: months.map((row) => ({
          key: row.month,
          cells: [monthLong(row.month), ...LEAD_SERIES.map((s) => count(row[s.name])), count(total(row))],
        })),
      }}
    >
      {months.every((row) => total(row) === 0) ? (
        <Empty>No contacts added in the last 12 months.</Empty>
      ) : (
        <BarChart
          h={CHART_HEIGHT}
          data={data}
          dataKey="label"
          type="stacked"
          series={[...LEAD_SERIES]}
          withLegend
          legendProps={LEGEND}
          gridAxis="x"
          tickLine="none"
          maxBarWidth={28}
          barProps={STACK_GAP}
          valueFormatter={count}
        />
      )}
    </ChartCard>
  );
}

// ---- lead sources ----------------------------------------------------------

export function LeadSourcesChart({ sources }: { sources: DashboardData["leadSources"] }) {
  const rate = (row: (typeof sources)[number]) =>
    row.contacts === 0 ? "—" : `${Math.round((row.closed / row.contacts) * 100)}%`;

  return (
    <ChartCard
      title="Lead sources"
      description="Contacts added in the last 12 months, and how many of them have closed."
      table={{
        columns: ["Source", "Contacts", "Closed", "Close rate"],
        rows: sources.map((row) => ({
          key: row.source,
          cells: [row.source, count(row.contacts), count(row.closed), rate(row)],
        })),
      }}
    >
      {sources.length === 0 ? (
        <Empty>No contacts added in the last 12 months.</Empty>
      ) : (
        <BarChart
          h={CHART_HEIGHT}
          data={sources}
          dataKey="source"
          orientation="vertical"
          series={[
            { name: "contacts", label: "Contacts", color: SERIES[1] },
            { name: "closed", label: "Closed", color: SERIES[2] },
          ]}
          withLegend
          legendProps={LEGEND}
          gridAxis="y"
          tickLine="none"
          yAxisProps={{ width: 110 }}
          maxBarWidth={12}
          barProps={ROW_END}
          valueFormatter={count}
        />
      )}
    </ChartCard>
  );
}

// ---- days on market --------------------------------------------------------

// Where a listing usually starts needing a price conversation. A rule of
// thumb, not a market statistic — the line is a prompt to look, nothing more.
const STALE_DAYS = 60;

export function DaysOnMarketChart({ listings }: { listings: DashboardData["daysOnMarket"] }) {
  // Addresses are long; at phone width a full-width label column would leave
  // the bars a sliver. Narrower there, and Recharts wraps the street name.
  const narrow = useMediaQuery("(max-width: 36em)");
  const longest = Math.max(0, ...listings.map((row) => row.days));

  return (
    <ChartCard
      title="Days on market"
      description="Active listings, longest on market first. Counted from the list date."
      table={{
        columns: ["Listing", "Days", "List price"],
        rows: listings.map((row) => ({
          key: row.id,
          cells: [
            <Anchor key="link" component={Link} to={`/listings/${row.id}`} size="sm">
              {row.address}, {row.city}
            </Anchor>,
            count(row.days),
            formatPriceCents(row.listPriceCents),
          ],
        })),
      }}
    >
      {listings.length === 0 ? (
        <Empty>No active listings with a list date.</Empty>
      ) : (
        <BarChart
          h={Math.max(160, listings.length * 30 + 40)}
          data={listings}
          dataKey="address"
          orientation="vertical"
          series={[{ name: "days", label: "Days on market", color: SERIES[1] }]}
          gridAxis="y"
          tickLine="none"
          yAxisProps={{ width: narrow ? 110 : 190 }}
          maxBarWidth={18}
          barProps={ROW_END}
          valueFormatter={(value) => `${count(value)} days`}
          // Only drawn when a listing is near it; a line far past every bar
          // would stretch the axis and squash the chart for nothing.
          referenceLines={
            longest >= STALE_DAYS * 0.75
              ? [{ x: STALE_DAYS, label: `${STALE_DAYS} days`, color: "gray.6" }]
              : []
          }
        />
      )}
    </ChartCard>
  );
}
