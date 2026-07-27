import { createTheme } from "@mantine/core";

// The single place app-wide visual decisions live. Component-level style props
// are fine for one-offs, but anything that should look the same in three places
// belongs here.
export const theme = createTheme({
  primaryColor: "indigo",
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
