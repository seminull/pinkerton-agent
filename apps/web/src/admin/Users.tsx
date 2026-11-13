import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Menu,
  Pagination,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconDots,
  IconLock,
  IconLockOpen,
  IconLogout,
  IconPencil,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";
import { ApiError } from "../api/client";
import type { AdminUser } from "../api/types";
import { useAuth } from "../auth/authContext";
import { formatDate } from "../format";
import PageStack from "../motion/PageStack";
import { useAdminUsers, useRevokeSessions, useUpdateUser } from "./queries";
import UserFormModal from "./UserFormModal";

const PAGE_SIZE = 25;

// How each account can get in, as short labels. An account with neither a
// password nor a linked provider isn't broken — it is waiting for its first
// Google sign-in — so it gets a label that says so rather than an empty cell.
const signInMethods = (user: AdminUser): string[] => {
  const methods = [
    ...(user.hasPassword ? ["Password"] : []),
    ...user.providers.map((provider) => provider.charAt(0).toUpperCase() + provider.slice(1)),
  ];
  return methods.length > 0 ? methods : ["Google (not yet used)"];
};

export default function Users() {
  const { user: me } = useAuth();
  const isAdmin = me?.role === "admin";

  const [search, setSearch] = useState("");
  // Debounced so typing doesn't fire a request per keystroke.
  const [debouncedSearch] = useDebouncedValue(search, 250);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AdminUser | undefined>();
  const [formOpen, setFormOpen] = useState(false);

  const { data, isError, error } = useAdminUsers(
    { q: debouncedSearch, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
    isAdmin
  );
  const update = useUpdateUser();
  const revoke = useRevokeSessions();

  // The nav link is hidden from non-admins, but a URL can still be typed. This
  // is courtesy, not security: the API answers 403 regardless of what renders.
  if (!isAdmin) {
    return (
      <Alert color="yellow" title="Admins only">
        Your account doesn&apos;t have access to user management.
      </Alert>
    );
  }

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  const openEdit = (user: AdminUser) => {
    setEditing(user);
    setFormOpen(true);
  };

  const fail = (title: string) => (err: unknown) =>
    notifications.show({
      title,
      message: err instanceof ApiError ? err.code : "Unexpected error",
      color: "red",
    });

  const setStatus = (user: AdminUser, status: AdminUser["status"]) =>
    update
      .mutateAsync({ id: user.id, status })
      .then(() =>
        notifications.show({
          message:
            status === "disabled"
              ? `${user.email} disabled and signed out`
              : `${user.email} re-enabled`,
          color: "green",
        })
      )
      .catch(fail("Couldn't update the account"));

  const signOutEverywhere = (user: AdminUser) =>
    revoke
      .mutateAsync(user.id)
      .then(({ revoked }) =>
        notifications.show({
          message:
            revoked === 0
              ? `${user.email} had no other active sessions`
              : `Ended ${revoked} session${revoked === 1 ? "" : "s"} for ${user.email}`,
          color: "green",
        })
      )
      .catch(fail("Couldn't sign them out"));

  return (
    <PageStack>
      <Group justify="space-between">
        <Title order={2}>Users</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
          New user
        </Button>
      </Group>

      <Card withBorder padding="sm">
        <TextInput
          placeholder="Search name or email…"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            // Page 3 of the old result set means nothing against the new one.
            setPage(1);
          }}
        />
      </Card>

      {isError && (
        <Alert color="red" title="Couldn't load users">
          {error instanceof Error ? error.message : "Unknown error"}
        </Alert>
      )}

      {!data ? (
        // Don't spin forever beside an error that already explains itself.
        !isError && (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        )
      ) : data.results.length === 0 ? (
        <Card withBorder padding="xl">
          <Text c="dimmed" ta="center" size="sm">
            No users match that search.
          </Text>
        </Card>
      ) : (
        <Card withBorder padding={0}>
          <Table.ScrollContainer minWidth={760}>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Email</Table.Th>
                  <Table.Th>Role</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Signs in with</Table.Th>
                  <Table.Th>Last sign-in</Table.Th>
                  <Table.Th w={60} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.results.map((user) => {
                  const isSelf = user.id === me.id;
                  return (
                    <Table.Tr key={user.id}>
                      <Table.Td>
                        <Group gap="sm" wrap="nowrap">
                          <Avatar src={user.avatarUrl} size="sm" radius="xl" color="rose">
                            {(user.firstName[0] ?? user.email[0] ?? "").toUpperCase()}
                          </Avatar>
                          <Text size="sm">
                            {`${user.firstName} ${user.lastName}`.trim()}
                          </Text>
                          {isSelf && (
                            <Badge variant="outline" size="xs">
                              You
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{user.email}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="light" color={user.role === "admin" ? "rose" : "gray"}>
                          {user.role === "admin" ? "Admin" : "User"}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          variant="light"
                          color={user.status === "active" ? "green" : "red"}
                        >
                          {user.status === "active" ? "Active" : "Disabled"}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {signInMethods(user).join(", ")}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {user.lastLoginAt ? formatDate(user.lastLoginAt) : "Never"}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Menu position="bottom-end" withArrow>
                          <Menu.Target>
                            <ActionIcon variant="subtle" aria-label={`Actions for ${user.email}`}>
                              <IconDots size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item
                              leftSection={<IconPencil size={16} />}
                              onClick={() => openEdit(user)}
                            >
                              Edit
                            </Menu.Item>
                            <Menu.Item
                              leftSection={<IconLogout size={16} />}
                              onClick={() => signOutEverywhere(user)}
                            >
                              {isSelf ? "Sign out my other devices" : "Sign out everywhere"}
                            </Menu.Item>
                            {/* Not offered on your own row: the server refuses
                                it (an admin can't lock themselves out), and a
                                button that always fails is worse than none. */}
                            {!isSelf &&
                              (user.status === "active" ? (
                                <Menu.Item
                                  color="red"
                                  leftSection={<IconLock size={16} />}
                                  onClick={() => setStatus(user, "disabled")}
                                >
                                  Disable account
                                </Menu.Item>
                              ) : (
                                <Menu.Item
                                  leftSection={<IconLockOpen size={16} />}
                                  onClick={() => setStatus(user, "active")}
                                >
                                  Re-enable account
                                </Menu.Item>
                              ))}
                          </Menu.Dropdown>
                        </Menu>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
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

      <UserFormModal
        // Remounts the form when the target changes, which is what reloads
        // initialValues — Mantine's useForm only reads them on mount.
        key={editing?.id ?? "new"}
        opened={formOpen}
        onClose={() => setFormOpen(false)}
        user={editing}
        isSelf={editing?.id === me.id}
      />
    </PageStack>
  );
}
