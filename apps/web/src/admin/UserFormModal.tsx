import { Button, Group, Modal, PasswordInput, Select, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { ApiError } from "../api/client";
import type { AdminUser } from "../api/types";
import { useCreateUser, useUpdateUser } from "./queries";

const ROLE_OPTIONS: { value: AdminUser["role"]; label: string }[] = [
  { value: "user", label: "User" },
  { value: "admin", label: "Admin — can manage users" },
];

// Mirrors MIN/MAX_PASSWORD_LENGTH in server/password.ts. Checked here only so
// the mistake is caught before a round trip; the server is the authority.
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

// Error codes from server/routes/admin.routes.ts that aren't tied to one field.
const ERROR_MESSAGES: Record<string, string> = {
  cannot_change_own_access:
    "You can't change your own role or disable yourself. Ask another admin.",
  forbidden: "Your account no longer has admin access.",
  user_not_found: "That account no longer exists.",
};

interface Props {
  opened: boolean;
  onClose: () => void;
  /** Present = edit, absent = create. One form serves both. */
  user?: AdminUser;
  /** Editing your own account: the role control is locked. */
  isSelf: boolean;
}

export default function UserFormModal({ opened, onClose, user, isSelf }: Props) {
  const create = useCreateUser();
  const update = useUpdateUser();
  const isEdit = Boolean(user);

  const form = useForm({
    // Remounted per target via the `key` at the call site, which is what
    // reloads these — useForm only reads initialValues on mount.
    initialValues: {
      email: user?.email ?? "",
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      role: user?.role ?? ("user" as AdminUser["role"]),
      password: "",
    },
    validate: {
      email: (value) =>
        isEdit || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
          ? null
          : "Enter a valid email address",
      firstName: (value) => (value.trim() ? null : "First name is required"),
      lastName: (value) => (value.trim() ? null : "Last name is required"),
      // Blank is always valid: on create it means "Google only", on edit it
      // means "leave the password alone".
      password: (value) =>
        !value || (value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH)
          ? null
          : `Use ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters`,
    },
  });

  const handleSubmit = form.onSubmit(async (values) => {
    const names = { firstName: values.firstName.trim(), lastName: values.lastName.trim() };
    // Sent only when typed. An empty string must not reach the API as a
    // password, and on edit its absence is what means "unchanged".
    const password = values.password ? { password: values.password } : {};

    try {
      if (user) {
        await update.mutateAsync({
          id: user.id,
          ...names,
          // Left out for yourself: the server rejects any change to your own
          // access, and sending the unchanged value just to have it ignored
          // would make that rule look like it's being tested on every save.
          ...(isSelf ? {} : { role: values.role }),
          ...password,
        });
      } else {
        await create.mutateAsync({
          email: values.email.trim(),
          ...names,
          role: values.role,
          ...password,
        });
      }
      notifications.show({
        message: user ? "User updated" : "User created",
        color: "green",
      });
      form.reset();
      onClose();
    } catch (error) {
      // Field-level problems (a taken email, a weak password) go on the fields.
      if (error instanceof ApiError && error.details) {
        form.setErrors(error.details);
        return;
      }
      notifications.show({
        title: "Save failed",
        message:
          error instanceof ApiError
            ? (ERROR_MESSAGES[error.code] ?? error.code)
            : "Unexpected error",
        color: "red",
      });
    }
  });

  return (
    <Modal opened={opened} onClose={onClose} title={isEdit ? "Edit user" : "New user"}>
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <TextInput
            label="Email"
            type="email"
            withAsterisk={!isEdit}
            // Fixed after creation: it is what a Google sign-in is matched to
            // the account by, so editing it would hand the account to whoever
            // owns the new address.
            disabled={isEdit}
            description={
              isEdit ? "An account's email can't be changed." : "What they'll sign in with."
            }
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            {...form.getInputProps("email")}
          />
          <Group grow align="flex-start">
            <TextInput label="First name" withAsterisk {...form.getInputProps("firstName")} />
            <TextInput label="Last name" withAsterisk {...form.getInputProps("lastName")} />
          </Group>
          <Select
            label="Role"
            data={ROLE_OPTIONS}
            allowDeselect={false}
            disabled={isSelf}
            description={isSelf ? "You can't change your own role." : undefined}
            {...form.getInputProps("role")}
          />
          <PasswordInput
            label={isEdit ? "New password" : "Temporary password"}
            description={
              isEdit
                ? "Leave blank to keep the current one. Setting one signs them out everywhere."
                : "Share it with them yourself. Leave blank if they'll only sign in with Google."
            }
            // Stops the browser from offering to fill in the ADMIN'S own saved
            // password here, which is what it does with a bare password field.
            autoComplete="new-password"
            {...form.getInputProps("password")}
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending || update.isPending}>
              {isEdit ? "Save" : "Create user"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
