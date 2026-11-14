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
  IconDownload,
  IconFileImport,
  IconPencil,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";
import { Link } from "react-router";
import type { Contact, ContactStage, ContactType } from "../api/types";
import { CONTACT_STAGE_COLORS } from "../theme";
import { humanize } from "../format";
import PageStack from "../motion/PageStack";
import { formatContactPhone } from "../phone";
import ContactFormModal from "./ContactFormModal";
import ImportContactsModal from "./ImportContactsModal";
import ImportMatrixCsvModal from "./ImportMatrixCsvModal";
import { useContacts } from "./queries";

const PAGE_SIZE = 25;

const STAGE_FILTER = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
  { value: "lost", label: "Lost" },
];

const TYPE_FILTER = [
  { value: "buyer", label: "Buyer" },
  { value: "seller", label: "Seller" },
  { value: "both", label: "Both" },
];

export default function Contacts() {
  const [search, setSearch] = useState("");
  // Debounced so typing doesn't fire a request per keystroke.
  const [debouncedSearch] = useDebouncedValue(search, 250);
  const [stage, setStage] = useState<ContactStage | "">("");
  const [type, setType] = useState<ContactType | "">("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Contact | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [matrixImportOpen, setMatrixImportOpen] = useState(false);

  // Gate the table on `data` rather than `isPending`: TanStack's result is a
  // discriminated union, and destructuring the flags into separate consts
  // breaks the narrowing that would otherwise prove `data` is defined here.
  const { data, isError, error } = useContacts({
    q: debouncedSearch,
    stage,
    type,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  const openEdit = (contact: Contact) => {
    setEditing(contact);
    setFormOpen(true);
  };

  return (
    <PageStack>
      <Group justify="space-between">
        <Title order={2}>Contacts</Title>
        <Group gap="sm">
          <Button
            component="a"
            href="/api/contacts/export.csv"
            download
            variant="light"
            leftSection={<IconDownload size={16} />}
          >
            Export CSV
          </Button>
          <Button
            variant="light"
            leftSection={<IconFileImport size={16} />}
            onClick={() => setMatrixImportOpen(true)}
          >
            Import Matrix CSV
          </Button>
          <Button
            variant="light"
            leftSection={<IconFileImport size={16} />}
            onClick={() => setImportOpen(true)}
          >
            Import contacts
          </Button>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            New contact
          </Button>
        </Group>
      </Group>

      <Card withBorder padding="sm">
        <Group>
          <TextInput
            flex={1}
            placeholder="Search name, email, phone…"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              // A new filter invalidates the current page number — page 4 of
              // the old result set is meaningless against the new one.
              setPage(1);
            }}
          />
          <Select
            placeholder="Any stage"
            clearable
            data={STAGE_FILTER}
            value={stage || null}
            onChange={(value) => {
              setStage((value ?? "") as ContactStage | "");
              setPage(1);
            }}
          />
          <Select
            placeholder="Any type"
            clearable
            data={TYPE_FILTER}
            value={type || null}
            onChange={(value) => {
              setType((value ?? "") as ContactType | "");
              setPage(1);
            }}
          />
        </Group>
      </Card>

      {isError && (
        <Alert color="red" title="Couldn't load contacts">
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
            <Text fw={600}>No contacts yet</Text>
            <Text c="dimmed" size="sm">
              Add your first lead to get started.
            </Text>
            <Button variant="light" onClick={openCreate} mt="xs">
              New contact
            </Button>
          </Stack>
        </Card>
      ) : (
        <Card withBorder padding={0}>
          <Table.ScrollContainer minWidth={720}>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Stage</Table.Th>
                  <Table.Th>Email</Table.Th>
                  <Table.Th>Phone</Table.Th>
                  <Table.Th>Source</Table.Th>
                  <Table.Th w={60} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.results.map((contact) => (
                  <Table.Tr key={contact.id}>
                    <Table.Td>
                      <Anchor component={Link} to={`/contacts/${contact.id}`}>
                        {contact.firstName} {contact.lastName}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{humanize(contact.type)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        variant="light"
                        color={CONTACT_STAGE_COLORS[contact.stage] ?? "gray"}
                      >
                        {humanize(contact.stage)}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{contact.email ?? "—"}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatContactPhone(contact.phone)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {contact.source ?? "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon
                        variant="subtle"
                        aria-label={`Edit ${contact.firstName} ${contact.lastName}`}
                        onClick={() => openEdit(contact)}
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

      <ContactFormModal
        // Remounts the form when the target changes, which is what reloads
        // initialValues — Mantine's useForm only reads them on mount.
        key={editing?.id ?? "new"}
        opened={formOpen}
        onClose={() => setFormOpen(false)}
        contact={editing}
      />
      <ImportContactsModal
        opened={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => setPage(1)}
      />
      <ImportMatrixCsvModal
        opened={matrixImportOpen}
        onClose={() => setMatrixImportOpen(false)}
        onImported={() => setPage(1)}
      />
    </PageStack>
  );
}
