import { Hono } from "hono";
import { apiError, parsePage } from "../http";
import {
  TARGET_COUNTIES,
  bridgeConfig,
  bridgeQuery,
  searchProperties,
  toMlsListing,
} from "../mls/bridge";

// Read-only proxy in front of Bridge. Two reasons this exists rather than the
// browser calling Bridge directly:
//
//  1. The server token stays server-side (see the note in mls/bridge.ts).
//  2. CORS. Bridge doesn't send permissive CORS headers, so a browser fetch to
//     api.bridgedataoutput.com fails before it ever gets an answer.
//
// Nothing here writes. MLS data is a licensed cache, never a system of record,
// and there is no cache yet — this reads straight through so the Test tab shows
// what the feed actually returns today.

const app = new Hono();

// How many records the field-coverage sampler pulls. Enough for fill rates to
// mean something, small enough to stay well inside Bridge's per-minute quota.
const COVERAGE_SAMPLE_DEFAULT = 50;
const COVERAGE_SAMPLE_MAX = 200;

const EXAMPLE_MAX_CHARS = 120;

const preview = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > EXAMPLE_MAX_CHARS
    ? `${text.slice(0, EXAMPLE_MAX_CHARS)}…`
    : text;
};

// GET /api/mls/status — what the Test tab is pointed at, and whether it answers.
app.get("/status", async (c) => {
  const { base, dataset, token, isDemoToken, isDemoData } = bridgeConfig();

  // Cheapest possible liveness probe: one record, one field.
  const probe = await bridgeQuery("Property", { $top: "1", $select: "ListingKey" })
    .then(() => ({ reachable: true, error: null as string | null }))
    .catch((err: unknown) => ({
      reachable: false,
      error: err instanceof Error ? err.message : "unknown_error",
    }));

  return c.json({
    base,
    dataset,
    isDemoToken,
    isDemoData,
    // Never the token itself — just enough to tell two credentials apart when
    // someone is checking which .env got loaded.
    tokenHint: `${token.slice(0, 4)}…${token.slice(-4)}`,
    targetCounties: TARGET_COUNTIES,
    ...probe,
  });
});

// GET /api/mls/search — the explorer's main query. Filter params are allowlisted
// in mls/bridge.ts; anything else in the query string is ignored rather than
// forwarded.
app.get("/search", async (c) => {
  const query = c.req.query();
  const { limit, offset } = parsePage(query);

  const { results, total, query: echoed } = await searchProperties({
    filters: query,
    top: limit,
    skip: offset,
    sort: query.sort,
    dir: query.dir,
  });

  // `query` goes back to the UI so the generated OData is visible next to its
  // results. That echo is the point of the tab — it's the fastest way to learn
  // what a given control does to the request.
  return c.json({ results, total, query: echoed });
});

// GET /api/mls/property/:key — one record, every field, unmodified.
//
// Deliberately no $select: this is the "what does the feed actually carry"
// view, and narrowing it would defeat the purpose. Addressed by $filter rather
// than OData's Property('key') key syntax because listing keys are opaque and
// have no guarantee of being safe in a URL path segment.
app.get("/property/:key", async (c) => {
  const key = c.req.param("key");
  if (!key) throw apiError(400, "missing_listing_key");

  const { data } = await bridgeQuery("Property", {
    $filter: `ListingKey eq '${key.replace(/'/g, "''")}'`,
    $top: "1",
  });

  const row = data.value[0];
  if (!row) throw apiError(404, "mls_listing_not_found");

  return c.json({ listing: toMlsListing(row), raw: row });
});

// GET /api/mls/field-coverage — fill rate per field across a sample.
//
// This answers the question that decides how much of the RESO surface is worth
// modelling: a field that's in the schema but null in every record is not a
// field you have. ParcelNumber is the one that matters most here, since it's
// the join key to Big District's appraisal data and its fill rate varies a lot
// between MLSs.
app.get("/field-coverage", async (c) => {
  const requested = parseInt(c.req.query("sample") ?? "", 10);
  const sample = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), COVERAGE_SAMPLE_MAX)
    : COVERAGE_SAMPLE_DEFAULT;

  const { data } = await bridgeQuery("Property", { $top: String(sample) });
  const rows = data.value;
  if (rows.length === 0) return c.json({ sample: 0, fields: [] });

  // Union of keys, not the first row's keys — OData omits some nulls rather
  // than sending them, so any single row understates the field surface.
  const names = new Set<string>();
  for (const row of rows) for (const name of Object.keys(row)) names.add(name);
  // OData annotations (@odata.id and friends) are transport, not data.
  names.delete("@odata.id");

  const fields = [...names]
    .map((name) => {
      const filled = rows.filter((row) => {
        const value = row[name];
        if (value === null || value === undefined || value === "") return false;
        // An empty array is RESO's "no values for this multi-select", which is
        // absence, not data — counting it as filled would overstate coverage on
        // every one of the ~60 array-typed fields.
        if (Array.isArray(value) && value.length === 0) return false;
        return true;
      }).length;

      return {
        name,
        filled,
        percent: Math.round((filled / rows.length) * 100),
        // A representative value beats a type name when you're deciding whether
        // a field is worth a column. Truncated because free-text RESO fields
        // (PublicRemarks, TaxLegalDescription) run to paragraphs, and ~350 of
        // them at full length is a multi-megabyte response for a preview.
        example: preview(
          rows.map((row) => row[name]).find((v) => v !== null && v !== undefined)
        ),
      };
    })
    .sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name));

  return c.json({ sample: rows.length, fields });
});

export default app;
