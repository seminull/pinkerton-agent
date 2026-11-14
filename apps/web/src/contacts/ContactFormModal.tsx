import {
  Button,
  Group,
  Modal,
  PhoneInput,
  Select,
  Stack,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { ApiError } from "../api/client";
import type { Contact, ContactStage, ContactType } from "../api/types";
import { isContactPhoneValid } from "../phone";
import { useCreateContact, useUpdateContact, type ContactInput } from "./queries";

const TYPE_OPTIONS: { value: ContactType; label: string }[] = [
  { value: "buyer", label: "Buyer" },
  { value: "seller", label: "Seller" },
  { value: "both", label: "Both" },
];

const STAGE_OPTIONS: { value: ContactStage; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
  { value: "lost", label: "Lost" },
];

interface Props {
  opened: boolean;
  onClose: () => void;
  /** Present = edit, absent = create. One form serves both. */
  contact?: Contact;
}

export default function ContactFormModal({ opened, onClose, contact }: Props) {
  const create = useCreateContact();
  const update = useUpdateContact();
  const isEdit = Boolean(contact);

  const form = useForm({
    // Mantine keeps uncontrolled inputs in sync from this, so remounting the
    // modal per-contact (via the `key` at the call site) is what loads values
    // for an edit.
    initialValues: {
      firstName: contact?.firstName ?? "",
      lastName: contact?.lastName ?? "",
      email: contact?.email ?? "",
      phone: contact?.phone ?? "",
      type: contact?.type ?? ("buyer" as ContactType),
      stage: contact?.stage ?? ("new" as ContactStage),
      source: contact?.source ?? "",
      notes: contact?.notes ?? "",
    },
    validate: {
      firstName: (value) => (value.trim() ? null : "First name is required"),
      lastName: (value) => (value.trim() ? null : "Last name is required"),
      // Loose on purpose. A strict pattern rejects real addresses, and the
      // field is optional anyway — the API is the authority.
      email: (value) =>
        !value || value.includes("@") ? null : "Doesn't look like an email address",
      phone: (value) =>
        isContactPhoneValid(value) ? null : "Enter a valid phone number",
    },
  });

  const handleSubmit = form.onSubmit(async (values) => {
    // Empty strings are how a cleared optional field arrives from the inputs;
    // send null so the column ends up NULL rather than "".
    const payload: ContactInput = {
      ...values,
      email: values.email || null,
      phone: values.phone || null,
      source: values.source || null,
      notes: values.notes || null,
    };

    try {
      if (contact) {
        await update.mutateAsync({ id: contact.id, ...payload });
      } else {
        await create.mutateAsync(payload);
      }
      notifications.show({
        message: contact ? "Contact updated" : "Contact created",
        color: "green",
      });
      form.reset();
      onClose();
    } catch (error) {
      notifications.show({
        title: "Save failed",
        message: error instanceof ApiError ? error.code : "Unexpected error",
        color: "red",
      });
    }
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isEdit ? "Edit contact" : "New contact"}
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <Group grow>
            <TextInput
              label="First name"
              withAsterisk
              {...form.getInputProps("firstName")}
            />
            <TextInput
              label="Last name"
              withAsterisk
              {...form.getInputProps("lastName")}
            />
          </Group>
          <Group grow>
            <TextInput label="Email" {...form.getInputProps("email")} />
            <PhoneInput
              label="Phone"
              defaultCountry="us"
              preferredCountries={["us", "ca", "mx"]}
              withCountryAutoDetect
              withChevron
              {...form.getInputProps("phone")}
            />
          </Group>
          <Group grow>
            <Select
              label="Type"
              data={TYPE_OPTIONS}
              allowDeselect={false}
              {...form.getInputProps("type")}
            />
            <Select
              label="Stage"
              data={STAGE_OPTIONS}
              allowDeselect={false}
              {...form.getInputProps("stage")}
            />
          </Group>
          <TextInput
            label="Source"
            placeholder="Referral, Zillow, open house…"
            {...form.getInputProps("source")}
          />
          <Textarea
            label="Notes"
            autosize
            minRows={2}
            {...form.getInputProps("notes")}
          />
          <Group justify="flex-end" mt="sm">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending || update.isPending}>
              {isEdit ? "Save" : "Create"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
