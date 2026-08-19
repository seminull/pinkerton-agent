import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Autocomplete,
  Badge,
  Button,
  Card,
  Code,
  Collapse,
  Grid,
  Group,
  Loader,
  MultiSelect,
  NumberInput,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import {
  IconAlertTriangle,
  IconCode,
  IconEye,
  IconMapPin,
  IconRefresh,
} from "@tabler/icons-react";
import { formatDate, formatPriceCents } from "../format";
import RecordDrawer from "./RecordDrawer";
import { useMlsSearch, useMlsStatus, type MlsFilters } from "./queries";

const PAGE_SIZE = 25;

// RESO StandardStatus. Free-text rather than a closed Select because feeds carry
// non-standard values in practice (Bridge's demo data included), and a dropdown
// that can't express what the feed contains is worse than one that suggests.
const STATUS_SUGGESTIONS = [
  "Active",
  "ActiveUnderContract",
  "Pending",
  "Closed",
  "Canceled",
  "Expired",
  "Withdrawn",
  "ComingSoon",
  "Hold",
];

const PROPERTY_TYPE_SUGGESTIONS = [
  "Residential",
  "ResidentialLease",
  "ResidentialIncome",
  "Land",
  "Farm",
  "CommercialSale",
  "CommercialLease",
  "BusinessOpportunity",
];

const SORT_OPTIONS = [
  { value: "ModificationTimestamp", label: "Last modified" },
  { value: "ListPrice", label: "List price" },
  { value: "YearBuilt", label: "Year built" },
  { value: "LivingArea", label: "Living area" },
  { value: "BedroomsTotal", label: "Bedrooms" },
];

export default function MlsExplorer() {
  const [counties, setCounties] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [minPrice, setMinPrice] = useState<string | number>("");
  const [maxPrice, setMaxPrice] = useState<string | number>("");
  const [minBeds, setMinBeds] = useState<string | number>("");
  const [minBaths, setMinBaths] = useState<string | number>("");
  const [minYearBuilt, setMinYearBuilt] = useState<string | number>("");
  const [modifiedSince, setModifiedSince] = useState("");
  const [sort, setSort] = useState("ModificationTimestamp");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [showQuery, setShowQuery] = useState(true);
  const [inspecting, setInspecting] = useState<string | undefined>();

  // Text inputs feed the query directly, so debounce them — every keystroke
  // otherwise costs a Bridge request against the hourly quota.
  const [debouncedCity] = useDebouncedValue(city, 400);
  const [debouncedState] = useDebouncedValue(state, 400);

  const { data: feed } = useMlsStatus();

  // Sourced from the API rather than duplicated here, so Big District's coverage
  // is stated in exactly one place (TARGET_COUNTIES in server/mls/bridge.ts).
  const targetCounties = feed?.targetCounties ?? [];

  // On the demo dataset every record's CountyOrParish is the literal string
  // "County", so any real county name matches nothing. Worth detecting rather
  // than letting an empty table imply the query is broken.
  const countyFilterIsFutile = Boolean(feed?.isDemoData) && counties.length > 0;

  const num = (value: string | number): number | undefined =>
    value === "" || value === null ? undefined : Number(value);

  const filters: MlsFilters = {
    counties: counties.length > 0 ? counties.join(",") : undefined,
    status: status || undefined,
    propertyType: propertyType || undefined,
    city: debouncedCity || undefined,
    state: debouncedState || undefined,
    minPrice: num(minPrice),
    maxPrice: num(maxPrice),
    minBeds: num(minBeds),
    minBaths: num(minBaths),
    minYearBuilt: num(minYearBuilt),
    modifiedSince: modifiedSince || undefined,
    sort,
    dir,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const { data, isError, error, isFetching, refetch } = useMlsSearch(filters);

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={3}>MLS explorer</Title>
          <Text size="sm" c="dimmed">
            Live queries against the Bridge RESO Web API. Read-only.
          </Text>
        </div>
        <Group gap="xs">
          {feed && (
            <Badge
              variant="light"
              color={feed.isDemoData ? "yellow" : feed.reachable ? "green" : "red"}
            >
              {feed.dataset} {feed.isDemoData ? "(demo)" : ""}
            </Badge>
          )}
          <Tooltip label="Re-run the query">
            <ActionIcon variant="light" onClick={() => refetch()} loading={isFetching}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {feed?.isDemoData && (
        <Alert
          color="yellow"
          icon={<IconAlertTriangle size={18} />}
          title="Synthetic data — geography is not real"
        >
          <Text size="sm">
            You're on Bridge's public <Code>test</Code> dataset. Field{" "}
            <em>names</em> and <em>types</em> are the real RESO Data Dictionary, which is
            what makes it useful for building. The <em>values</em> are generated: every
            record's <Code>CountyOrParish</Code> is the literal string "County", cities
            are invented, and states are scattered nationwide.
          </Text>
          <Text size="sm" mt="xs">
            So filtering to Collin / Dallas / Denton / Tarrant returns zero rows here.
            That control is wired correctly and starts working the day NTREIS approves a
            feed — don't take the empty result as a bug.
          </Text>
        </Alert>
      )}

      {feed && !feed.reachable && (
        <Alert color="red" title="Feed unreachable">
          {feed.error ?? "Bridge did not answer."} Check <Code>BRIDGE_TOKEN</Code> and{" "}
          <Code>BRIDGE_DATASET</Code> in <Code>.env</Code>.
        </Alert>
      )}

      <Card withBorder padding="sm">
        <Stack gap="sm">
          <Grid gap="sm">
            <Grid.Col span={{ base: 12, md: 6 }}>
              <MultiSelect
                label="Counties"
                description="OR-ed together into one CountyOrParish clause"
                placeholder="Any county"
                data={targetCounties}
                value={counties}
                onChange={resetPage(setCounties)}
                searchable
                clearable
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Group align="flex-end" h="100%">
                <Tooltip
                  label="Matches nothing on the demo dataset — its county field is a placeholder. Works once a real feed is connected."
                  multiline
                  w={260}
                  disabled={!feed?.isDemoData}
                >
                  <Button
                    variant="light"
                    color={feed?.isDemoData ? "gray" : "blue"}
                    leftSection={<IconMapPin size={16} />}
                    onClick={() => resetPage(setCounties)(targetCounties)}
                    disabled={targetCounties.length === 0}
                  >
                    My 4 counties
                    {feed?.isDemoData && " (no-op on demo)"}
                  </Button>
                </Tooltip>
                <Button
                  variant="subtle"
                  onClick={() => resetPage(setCounties)([])}
                  disabled={counties.length === 0}
                >
                  Clear
                </Button>
              </Group>
            </Grid.Col>

            <Grid.Col span={{ base: 6, md: 3 }}>
              <Autocomplete
                label="Status"
                placeholder="Any"
                data={STATUS_SUGGESTIONS}
                value={status}
                onChange={resetPage(setStatus)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 3 }}>
              <Autocomplete
                label="Property type"
                placeholder="Any"
                data={PROPERTY_TYPE_SUGGESTIONS}
                value={propertyType}
                onChange={resetPage(setPropertyType)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 3 }}>
              <TextInput
                label="City"
                placeholder="Exact match"
                value={city}
                onChange={(e) => resetPage(setCity)(e.currentTarget.value)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 3 }}>
              <TextInput
                label="State"
                placeholder="TX"
                value={state}
                onChange={(e) => resetPage(setState)(e.currentTarget.value)}
              />
            </Grid.Col>

            <Grid.Col span={{ base: 6, md: 3 }}>
              <NumberInput
                label="Min price"
                description="Dollars, not cents"
                placeholder="0"
                thousandSeparator=","
                value={minPrice}
                onChange={resetPage(setMinPrice)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 3 }}>
              <NumberInput
                label="Max price"
                description="Dollars, not cents"
                placeholder="Any"
                thousandSeparator=","
                value={maxPrice}
                onChange={resetPage(setMaxPrice)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 4, md: 2 }}>
              <NumberInput
                label="Min beds"
                placeholder="Any"
                min={0}
                value={minBeds}
                onChange={resetPage(setMinBeds)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 4, md: 2 }}>
              <NumberInput
                label="Min baths"
                placeholder="Any"
                min={0}
                value={minBaths}
                onChange={resetPage(setMinBaths)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 4, md: 2 }}>
              <NumberInput
                label="Built after"
                placeholder="Any"
                value={minYearBuilt}
                onChange={resetPage(setMinYearBuilt)}
              />
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 4 }}>
              <TextInput
                label="Modified since"
                description="The watermark a real sync pages on"
                placeholder="2025-01-01T00:00:00Z"
                value={modifiedSince}
                onChange={(e) => resetPage(setModifiedSince)(e.currentTarget.value)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 8, md: 5 }}>
              <Select
                label="Sort by"
                data={SORT_OPTIONS}
                value={sort}
                onChange={(value) => resetPage(setSort)(value ?? "ModificationTimestamp")}
                allowDeselect={false}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 4, md: 3 }}>
              <Select
                label="Direction"
                data={[
                  { value: "desc", label: "Descending" },
                  { value: "asc", label: "Ascending" },
                ]}
                value={dir}
                onChange={(value) => resetPage(setDir)((value as "asc" | "desc") ?? "desc")}
                allowDeselect={false}
              />
            </Grid.Col>
          </Grid>
        </Stack>
      </Card>

      <Card withBorder padding="sm">
        <Group justify="space-between" mb={showQuery ? "xs" : 0}>
          <Group gap="xs">
            <IconCode size={16} />
            <Text size="sm" fw={600}>
              Generated OData
            </Text>
          </Group>
          <Button size="compact-xs" variant="subtle" onClick={() => setShowQuery((v) => !v)}>
            {showQuery ? "Hide" : "Show"}
          </Button>
        </Group>
        <Collapse expanded={showQuery}>
          {data ? (
            <Stack gap={6}>
              <div>
                <Text size="xs" c="dimmed">
                  $filter
                </Text>
                <Code block>{data.query.filter}</Code>
              </div>
              <div>
                <Text size="xs" c="dimmed">
                  $orderby
                </Text>
                <Code block>{data.query.orderby}</Code>
              </div>
              <div>
                <Text size="xs" c="dimmed">
                  Request URL (token redacted)
                </Text>
                <Code block style={{ wordBreak: "break-all" }}>
                  {data.query.url}
                </Code>
              </div>
            </Stack>
          ) : (
            <Text size="sm" c="dimmed">
              Run a query to see the OData it produces.
            </Text>
          )}
        </Collapse>
      </Card>

      {isError && (
        <Alert color="red" title="Query failed">
          {error instanceof Error ? error.message : "Unknown error"}
        </Alert>
      )}

      {!data ? (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      ) : data.results.length === 0 ? (
        <Card withBorder padding="xl">
          <Stack align="center" gap="xs">
            <Text fw={600}>No matching listings</Text>
            {countyFilterIsFutile ? (
              // The overwhelmingly likely cause, so name it and offer the fix
              // rather than making someone deduce it from the banner above.
              <>
                <Text c="dimmed" size="sm" ta="center" maw={520}>
                  The county filter is the cause. Every record in the demo dataset has{" "}
                  <Code>CountyOrParish</Code> set to the literal string "County", so{" "}
                  {counties.join(", ")} can't match. The query itself is fine — it will
                  work as written once a real feed is connected.
                </Text>
                <Button
                  variant="light"
                  mt="xs"
                  onClick={() => resetPage(setCounties)([])}
                >
                  Clear the county filter
                </Button>
              </>
            ) : (
              <Text c="dimmed" size="sm" ta="center" maw={520}>
                The feed answered and the filter matched nothing. On the demo dataset
                that's expected for any real-world place name — cities and states are
                generated too.
              </Text>
            )}
          </Stack>
        </Card>
      ) : (
        <Card withBorder padding={0}>
          <Table.ScrollContainer minWidth={1000}>
            <Table highlightOnHover verticalSpacing="sm" fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Address</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Price</Table.Th>
                  <Table.Th>County</Table.Th>
                  <Table.Th>
                    <Tooltip
                      label="ParcelNumber — the join key to Big District's appraisal data"
                      multiline
                      w={240}
                    >
                      <Text size="sm" fw={600} style={{ borderBottom: "1px dotted" }}>
                        Parcel
                      </Text>
                    </Tooltip>
                  </Table.Th>
                  <Table.Th>Bd/Ba</Table.Th>
                  <Table.Th>Sq ft</Table.Th>
                  <Table.Th>Built</Table.Th>
                  <Table.Th>Modified</Table.Th>
                  <Table.Th w={50} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.results.map((row) => (
                  <Table.Tr key={row.listingKey}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {row.address ?? "—"}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {row.city ?? "—"}, {row.state ?? "—"} {row.postalCode ?? ""} ·{" "}
                        {row.listingId ?? "no MLS #"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color="gray">
                        {row.status ?? "—"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{formatPriceCents(row.listPriceCents)}</Table.Td>
                    <Table.Td>{row.county ?? "—"}</Table.Td>
                    <Table.Td>
                      <Text
                        size="xs"
                        ff="monospace"
                        c={row.parcelNumber ? undefined : "dimmed"}
                      >
                        {row.parcelNumber ?? "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {row.bedrooms ?? "—"} / {row.bathrooms ?? "—"}
                    </Table.Td>
                    <Table.Td>{row.livingAreaSqft?.toLocaleString() ?? "—"}</Table.Td>
                    <Table.Td>{row.yearBuilt ?? "—"}</Table.Td>
                    <Table.Td>{formatDate(row.modificationTimestamp)}</Table.Td>
                    <Table.Td>
                      <Tooltip label="Inspect all RESO fields">
                        <ActionIcon
                          variant="subtle"
                          aria-label={`Inspect ${row.listingKey}`}
                          onClick={() => setInspecting(row.listingKey)}
                        >
                          <IconEye size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}

      {data && (
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {data.total.toLocaleString()} matching {data.total === 1 ? "row" : "rows"}
          </Text>
          {data.total > PAGE_SIZE && (
            <Pagination
              value={page}
              onChange={setPage}
              total={Math.ceil(data.total / PAGE_SIZE)}
            />
          )}
        </Group>
      )}

      <RecordDrawer listingKey={inspecting} onClose={() => setInspecting(undefined)} />
    </Stack>
  );
}
