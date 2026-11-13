import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
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
import {
  IconEye,
  IconLink,
  IconPencil,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";
import { Link } from "react-router";
import type { Listing, ListingLookup, ListingStatus } from "../api/types";
import { LISTING_STATUS_COLORS } from "../theme";
import { formatDate, formatPriceCents, humanize } from "../format";
import PageStack from "../motion/PageStack";
import AddWithUrlModal from "./AddWithUrlModal";
import ListingFormModal from "./ListingFormModal";
import ResolveMatrixDuplicateModal, {
  type MatrixResolution,
  type MatrixResolutionMode,
} from "./ResolveMatrixDuplicateModal";
import { useListings, type ListingUrlLookupResult } from "./queries";

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
  const [urlOpen, setUrlOpen] = useState(false);
  const [lookup, setLookup] = useState<ListingLookup | undefined>();
  const [matrixConflict, setMatrixConflict] = useState<ListingUrlLookupResult | null>(null);
  const [matrixMode, setMatrixMode] = useState<MatrixResolutionMode | undefined>();
  const [replaceMatrixPhotos, setReplaceMatrixPhotos] = useState(false);

  // See the note in Contacts.tsx: gate on `data`, not `isPending`.
  const { data, isError, error } = useListings({
    q: debouncedSearch,
    status,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const openCreate = () => {
    setEditing(undefined);
    // A plain "New listing" must not inherit the last lookup's draft.
    setLookup(undefined);
    setMatrixMode(undefined);
    setReplaceMatrixPhotos(false);
    setFormOpen(true);
  };

  // The lookup came back: close the link dialog and open the ordinary
  // new-listing form on its draft. Nothing has been saved yet.
  const openFromLookup = (result: ListingLookup) => {
    setUrlOpen(false);
    setEditing(undefined);
    setLookup(result);
    setMatrixMode(undefined);
    setReplaceMatrixPhotos(false);
    setFormOpen(true);
  };

  const handleUrlLookup = (result: ListingUrlLookupResult) => {
    setUrlOpen(false);
    if (result.existingListing) {
      setMatrixConflict(result);
      return;
    }
    openFromLookup(result.lookup);
  };

  const resolveMatrixConflict = (resolution: MatrixResolution) => {
    if (!matrixConflict) return;
    setMatrixConflict(null);
    setEditing(resolution.initialListing);
    setLookup(matrixConflict.lookup);
    setMatrixMode(resolution.mode);
    setReplaceMatrixPhotos(resolution.replacePhotos);
    setFormOpen(true);
  };

  const openEdit = (listing: Listing) => {
    setEditing(listing);
    setLookup(undefined);
    setMatrixMode(undefined);
    setReplaceMatrixPhotos(false);
    setFormOpen(true);
  };

  return (
    <PageStack>
      <Group justify="space-between">
        <Title order={2}>Listings</Title>
        <Group gap="sm">
          <Button
            variant="light"
            leftSection={<IconLink size={16} />}
            onClick={() => setUrlOpen(true)}
          >
            Add with URL
          </Button>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            New listing
          </Button>
        </Group>
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
                  <Table.Th w={92} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.results.map((listing) => (
                  <Table.Tr key={listing.id}>
                    <Table.Td>
                      <Anchor component={Link} to={`/listings/${listing.id}`} size="sm" fw={500}>
                        {listing.addressLine1}
                      </Anchor>
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
                    <Table.Td>
                      {formatPriceCents(listing.listPriceCents)}
                      {listing.listingType === "lease" && listing.listPriceCents !== null
                        ? " / mo"
                        : ""}
                    </Table.Td>
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
                      <Group gap={2} wrap="nowrap">
                        <ActionIcon
                          component={Link}
                          to={`/listings/${listing.id}`}
                          variant="subtle"
                          aria-label={`View ${listing.addressLine1}`}
                        >
                          <IconEye size={16} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          aria-label={`Edit ${listing.addressLine1}`}
                          onClick={() => openEdit(listing)}
                        >
                          <IconPencil size={16} />
                        </ActionIcon>
                      </Group>
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
        // Remounted per target so the form reloads its initial values — and a
        // lookup gets its own key, or a second lookup would open on the first
        // one's draft.
        key={
          matrixMode
            ? `${matrixMode}-${editing?.id ?? "new"}-${lookup?.sourceUrl ?? ""}`
            : editing?.id ?? (lookup ? `lookup-${lookup.sourceUrl}` : "new")
        }
        opened={formOpen}
        onClose={() => setFormOpen(false)}
        listing={editing}
        lookup={lookup}
        matrixMode={matrixMode}
        replaceMatrixPhotos={replaceMatrixPhotos}
      />
      <AddWithUrlModal
        opened={urlOpen}
        onClose={() => setUrlOpen(false)}
        onResult={handleUrlLookup}
      />
      {matrixConflict?.existingListing && (
        <ResolveMatrixDuplicateModal
          key={`${matrixConflict.existingListing.id}-${matrixConflict.lookup.sourceUrl}`}
          opened
          onClose={() => setMatrixConflict(null)}
          result={matrixConflict}
          onResolve={resolveMatrixConflict}
        />
      )}
    </PageStack>
  );
}
