import { AppShell, Burger, Group, NavLink, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAddressBook,
  IconFlask,
  IconHome,
  IconLayoutDashboard,
} from "@tabler/icons-react";
import { Link, Outlet, useLocation } from "react-router";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: IconLayoutDashboard },
  { to: "/contacts", label: "Contacts", icon: IconAddressBook },
  { to: "/listings", label: "Listings", icon: IconHome },
  // Scratch space for integrations that aren't product yet. Last in the list so
  // it reads as the workbench it is rather than as a feature.
  { to: "/test", label: "Test", icon: IconFlask },
];

export default function RootLayout() {
  // One disclosure drives the mobile burger; on desktop the navbar is always
  // open, so `desktop: false` keeps it pinned regardless of this state.
  const [opened, { toggle }] = useDisclosure();
  const { pathname } = useLocation();

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
          <Title order={4}>Pinkerton Agent</Title>
          <Text size="xs" c="dimmed">
            CRM
          </Text>
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
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
