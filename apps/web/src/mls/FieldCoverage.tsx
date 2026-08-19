import { useState } from "react";
import {
  Alert,
  Badge,
  Card,
  Code,
  Group,
  Loader,
  NumberInput,
  Progress,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconSearch } from "@tabler/icons-react";
import { useMlsFieldCoverage } from "./queries";

// How much of the RESO surface a feed actually populates.
//
// A Property row carries several hundred fields (620 on Bridge's demo dataset)
// and no feed fills them all — on that same sample, 386 are null in every
// record. A field that exists in the schema but is empty everywhere is not a
// field you have, and modelling a column for it is wasted work. This samples
// the feed so schema decisions get made against reality rather than the spec.

// Fields whose fill rate changes a design decision, called out so they don't get
// lost among three hundred rows.
const NOTABLE: Record<string, string> = {
  ParcelNumber: "Join key to Big District's appraisal data",
  ListingKey: "Immutable sync key — must be 100%",
  ModificationTimestamp: "Replication watermark — must be 100%",
  ListPrice: "Dollars in RESO; we store cents",
  StandardStatus: "Drives the status mapping",
  CountyOrParish: "Drives the county filter",
  UnparsedAddress: "Fallback when the parsed parts are thin",
  PhotosCount: "Whether Media is worth syncing at all",
};

const barColor = (percent: number): string => {
  if (percent >= 90) return "green";
  if (percent >= 40) return "yellow";
  if (percent > 0) return "orange";
  return "gray";
};

export default function FieldCoverage() {
  const [sample, setSample] = useState<string | number>(50);
  const [search, setSearch] = useState("");
  const [onlyPopulated, setOnlyPopulated] = useState(true);
  const [debouncedSearch] = useDebouncedValue(search, 250);
  const [debouncedSample] = useDebouncedValue(sample, 600);

  const size = Number(debouncedSample) || 50;
  const { data, isError, error, isFetching } = useMlsFieldCoverage(size);

  const term = debouncedSearch.trim().toLowerCase();
  const fields = (data?.fields ?? [])
    .filter((field) => (onlyPopulated ? field.percent > 0 : true))
    .filter((field) => (term ? field.name.toLowerCase().includes(term) : true));

  const populated = data?.fields.filter((f) => f.percent > 0).length ?? 0;

  return (
    <Stack>
      <div>
        <Title order={3}>Field coverage</Title>
        <Text size="sm" c="dimmed">
          What this feed actually fills in, sampled live. Decide which columns are worth
          modelling from this, not from the RESO spec.
        </Text>
      </div>

      <Card withBorder padding="sm">
        <Group align="flex-end">
          <NumberInput
            label="Sample size"
            description="Records pulled, full width (no $select)"
            min={1}
            max={200}
            w={200}
            value={sample}
            onChange={setSample}
          />
          <TextInput
            flex={1}
            label="Filter fields"
            placeholder="parcel, price, tax…"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <Switch
            mb={8}
            checked={onlyPopulated}
            onChange={(e) => setOnlyPopulated(e.currentTarget.checked)}
            label="Populated only"
          />
        </Group>
      </Card>

      {isError && (
        <Alert color="red" title="Couldn't sample the feed">
          {error instanceof Error ? error.message : "Unknown error"}
        </Alert>
      )}

      {!data ? (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      ) : (
        <>
          <Group>
            <Badge variant="light">{data.sample} records sampled</Badge>
            <Badge variant="light" color="green">
              {populated} fields populated
            </Badge>
            <Badge variant="light" color="gray">
              {data.fields.length - populated} always empty
            </Badge>
            {isFetching && <Loader size="xs" />}
          </Group>

          <Card withBorder padding={0}>
            <Table.ScrollContainer minWidth={860}>
              <Table highlightOnHover verticalSpacing={6} fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w="26%">Field</Table.Th>
                    <Table.Th w="18%">Fill rate</Table.Th>
                    <Table.Th>Example value</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {fields.map((field) => (
                    <Table.Tr key={field.name}>
                      <Table.Td>
                        <Text size="xs" ff="monospace" fw={NOTABLE[field.name] ? 700 : 400}>
                          {field.name}
                        </Text>
                        {NOTABLE[field.name] && (
                          <Text size="xs" c="blue">
                            {NOTABLE[field.name]}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Progress
                            value={field.percent}
                            color={barColor(field.percent)}
                            size="sm"
                            flex={1}
                          />
                          <Text size="xs" c="dimmed" w={34} ta="right">
                            {field.percent}%
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text
                          size="xs"
                          c={field.example === null ? "dimmed" : undefined}
                          style={{ wordBreak: "break-word" }}
                        >
                          {field.example ?? "—"}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>

          <Alert variant="light" color="gray" title="Reading this on the demo dataset">
            <Text size="sm">
              These fill rates describe Bridge's generated data, not NTREIS. The shape is
              realistic — roughly a third of the surface is populated and the rest is
              null in every record — but which third differs by MLS. Treat this as a
              demonstration of the tool. Re-run it against the live dataset once the feed
              is approved; that's when <Code>ParcelNumber</Code> gets its real answer, and
              that answer decides how the Big District join gets built.
            </Text>
          </Alert>
        </>
      )}
    </Stack>
  );
}
