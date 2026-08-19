import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Card,
  Code,
  Group,
  List,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Timeline,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconCurrencyDollar,
  IconKey,
  IconLock,
} from "@tabler/icons-react";
import { useMlsStatus } from "./queries";

// In-app documentation for the MLS integration. It lives here rather than in a
// markdown file because the questions it answers ("why is this empty?", "which
// dataset am I on?") come up while looking at the explorer, and an answer two
// clicks away gets read.

export default function MlsDocs() {
  const { data: feed } = useMlsStatus();

  return (
    <Stack>
      <div>
        <Title order={3}>How this works</Title>
        <Text size="sm" c="dimmed">
          What's wired up, what's free, and what's still gated on an approval.
        </Text>
      </div>

      <Card withBorder padding="md">
        <Group justify="space-between" mb="xs">
          <Text fw={600}>Current connection</Text>
          {feed && (
            <Badge color={feed.reachable ? "green" : "red"} variant="light">
              {feed.reachable ? "Reachable" : "Unreachable"}
            </Badge>
          )}
        </Group>
        {feed ? (
          <Table fz="sm" verticalSpacing={4}>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td w="30%">Dataset</Table.Td>
                <Table.Td>
                  <Code>{feed.dataset}</Code>{" "}
                  {feed.isDemoData && (
                    <Badge size="xs" color="yellow" variant="light" ml="xs">
                      synthetic records
                    </Badge>
                  )}
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Endpoint</Table.Td>
                <Table.Td>
                  <Code>{feed.base}</Code>
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Token</Table.Td>
                <Table.Td>
                  <Code>{feed.tokenHint}</Code>{" "}
                  <Badge size="xs" variant="light" color={feed.isDemoToken ? "yellow" : "green"}>
                    {feed.isDemoToken ? "shared public token" : "your server token"}
                  </Badge>
                  <Text size="xs" c="dimmed" mt={2}>
                    Server-side only — never sent to this page. Dataset and token are
                    independent: your own token pointed at <Code>test</Code> still returns
                    synthetic records.
                  </Text>
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Target counties</Table.Td>
                <Table.Td>{feed.targetCounties.join(", ")}</Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        ) : (
          <Text size="sm" c="dimmed">
            Checking…
          </Text>
        )}
      </Card>

      <Accordion variant="separated" defaultValue="free">
        <Accordion.Item value="free">
          <Accordion.Control
            icon={
              <ThemeIcon size="sm" variant="light" color="green">
                <IconCheck size={14} />
              </ThemeIcon>
            }
          >
            What you can do for free, right now
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <Text size="sm">
                This tab runs with no signup, no approval, and no credential. It uses
                Bridge's public <Code>test</Code> dataset and their documented demo token,
                which is why a fresh clone works immediately.
              </Text>
              <Table fz="sm" withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Thing</Table.Th>
                    <Table.Th>Cost</Table.Th>
                    <Table.Th>Gate</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td>Bridge demo dataset (what you're on)</Table.Td>
                    <Table.Td>
                      <Badge size="xs" color="green" variant="light">
                        Free
                      </Badge>
                    </Table.Td>
                    <Table.Td>None</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>Bridge developer account</Table.Td>
                    <Table.Td>
                      <Badge size="xs" color="green" variant="light">
                        Free
                      </Badge>
                    </Table.Td>
                    <Table.Td>Registration only</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>Live NTREIS feed via Bridge</Table.Td>
                    <Table.Td>
                      <Badge size="xs" color="green" variant="light">
                        Free for approved uses
                      </Badge>
                    </Table.Td>
                    <Table.Td>MLS approval + broker signature</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>Live NTREIS feed via Trestle</Table.Td>
                    <Table.Td>
                      <Badge size="xs" color="orange" variant="light">
                        Paid
                      </Badge>
                    </Table.Td>
                    <Table.Td>MLS approval + broker signature</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>County appraisal data</Table.Td>
                    <Table.Td>
                      <Badge size="xs" color="green" variant="light">
                        Already yours
                      </Badge>
                    </Table.Td>
                    <Table.Td>Big District</Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              <Text size="sm" c="dimmed">
                Bridge doesn't charge for approved feeds — Zillow Group subsidizes the
                platform. Any fee comes from NTREIS, not from Bridge, and that's a
                question for them.
              </Text>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="who">
          <Accordion.Control
            icon={
              <ThemeIcon size="sm" variant="light" color="blue">
                <IconLock size={14} />
              </ThemeIcon>
            }
          >
            Who owns what: NTREIS vs Bridge
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <Text size="sm">
                <strong>Bridge is the pipe, not the licence.</strong> They normalize each
                MLS's feed to RESO field names, host the API, and route your access
                request. They do not decide whether you get NTREIS data — NTREIS does.
              </Text>
              <Text size="sm">
                Your Bridge account is a developer identity with no listing data attached
                to it. The Data Access request you file there sits in{" "}
                <Code>Pending</Code> until NTREIS reviews it.
              </Text>
              <Text size="sm" fw={600} mt="xs">
                Three feed tiers — ask for the right one
              </Text>
              <Table fz="sm" withTableBorder>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td w="20%">
                      <Code>IDX</Code>
                    </Table.Td>
                    <Table.Td>
                      Public display on a consumer website. Stripped field set, opt-outs
                      removed, strict attribution rules. Wrong for a CRM.
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>
                      <Code>VOW</Code>
                    </Table.Td>
                    <Table.Td>
                      Virtual Office Website — more fields, but only for consumers who
                      have registered a broker relationship. Also wrong for a CRM.
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>
                      <Code>BBO</Code>
                    </Table.Td>
                    <Table.Td>
                      <strong>Broker Back-Office — this is the one.</strong> Full data for
                      internal use by the brokerage's own agents. Not public display. The
                      broker of record signs, not the agent.
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              <Alert
                color="yellow"
                variant="light"
                icon={<IconAlertTriangle size={16} />}
                mt="xs"
              >
                <Text size="sm">
                  Your Matrix login is not a data feed. Scraping Matrix — or driving it
                  headless — breaches the subscriber agreement, and the consequence is
                  losing MLS access, not a warning.
                </Text>
              </Alert>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="reso">
          <Accordion.Control
            icon={
              <ThemeIcon size="sm" variant="light" color="grape">
                <IconKey size={14} />
              </ThemeIcon>
            }
          >
            RESO field gotchas that bite
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <List size="sm" spacing="sm">
                <List.Item>
                  <Code>ListingKey</Code> vs <Code>ListingId</Code> — these are not the
                  same thing. <Code>ListingKey</Code> is the MLS's immutable internal
                  identifier and the only safe key to sync on.{" "}
                  <Code>ListingId</Code> is the human-facing MLS number, and it can change
                  (relist, correction, transfer). Key on the wrong one and a relist
                  silently forks into two records.
                </List.Item>
                <List.Item>
                  <Code>ListPrice</Code> is a decimal <em>dollar</em> amount. This repo
                  stores integer cents everywhere. The conversion happens once, in{" "}
                  <Code>server/mls/bridge.ts</Code>, and the explorer shows both numbers
                  side by side in the record drawer so the boundary stays visible.
                </List.Item>
                <List.Item>
                  <Code>ParcelNumber</Code> is the join key to Big District. Carry it from
                  day one — retrofitting means fuzzy-matching MLS addresses against a CAD,
                  which fails on abbreviations, unit designators, and annexation-era
                  renames. Fill rate varies by MLS, so check the Field coverage tab once
                  the live feed is on.
                </List.Item>
                <List.Item>
                  <Code>StandardStatus</Code> is the normalized status;{" "}
                  <Code>MlsStatus</Code> is the MLS's own vocabulary. Map from the former,
                  keep the latter for display if agents expect their own words.
                </List.Item>
                <List.Item>
                  A Property row carries several hundred fields — 620 on the demo dataset,
                  386 of them null in every single record. A field that's in the schema
                  but empty everywhere is not a field you have. That's what the Field
                  coverage tab is for: check before you model a column.
                </List.Item>
              </List>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="sync">
          <Accordion.Control
            icon={
              <ThemeIcon size="sm" variant="light" color="teal">
                <IconCurrencyDollar size={14} />
              </ThemeIcon>
            }
          >
            How a real sync differs from this explorer
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <Text size="sm">
                This tab reads straight through to Bridge on every query. A production
                sync would not — it would replicate into a local cache. Three things
                change:
              </Text>
              <List size="sm" spacing="sm">
                <List.Item>
                  <strong>Page on a watermark, not an offset.</strong> Filter{" "}
                  <Code>ModificationTimestamp gt &lt;last seen&gt;</Code>, order by the
                  same column, carry the last value forward. Offset paging (
                  <Code>$skip</Code>) over a dataset that's mutating underneath you
                  silently drops and duplicates rows. The explorer uses{" "}
                  <Code>$skip</Code> because a human clicking page 3 doesn't care; a sync
                  job does.
                </List.Item>
                <List.Item>
                  <strong>Deletes are invisible.</strong> A listing that leaves the feed —
                  opt-out, licence scope change — never appears as a modification. You
                  need the replication endpoint's removal reporting or a periodic
                  full-key reconciliation pass, or your cache grows ghosts.
                </List.Item>
                <List.Item>
                  <strong>The cache is not your system of record.</strong> Licences
                  normally cap how long MLS data may be retained and require attribution.
                  Keep MLS rows in their own table with a provenance column and a TTL,
                  separate from the agent-entered <Code>listings</Code> table, joined by a
                  nullable FK. Then a full truncate-and-resync is safe, and your own data
                  survives a licence ending.
                </List.Item>
              </List>
              <Alert variant="light" color="blue">
                <Text size="sm">
                  Nothing is cached yet — there's no <Code>mls_listings</Code> table. That
                  lands with the sync job, and it's deliberately not here, because a cache
                  built before the licence terms are known usually has to be rebuilt after
                  they arrive.
                </Text>
              </Alert>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="next">
          <Accordion.Control>Where this goes next</Accordion.Control>
          <Accordion.Panel>
            <Timeline active={1} bulletSize={18} lineWidth={2}>
              <Timeline.Item title="Bridge account registered">
                <Text size="xs" c="dimmed">
                  Done. Gives you the dashboard and the demo dataset.
                </Text>
              </Timeline.Item>
              <Timeline.Item title="Explore against demo data">
                <Text size="xs" c="dimmed">
                  You're here. Learn the field surface and the OData syntax at zero cost
                  and zero risk.
                </Text>
              </Timeline.Item>
              <Timeline.Item title="Request the NTREIS back-office feed">
                <Text size="xs" c="dimmed">
                  Bridge dashboard → Data Access. Confirm NTREIS is listed; if it isn't,
                  Trestle is the route instead. Broker of record signs.
                </Text>
              </Timeline.Item>
              <Timeline.Item title="Swap the dataset">
                <Text size="xs" c="dimmed">
                  Set <Code>BRIDGE_TOKEN</Code> and <Code>BRIDGE_DATASET</Code> in{" "}
                  <Code>.env</Code>. Nothing else in the code changes.
                </Text>
              </Timeline.Item>
              <Timeline.Item title="Build the cache and the sync job">
                <Text size="xs" c="dimmed">
                  <Code>mls_listings</Code> table, watermark replication, reconciliation
                  pass, then the Big District join on <Code>ParcelNumber</Code>.
                </Text>
              </Timeline.Item>
            </Timeline>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      <Card withBorder padding="md">
        <Text fw={600} size="sm" mb="xs">
          Reference
        </Text>
        <List size="sm" spacing={4}>
          <List.Item>
            <Anchor href="https://bridgedataoutput.com/docs" target="_blank" size="sm">
              Bridge Data Output documentation
            </Anchor>
          </List.Item>
          <List.Item>
            <Anchor href="https://ddwiki.reso.org/" target="_blank" size="sm">
              RESO Data Dictionary wiki — every field, defined
            </Anchor>
          </List.Item>
          <List.Item>
            <Anchor href="https://www.ntreis.net/" target="_blank" size="sm">
              NTREIS
            </Anchor>
          </List.Item>
        </List>
      </Card>
    </Stack>
  );
}
