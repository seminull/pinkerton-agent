import {
  AppShell,
  Avatar,
  Burger,
  Divider,
  Group,
  Menu,
  NavLink,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAddressBook,
  IconHome,
  IconLayoutDashboard,
  IconLogout,
  IconUsers,
} from "@tabler/icons-react";
import { Link, Outlet, useLocation } from "react-router";
import { useAuth } from "../auth/authContext";
import { BrandMark } from "../brand/Brand";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: IconLayoutDashboard },
  { to: "/contacts", label: "Contacts", icon: IconAddressBook },
  { to: "/listings", label: "Listings", icon: IconHome },
];

export default function RootLayout() {
  // One disclosure drives the mobile burger; on desktop the navbar is always
  // open, so `desktop: false` keeps it pinned regardless of this state.
  const [opened, { toggle }] = useDisclosure();
  const { pathname } = useLocation();
  const { user, logout } = useAuth();

  const signOut = () => {
    // If the request fails the session is still live on the server, so stay
    // signed in and say so — pretending it worked would leave an open session
    // on a computer the agent believes they've signed out of.
    logout().catch(() =>
      notifications.show({
        color: "red",
        title: "Couldn't sign out",
        message: "The server didn't respond. Please try again.",
      })
    );
  };

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: 220,
        breakpoint: "sm",
        collapsed: { mobile: !opened, desktop: false },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <BrandMark h={30} />
          <Title order={4}>Pinkerton Agent</Title>
          <Text size="xs" c="dimmed">
            CRM
          </Text>

          {/* AuthGate only renders this layout with a user, but the type is
              nullable and a guard is cheaper than a non-null assertion. */}
          {user && (
            <Menu position="bottom-end" withArrow>
              <Menu.Target>
                <UnstyledButton ml="auto" aria-label="Account menu">
                  <Group gap="xs">
                    <Avatar src={user.avatarUrl} size="sm" radius="xl" color="rose">
                      {(user.firstName[0] ?? user.email[0] ?? "").toUpperCase()}
                    </Avatar>
                    <Text size="sm" visibleFrom="sm">
                      {`${user.firstName} ${user.lastName}`.trim()}
                    </Text>
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{user.email}</Menu.Label>
                <Menu.Item leftSection={<IconLogout size={16} />} onClick={signOut}>
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            component={Link}
            to={to}
            label={label}
            leftSection={<Icon size={18} stroke={1.5} />}
            // Exact match for "/" only — otherwise the Dashboard link would
            // stay highlighted on every page.
            active={to === "/" ? pathname === "/" : pathname.startsWith(to)}
            onClick={() => opened && toggle()}
          />
        ))}

        {/* Shown only to admins. Hiding it is tidiness, not protection — the
            page and the API each check the role themselves. */}
        {user?.role === "admin" && (
          <>
            <Divider my="xs" label="Admin" labelPosition="left" />
            <NavLink
              component={Link}
              to="/admin/users"
              label="Users"
              leftSection={<IconUsers size={18} stroke={1.5} />}
              active={pathname.startsWith("/admin/users")}
              onClick={() => opened && toggle()}
            />
          </>
        )}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
