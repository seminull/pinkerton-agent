import { NavLink, Tooltip } from "@mantine/core";
import { IconExternalLink, type TablerIcon } from "@tabler/icons-react";
import { Link } from "react-router";

// A link is either a page in this app (`to`, highlighted while you're on it) or
// another site (`href`, which is never "the current page"). The `never`s make
// passing both, or an `active` with an `href`, a type error.
type Target =
  | { to: string; active: boolean; href?: never }
  | { href: string; to?: never; active?: never };

type Props = Target & {
  label: string;
  icon: TablerIcon;
  /** Icon only, for the mini sidebar. The label moves to a tooltip. */
  compact: boolean;
  /** Closes the mobile drawer. A no-op when the drawer isn't open. */
  onNavigate: () => void;
};

// NavLink always renders its label box with flex: 1 and a margin after the
// icon, even with no label — so hiding the box and dropping the margin is what
// actually centres the icon in the narrow rail.
const COMPACT_STYLES = {
  root: { justifyContent: "center" },
  section: { marginInline: 0 },
  body: { display: "none" },
};

// One row of the sidebar, in either width. Kept as one component so the app
// pages, the external links, and the admin link can't drift apart in how they
// collapse.
export default function SidebarLink({ label, icon: Icon, compact, onNavigate, ...target }: Props) {
  const external = target.href !== undefined;

  const common = {
    label,
    // The aria-label starts with the visible label so voice control ("click
    // Zillow") still matches it. In compact mode the label box is display:
    // none, which hides it from screen readers too, so this is their only name
    // for the link.
    "aria-label": external ? `${label} (opens in a new tab)` : label,
    leftSection: <Icon size={18} stroke={1.5} />,
    // The trailing icon warns that the link leaves the app. The rail has no
    // room for it, so in compact mode it's dropped and the tooltip has to do.
    rightSection: external && !compact ? <IconExternalLink size={14} stroke={1.5} /> : undefined,
    styles: compact ? COMPACT_STYLES : undefined,
    onClick: onNavigate,
  };

  const link = external ? (
    // A new tab, so a lookup doesn't navigate away from a half-filled form
    // here. noopener stops that tab reaching back through window.opener, and
    // noreferrer keeps our URLs (which carry record ids) out of third-party
    // logs.
    <NavLink component="a" href={target.href} target="_blank" rel="noopener noreferrer" {...common} />
  ) : (
    <NavLink component={Link} to={target.to} active={target.active} {...common} />
  );

  // Always wrapped, and only `disabled` toggles, so switching widths doesn't
  // remount the link and drop keyboard focus from it.
  return (
    <Tooltip label={label} position="right" withArrow disabled={!compact}>
      {link}
    </Tooltip>
  );
}
