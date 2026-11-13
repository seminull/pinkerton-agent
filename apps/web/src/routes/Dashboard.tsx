import { Anchor, Card, Grid, Group, Stack, Text, Title } from "@mantine/core";
import { Link } from "react-router";
import DayTimeline from "../timeclock/DayTimeline";
import { dayRange, parseDay } from "../timeclock/format";
import { useToday } from "../timeclock/useToday";
import PageStack from "../motion/PageStack";
import { useContacts } from "../contacts/queries";
import { useListings } from "../listings/queries";
import { formatPriceCents } from "../format";

// Deliberately thin: it reads the two list endpoints for their `total` and
// shows nothing that would need its own aggregate endpoint. When these tiles
// need real numbers (pipeline value, closings this month), add a
// /api/dashboard route rather than pulling whole tables in here.
function StatCard({ label, value, to }: { label: string; value: string; to: string }) {
  return (
    <Card component={Link} to={to} withBorder padding="lg" radius="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700} mt={4}>
        {value}
      </Text>
    </Card>
  );
}

export default function Dashboard() {
  const contacts = useContacts({ limit: 1 });
  const activeListings = useListings({ status: "active", limit: 100 });
  const allListings = useListings({ limit: 1 });
  // From useToday, not `new Date()`, so a dashboard left open overnight rolls
  // over to the new day instead of showing yesterday as "today".
  const todayRange = dayRange(parseDay(useToday()));

  // Sum only the page we fetched — with limit=100 this is honest for a single
  // agent and wrong for a brokerage. That's the trigger to build the aggregate
  // endpoint mentioned above.
  const pipelineCents = (activeListings.data?.results ?? []).reduce(
    (sum, listing) => sum + Number(listing.listPriceCents ?? 0),
    0
  );

  return (
    <PageStack>
      <Group justify="space-between">
        <Title order={2}>Dashboard</Title>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Contacts"
            value={String(contacts.data?.total ?? "—")}
            to="/contacts"
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Listings"
            value={String(allListings.data?.total ?? "—")}
            to="/listings"
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Active"
            value={String(activeListings.data?.total ?? "—")}
            to="/listings"
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Active volume"
            value={formatPriceCents(pipelineCents)}
            to="/listings"
          />
        </Grid.Col>
      </Grid>

      {/* The same component the Time Clock uses, so the two can't disagree and a
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

      <Text c="dimmed" size="sm">
        Bare-bones scaffold. See PLAN.md for the schema and integrations this is
        built to grow into.
      </Text>
    </PageStack>
  );
}
