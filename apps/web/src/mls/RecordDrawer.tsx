import { useState } from "react";
import {
  Alert,
  Badge,
  Code,
  Drawer,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Switch,
  Table,
  Text,
} from "@mantine/core";
import { formatPriceCents } from "../format";
import { useMlsProperty } from "./queries";

// The full RESO record for one listing, unnarrowed. This is the view that
// answers "what does this feed actually carry" — the search endpoint uses a
// $select allowlist, so a field missing from the results table might still be
// present here.

interface Props {
  listingKey: string | undefined;
  onClose: () => void;
}

// Fields worth reading first, in the order a person would want them. Everything
// else follows alphabetically — a Property row runs to several hundred columns
// and unordered is unreadable.
const PINNED = [
  "ListingKey",
  "ListingId",
  "StandardStatus",
  "ListPrice",
  "ParcelNumber",
  "UnparsedAddress",
  "CountyOrParish",
  "City",
  "StateOrProvince",
  "PostalCode",
  "PropertyType",
  "ModificationTimestamp",
];

const isEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

const render = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length === 0 ? "[]" : value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export default function RecordDrawer({ listingKey, onClose }: Props) {
  // Default to hiding empties: on a typical record ~80% of the columns are null,
  // and the signal is entirely in the 20% that aren't.
  const [showEmpty, setShowEmpty] = useState(false);
  const [asJson, setAsJson] = useState(false);
  const { data, isError, error } = useMlsProperty(listingKey);

  const raw = data?.raw ?? {};
  const names = Object.keys(raw).filter((name) => name !== "@odata.id");
  const ordered = [
    ...PINNED.filter((name) => names.includes(name)),
    ...names.filter((name) => !PINNED.includes(name)).sort(),
  ];
  const visible = showEmpty ? ordered : ordered.filter((name) => !isEmpty(raw[name]));

  return (
    <Drawer
      opened={Boolean(listingKey)}
      onClose={onClose}
      position="right"
      size="xl"
      title={
        <Group gap="xs">
          <Text fw={600}>Raw MLS record</Text>
          {data && (
            <Badge variant="light" color="gray">
              {visible.length} of {ordered.length} fields
            </Badge>
          )}
        </Group>
      }
    >
      <Stack>
        {isError && (
          <Alert color="red" title="Couldn't load the record">
            {error instanceof Error ? error.message : "Unknown error"}
          </Alert>
        )}

        {!data && !isError ? (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        ) : data ? (
          <>
            <Group gap="lg">
              <Switch
                size="xs"
                checked={showEmpty}
                onChange={(e) => setShowEmpty(e.currentTarget.checked)}
                label="Show empty fields"
              />
              <Switch
                size="xs"
                checked={asJson}
                onChange={(e) => setAsJson(e.currentTarget.checked)}
                label="JSON"
              />
            </Group>

            <Alert variant="light" color="blue" title="Price conversion">
              <Text size="sm">
                RESO sends <Code>ListPrice</Code> as dollars:{" "}
                <Code>{render(raw.ListPrice)}</Code>. The API converts it at the
                boundary to <Code>{formatPriceCents(data.listing.listPriceCents)}</Code>{" "}
                ({data.listing.listPriceCents ?? "null"} cents) so the rest of the app
                keeps its integer-cents rule.
              </Text>
            </Alert>

            {asJson ? (
              <ScrollArea h={600}>
                <Code block>{JSON.stringify(raw, null, 2)}</Code>
              </ScrollArea>
            ) : (
              <Table striped highlightOnHover verticalSpacing={4} fz="xs">
                <Table.Tbody>
                  {visible.map((name) => (
                    <Table.Tr key={name}>
                      <Table.Td w="40%">
                        <Text size="xs" fw={PINNED.includes(name) ? 600 : 400} ff="monospace">
                          {name}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text
                          size="xs"
                          c={isEmpty(raw[name]) ? "dimmed" : undefined}
                          style={{ wordBreak: "break-word" }}
                        >
                          {render(raw[name])}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </>
        ) : null}
      </Stack>
    </Drawer>
  );
}
