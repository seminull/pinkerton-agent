import { useState, type ChangeEvent } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAddressBook, IconUpload } from "@tabler/icons-react";
import { ApiError } from "../api/client";
import { parseMatrixCsv, type MatrixCsvContact } from "./matrixCsv";
import { useImportContacts } from "./queries";

interface Props {
  opened: boolean;
  onClose: () => void;
  onImported: () => void;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_CONTACTS = 2000;

export default function ImportMatrixCsvModal({
  opened,
  onClose,
  onImported,
}: Props) {
  const importContacts = useImportContacts();
  const [contacts, setContacts] = useState<MatrixCsvContact[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);

  const reset = () => {
    setContacts([]);
    setSelected(new Set());
    setFileName("");
    setParseError(null);
    setSkipped(0);
    importContacts.reset();
  };

  const close = () => {
    if (importContacts.isPending) return;
    reset();
    onClose();
  };

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    setContacts([]);
    setSelected(new Set());
    setParseError(null);
    setSkipped(0);
    setFileName(file.name);

    if (file.size > MAX_FILE_BYTES) {
      setParseError("That file is larger than 10 MB.");
      return;
    }

    try {
      const parsed = parseMatrixCsv(await file.text());
      if (parsed.contacts.length === 0) {
        setSkipped(parsed.skipped);
        setParseError(
          parsed.skipped > 0
            ? "No rows had both a first and last name."
            : "That Matrix CSV does not contain any contacts."
        );
        return;
      }
      if (parsed.contacts.length > MAX_IMPORT_CONTACTS) {
        setParseError(
          `This file contains more than ${MAX_IMPORT_CONTACTS.toLocaleString()} contacts. Export a smaller list and try again.`
        );
        return;
      }

      setContacts(parsed.contacts);
      setSelected(new Set(parsed.contacts.map((_, index) => index)));
      setSkipped(parsed.skipped);
    } catch (error) {
      setParseError(
        error instanceof Error ? error.message : "The Matrix CSV could not be read."
      );
    }
  };

  const toggle = (index: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((current) =>
      current.size === contacts.length
        ? new Set()
        : new Set(contacts.map((_, index) => index))
    );
  };

  const submit = async () => {
    const chosen = contacts.filter((_, index) => selected.has(index));
    if (chosen.length === 0) return;

    try {
      const result = await importContacts.mutateAsync({
        contacts: chosen,
        source: "Matrix CSV",
      });
      const duplicateMessage =
        result.duplicates > 0
          ? ` ${result.duplicates.toLocaleString()} already existed and ${result.duplicates === 1 ? "was" : "were"} skipped.`
          : "";
      notifications.show({
        title: "Matrix import complete",
        message: `${result.imported.toLocaleString()} contact${result.imported === 1 ? "" : "s"} imported.${duplicateMessage}`,
        color: result.imported > 0 ? "green" : "yellow",
      });
      onImported();
      reset();
      onClose();
    } catch (error) {
      notifications.show({
        title: "Import failed",
        message: error instanceof ApiError ? error.code.replace(/_/g, " ") : "Unexpected error",
        color: "red",
      });
    }
  };

  const allSelected = contacts.length > 0 && selected.size === contacts.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <Modal opened={opened} onClose={close} title="Import Matrix CSV" size="xl">
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Choose a contacts CSV exported by NTREIS Matrix, review the rows, and
          import the contacts you want. Re-importing the same file will skip
          contacts already in the CRM.
        </Text>

        <Group>
          <Button
            component="label"
            variant={contacts.length > 0 ? "light" : "filled"}
            leftSection={<IconUpload size={16} />}
            disabled={importContacts.isPending}
          >
            {contacts.length > 0 ? "Choose another file" : "Choose Matrix CSV"}
            <input hidden type="file" accept=".csv,text/csv" onChange={readFile} />
          </Button>
          {fileName && (
            <Text size="sm" c="dimmed">
              {fileName}
            </Text>
          )}
        </Group>

        {parseError && (
          <Alert color="red" title="Couldn’t read contacts">
            {parseError}
          </Alert>
        )}

        {skipped > 0 && contacts.length > 0 && (
          <Alert color="yellow" title="Some rows weren’t included">
            {skipped.toLocaleString()} row{skipped === 1 ? " did" : "s did"} not
            have both a first and last name.
          </Alert>
        )}

        {contacts.length > 0 && (
          <>
            <Group justify="space-between">
              <Group gap="xs">
                <IconAddressBook size={18} />
                <Text fw={600} size="sm">
                  {selected.size.toLocaleString()} of {contacts.length.toLocaleString()} selected
                </Text>
              </Group>
              <Button variant="subtle" size="compact-sm" onClick={toggleAll}>
                {allSelected ? "Clear all" : "Select all"}
              </Button>
            </Group>

            <ScrollArea h={360} type="auto">
              <Table striped highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={42}>
                      <Checkbox
                        aria-label="Select all contacts"
                        checked={allSelected}
                        indeterminate={someSelected}
                        onChange={toggleAll}
                      />
                    </Table.Th>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Email</Table.Th>
                    <Table.Th>Phone</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {contacts.map((contact, index) => (
                    <Table.Tr key={`${index}-${contact.firstName}-${contact.lastName}`}>
                      <Table.Td>
                        <Checkbox
                          aria-label={`Select ${contact.firstName} ${contact.lastName}`}
                          checked={selected.has(index)}
                          onChange={() => toggle(index)}
                        />
                      </Table.Td>
                      <Table.Td>
                        {contact.firstName} {contact.lastName}
                      </Table.Td>
                      <Table.Td>{contact.email ?? "—"}</Table.Td>
                      <Table.Td>{contact.phone ?? "—"}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </>
        )}

        <Group justify="flex-end">
          <Button variant="subtle" onClick={close} disabled={importContacts.isPending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={importContacts.isPending}
            disabled={selected.size === 0}
          >
            Import {selected.size > 0 ? selected.size.toLocaleString() : ""}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
