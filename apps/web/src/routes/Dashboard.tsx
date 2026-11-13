import type { ReactNode } from "react";
import { Alert, Anchor, Card, Grid, Group, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Link } from "react-router";
import DayTimeline from "../timeclock/DayTimeline";
import { dayRange, parseDay } from "../timeclock/format";
import { useToday } from "../timeclock/useToday";
import PageStack from "../motion/PageStack";
import { formatPriceCents } from "../format";
import { useDashboard } from "../dashboard/queries";
import {
  DaysOnMarketChart,
  LeadSourcesChart,
  LeadsByMonthChart,
  PipelineChart,
  TouchpointsChart,
} from "../dashboard/DashboardCharts";

// Every number here comes from one aggregate request (GET /api/dashboard), so
// the tiles and charts are true for the whole database rather than for the
// first page of a list endpoint.

function StatCard({
  label,
  value,
  to,
  footer,
}: {
  label: string;
  value: string;
  to?: string;
  footer?: ReactNode;
}) {
  const body = (
    <>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700} mt={4}>
        {value}
      </Text>
      {footer}
    </>
  );
  // Two branches rather than a conditional `component` prop: Card's
  // polymorphic typing can't express "a Link, but only sometimes".
  return to ? (
    <Card component={Link} to={to} withBorder padding="lg" radius="md" h="100%">
      {body}
    </Card>
  ) : (
    <Card withBorder padding="lg" radius="md" h="100%">
      {body}
    </Card>
  );
}

export default function Dashboard() {
  const dashboard = useDashboard();
  const data = dashboard.data;
  const tiles = data?.tiles;
  // From useToday, not `new Date()`, so a dashboard left open overnight rolls
  // over to the new day instead of showing yesterday as "today".
  const todayRange = dayRange(parseDay(useToday()));

  return (
    <PageStack>
      <Group justify="space-between">
        <Title order={2}>Dashboard</Title>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <StatCard label="Contacts" value={tiles ? tiles.contactCount.toLocaleString() : "—"} to="/contacts" />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Active listings"
            value={tiles ? tiles.activeListingCount.toLocaleString() : "—"}
            to="/listings"
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Active volume"
            value={tiles ? formatPriceCents(tiles.activeVolumeCents) : "—"}
            to="/listings"
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          {/* Overdue is a status, so it carries an icon and a word as well as
              the red: color alone would be lost on a colorblind reader. */}
          <StatCard
            label="Follow-ups due this week"
            value={tiles ? tiles.dueThisWeek.toLocaleString() : "—"}
            footer={
              tiles && tiles.overdueFollowUps > 0 ? (
                <Group gap={4} mt={4} c="red">
                  <IconAlertTriangle size={14} aria-hidden />
                  <Text size="sm" fw={600} inherit>
                    {tiles.overdueFollowUps.toLocaleString()} overdue
                  </Text>
                </Group>
              ) : tiles ? (
                <Text size="sm" c="dimmed" mt={4}>
                  Nothing overdue
                </Text>
              ) : null
            }
          />
        </Grid.Col>
      </Grid>

      {/* Above the charts: today's work is what an agent opens the dashboard
          to act on; the charts are for stepping back.
          The same component the Time Clock uses, so the two can't disagree and a
          segment clicked here opens the same editor. It reads only the
          signed-in user's own entries, like everything else in the Time Clock. */}
      <Card withBorder>
        <Stack>
          <Group justify="space-between">
            <Title order={4}>Today&apos;s timeline</Title>
            <Anchor component={Link} to="/time-clock" size="sm">
              Open Time Clock
            </Anchor>
          </Group>
          <DayTimeline
            range={todayRange}
            emptyText="Nothing tracked yet today. Start a task in the Time Clock and your day will be drawn here."
          />
        </Stack>
      </Card>

      {dashboard.isError && (
        <Alert color="red" title="Couldn't load the dashboard">
          The server didn&apos;t answer. Refresh to try again.
        </Alert>
      )}

      {data && (
        <Grid>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <TouchpointsChart weeks={data.touchpointsByWeek} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <PipelineChart pipeline={data.pipeline} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <LeadsByMonthChart months={data.leadsByMonth} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <LeadSourcesChart sources={data.leadSources} />
          </Grid.Col>
          <Grid.Col span={12}>
            <DaysOnMarketChart listings={data.daysOnMarket} />
          </Grid.Col>
        </Grid>
      )}
    </PageStack>
  );
}
