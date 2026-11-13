import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconPencil, IconPlus, IconSearch } from "@tabler/icons-react";
import type { Listing, ListingStatus } from "../api/types";
import { LISTING_STATUS_COLORS } from "../theme";
import { formatDate, formatPriceCents, humanize } from "../format";
import PageStack from "../motion/PageStack";
import ListingFormModal from "./ListingFormModal";
import { useListings } from "./queries";

const PAGE_SIZE = 25;

const STATUS_FILTER = [
  { value: "draft", label: "Draft" },
  { value: "coming_soon", label: "Coming soon" },
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "sold", label: "Sold" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "expired", label: "Expired" },
];

export default function Listings() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 250);
  const [status, setStatus] = useState<ListingStatus | "">("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Listing | undefined>();
  const [formOpen, setFormOpen] = useState(false);

  // See the note in Contacts.tsx: gate on `data`, not `isPending`.
  const { data, isError, error } = useListings({
    q: debouncedSearch,
    status,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  const openEdit = (listing: Listing) => {
    setEditing(listing);
    setFormOpen(true);
  };

  return (
    <PageStack>
      <Group justify="space-between">
        <Title order={2}>Listings</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
          New listing
        </Button>
      </Group>

      <Card withBorder padding="sm">
        <Group>
          <TextInput
            flex={1}
            placeholder="Search address, city, ZIP, MLS #…"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              setPage(1);
            }}
          />
          <Select
            placeholder="Any status"
            clearable
            data={STATUS_FILTER}
            value={status || null}
            onChange={(value) => {
              setStatus((value ?? "") as ListingStatus | "");
              setPage(1);
            }}
          />
        </Group>
      </Card>

      {isError && (
        <Alert color="red" title="Couldn't load listings">
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
            <Text fw={600}>No listings yet</Text>
            <Text c="dimmed" size="sm">
              Add a property to start tracking it.
            </Text>
            <Button variant="light" onClick={openCreate} mt="xs">
              New listing
            </Button>
          </Stack>
        </Card>
      ) : (
        <Card withBorder padding={0}>
          <Table.ScrollContainer minWidth={860}>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Address</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Price</Table.Th>
                  <Table.Th>Bd/Ba</Table.Th>
                  <Table.Th>Sq ft</Table.Th>
                  <Table.Th>Seller</Table.Th>
                  <Table.Th>Listed</Table.Th>
                  <Table.Th w={60} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.results.map((listing) => (
                  <Table.Tr key={listing.id}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {listing.addressLine1}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {listing.city}, {listing.state} {listing.postalCode}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        variant="light"
                        color={LISTING_STATUS_COLORS[listing.status] ?? "gray"}
                      >
                        {humanize(listing.status)}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{formatPriceCents(listing.listPriceCents)}</Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {listing.bedrooms ?? "—"} / {listing.bathrooms ?? "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {listing.livingAreaSqft?.toLocaleString() ?? "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {listing.seller
                          ? `${listing.seller.firstName} ${listing.seller.lastName}`
                          : "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatDate(listing.listedOn)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon
                        variant="subtle"
                        aria-label={`Edit ${listing.addressLine1}`}
                        onClick={() => openEdit(listing)}
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}

      {data && data.total > PAGE_SIZE && (
        <Group justify="center">
          <Pagination
            value={page}
            onChange={setPage}
            total={Math.ceil(data.total / PAGE_SIZE)}
          />
        </Group>
      )}

      <ListingFormModal
        key={editing?.id ?? "new"}
        opened={formOpen}
        onClose={() => setFormOpen(false)}
        listing={editing}
      />
    </PageStack>
  );
}
