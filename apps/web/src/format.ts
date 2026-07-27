// Display formatting. Everything here takes the wire shape (which may be a
// string for BIGINT/DECIMAL columns) and returns something safe to render.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Cents -> "$425,000". Renders an em dash for an unpriced listing. */
export const formatPriceCents = (cents: string | number | null | undefined): string => {
  if (cents === null || cents === undefined) return "—";
  const value = typeof cents === "string" ? Number(cents) : cents;
  if (!Number.isFinite(value)) return "—";
  return currency.format(value / 100);
};

/** Dollars from a form input -> cents for the API. Rounds, never truncates. */
export const dollarsToCents = (dollars: number | string | null | undefined): number | null => {
  if (dollars === null || dollars === undefined || dollars === "") return null;
  const value = typeof dollars === "string" ? Number(dollars) : dollars;
  return Number.isFinite(value) ? Math.round(value * 100) : null;
};

export const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
};

/** Turns an enum value ("coming_soon") into a label ("Coming soon"). */
export const humanize = (value: string): string => {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
