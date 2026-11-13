import { createTheme, type MantineColorsTuple } from "@mantine/core";

// The brand rose, as the ten-step scale Mantine wants (lightest to darkest).
// Two steps are fixed by the logo artwork and the rest are graded around them:
// [4] is the rose the logo uses on dark backgrounds, [6] the one it uses on
// light. Change those and the logo files together, or the buttons stop
// matching the doorway they sit under.
const rose: MantineColorsTuple = [
  "#FDF0F4",
  "#F9DEE6",
  "#F2BCCB",
  "#EC98AF",
  "#E77696",
  "#D9688A",
  "#C85E7B",
  "#B04A68",
  "#963C57",
  "#7A2E45",
];

// The single place app-wide visual decisions live. Component-level style props
// are fine for one-offs, but anything that should look the same in three places
// belongs here.
export const theme = createTheme({
  colors: { rose },
  primaryColor: "rose",
  // One step darker than the logo's own rose for filled buttons. White text on
  // the logo rose ([6]) is about 3.9:1 — under the 4.5:1 WCAG AA asks of body
  // text; on [7] it is about 5.2:1. The difference is invisible next to the
  // logo and is the difference between a readable "Sign in" and a faint one.
  primaryShade: 7,
  defaultRadius: "md",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  headings: { fontWeight: "600" },
});

// Status -> badge colour, shared by the listings table and the detail page so
// a "pending" chip never means two different colours in two places.
export const LISTING_STATUS_COLORS: Record<string, string> = {
  draft: "gray",
  coming_soon: "cyan",
  active: "green",
  pending: "yellow",
  sold: "blue",
  withdrawn: "gray",
  expired: "red",
};

export const CONTACT_STAGE_COLORS: Record<string, string> = {
  new: "blue",
  contacted: "cyan",
  qualified: "violet",
  active: "green",
  closed: "teal",
  lost: "gray",
};
