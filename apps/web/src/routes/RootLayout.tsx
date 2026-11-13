import {
  AppShell,
  Avatar,
  Burger,
  Divider,
  Group,
  Menu,
  Text,
  Title,
  UnstyledButton,
  useMantineTheme,
} from "@mantine/core";
import { useDisclosure, useLocalStorage, useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAddressBook,
  IconBuildingCommunity,
  IconClock,
  IconHome,
  IconHome2,
  IconHomeSearch,
  IconLayoutDashboard,
  IconListSearch,
  IconMapSearch,
  IconLogout,
  IconUsers,
} from "@tabler/icons-react";
import { Outlet, useLocation } from "react-router";
import { useAuth } from "../auth/authContext";
import { BrandMark } from "../brand/Brand";
import ColorSchemeToggle from "./ColorSchemeToggle";
import SidebarLink from "./SidebarLink";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: IconLayoutDashboard },
  { to: "/contacts", label: "Contacts", icon: IconAddressBook },
  { to: "/listings", label: "Listings", icon: IconHome },
  { to: "/time-clock", label: "Time Clock", icon: IconClock },
];

// Sites agents keep open beside the CRM. The working tools come first (the
// MLS, then appraisal data), the consumer portals after — those are where a
// client has usually already been looking. Tabler has no brand marks for
// these, so the icons are generic stand-ins rather than logos.
const EXTERNAL_LINKS = [
  { href: "https://matrix.ntreis.net", label: "NTREIS Matrix", icon: IconListSearch },
  { href: "https://bigdistrict.app", label: "Big District", icon: IconBuildingCommunity },
  { href: "https://www.zillow.com", label: "Zillow", icon: IconHomeSearch },
  { href: "https://www.realtor.com", label: "Realtor.com", icon: IconHome2 },
  { href: "https://www.redfin.com", label: "Redfin", icon: IconMapSearch },
];

// Sidebar widths. The mini width fits the 18px icons with NavLink's own
// padding on each side, inside the navbar's xs padding and 1px border.
const FULL_WIDTH = 220;
const MINI_WIDTH = 64;

export default function RootLayout() {
  // One disclosure drives the mobile burger; on desktop the navbar is always
  // open, so `desktop: false` keeps it pinned regardless of this state.
  const [opened, { toggle, close: closeMobile }] = useDisclosure();
  const { pathname } = useLocation();
  const theme = useMantineTheme();

  // The mini sidebar is a preference, so it's remembered in this browser
  // rather than per account — a laptop and a wide monitor can differ.
  // getInitialValueInEffect: false reads it during the first render; the
  // default (built for server rendering) would draw the full sidebar first and
  // then snap it narrow on every page load.
  const [mini, setMini] = useLocalStorage({
    key: "pinkerton-sidebar-mini",
    defaultValue: false,
    getInitialValueInEffect: false,
  });
  // Below the breakpoint the navbar is a full-width drawer, where an icon rail
  // makes no sense — so the preference only applies on desktop, and is kept
  // (not cleared) while the window is narrow.
  const desktop = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`, undefined, {
    getInitialValueInEffect: false,
  });
  const compact = mini && desktop;
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
        width: compact ? MINI_WIDTH : FULL_WIDTH,
        breakpoint: "sm",
        collapsed: { mobile: !opened, desktop: false },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm">
          {/* Two burgers, one per breakpoint, because they do different jobs:
              on phones the navbar is an overlay drawer that opens and closes;
              on desktop it never closes, only narrows. */}
          <Burger
            opened={opened}
            onClick={toggle}
            hiddenFrom="sm"
            size="sm"
            aria-label={opened ? "Close navigation" : "Open navigation"}
          />
          {/* Not passed `opened`, so it stays three lines: an X would read as
              "close the sidebar", and this only narrows it. */}
          <Burger
            onClick={() => setMini((was) => !was)}
            visibleFrom="sm"
            size="sm"
            aria-label={mini ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!mini}
          />
          <BrandMark h={34} />
          <Title order={4}>Pinkerton Agent</Title>
          <Text size="xs" c="dimmed">
            CRM
          </Text>

          {/* AuthGate only renders this layout with a user, but the type is
              nullable and a guard is cheaper than a non-null assertion. */}
          {user && (
            // The group is what is pushed to the right edge (ml="auto"), so the
            // toggle and the account menu travel together.
            <Group ml="auto" gap="sm" wrap="nowrap">
              <ColorSchemeToggle />
              <Menu position="bottom-end" withArrow>
                <Menu.Target>
                  <UnstyledButton aria-label="Account menu">
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
            </Group>
          )}
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {NAV_ITEMS.map(({ to, label, icon }) => (
          <SidebarLink
            key={to}
            to={to}
            label={label}
            icon={icon}
            // Exact match for "/" only — otherwise the Dashboard link would
            // stay highlighted on every page.
            active={to === "/" ? pathname === "/" : pathname.startsWith(to)}
            compact={compact}
            onNavigate={closeMobile}
          />
        ))}

        {/* The rail is too narrow for a heading, so the divider stays as a
            plain rule there — it still separates the groups. */}
        <Divider my="xs" label={compact ? undefined : "Links"} labelPosition="left" />
        {EXTERNAL_LINKS.map(({ href, label, icon }) => (
          <SidebarLink
            key={href}
            href={href}
            label={label}
            icon={icon}
            compact={compact}
            onNavigate={closeMobile}
          />
        ))}

        {/* Shown only to admins. Hiding it is tidiness, not protection — the
            page and the API each check the role themselves. */}
        {user?.role === "admin" && (
          <>
            <Divider my="xs" label={compact ? undefined : "Admin"} labelPosition="left" />
            <SidebarLink
              to="/admin/users"
              label="Users"
              icon={IconUsers}
              active={pathname.startsWith("/admin/users")}
              compact={compact}
              onNavigate={closeMobile}
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
