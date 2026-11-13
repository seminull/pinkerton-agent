import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { Link, useParams } from "react-router";
import { CONTACT_STAGE_COLORS, LISTING_STATUS_COLORS } from "../theme";
import { formatDate, formatPriceCents, humanize } from "../format";
import PageStack from "../motion/PageStack";
import { useContact } from "./queries";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="sm">{value}</Text>
    </Stack>
  );
}

export default function ContactDetail() {
  const { contactId } = useParams();
  const { data, isPending, isError, error } = useContact(contactId);

  if (isPending) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    );
  }

  if (isError) {
    return (
      <Stack>
        <Button
          component={Link}
          to="/contacts"
          variant="subtle"
          leftSection={<IconArrowLeft size={16} />}
          w="fit-content"
        >
          Contacts
        </Button>
        <Alert color="red" title="Couldn't load contact">
          {error instanceof Error ? error.message : "Unknown error"}
        </Alert>
      </Stack>
    );
  }

  const { contact } = data;

  return (
    <PageStack>
      <Button
        component={Link}
        to="/contacts"
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        w="fit-content"
      >
        Contacts
      </Button>

      <Group justify="space-between" align="flex-start">
        <Group gap="sm">
          <Title order={2}>
            {contact.firstName} {contact.lastName}
          </Title>
          <Badge
            variant="light"
            color={CONTACT_STAGE_COLORS[contact.stage] ?? "gray"}
          >
            {humanize(contact.stage)}
          </Badge>
        </Group>
      </Group>

      <Card withBorder padding="lg">
        <Grid>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <Field label="Type" value={humanize(contact.type)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <Field label="Email" value={contact.email ?? "—"} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <Field label="Phone" value={contact.phone ?? "—"} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <Field label="Source" value={contact.source ?? "—"} />
          </Grid.Col>
          <Grid.Col span={12}>
            <Field label="Added" value={formatDate(contact.createdAt)} />
          </Grid.Col>
          {contact.notes && (
            <Grid.Col span={12}>
              <Field label="Notes" value={contact.notes} />
            </Grid.Col>
          )}
        </Grid>
      </Card>

      <Title order={4}>Listings</Title>
      {contact.listings && contact.listings.length > 0 ? (
        <Card withBorder padding={0}>
          <Table.ScrollContainer minWidth={600}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Address</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Price</Table.Th>
                  <Table.Th>Listed</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {contact.listings.map((listing) => (
                  <Table.Tr key={listing.id}>
                    <Table.Td>
                      <Anchor component={Link} to={`/listings/${listing.id}`}>
                        {listing.addressLine1}, {listing.city} {listing.state}
                      </Anchor>
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
                    <Table.Td>{formatDate(listing.listedOn)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      ) : (
        <Text c="dimmed" size="sm">
          No listings for this contact.
        </Text>
      )}
    </PageStack>
  );
}
