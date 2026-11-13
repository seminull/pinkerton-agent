import { isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// Shared request-shaping helpers. Every route pulls its pagination and its
// writable-field allowlist from here so the rules are stated once.

// Every API error leaves as `{ error, details? }` JSON. The body is attached to
// the exception rather than formatted in a central onError handler because a
// sub-app mounted with app.route() handles its own errors — the root handler
// never sees these, and Hono's default would render them as plain text the
// client can't parse.
export const apiError = (
  status: ContentfulStatusCode,
  code: string,
  details?: Record<string, string>
): HTTPException =>
  new HTTPException(status, {
    res: Response.json({ error: code, ...(details ? { details } : {}) }, { status }),
  });

// Page-size cap. Big enough for a full table page, small enough that
// `?limit=<huge>` in a tight loop is not a bandwidth amplifier.
export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 25;

export interface Page {
  limit: number;
  offset: number;
}

export const parsePage = (query: Record<string, string | undefined>): Page => {
  const rawLimit = parseInt(query.limit ?? "", 10);
  const rawOffset = parseInt(query.offset ?? "", 10);
  return {
    limit:
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, MAX_LIMIT)
        : DEFAULT_LIMIT,
    offset: Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0,
  };
};

// Reject anything that isn't a UUID before it reaches Postgres. Sequelize would
// otherwise surface a malformed :id as a 500 "invalid input syntax for type
// uuid" — that's a client error and should read as one.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const requireUuid = (id: string | undefined): string => {
  if (!id || !UUID_RE.test(id)) {
    throw apiError(400, "invalid_id");
  }
  return id;
};

// Copy only the allowlisted keys off a request body. This is the whole
// mass-assignment control: a client can never set `id`, `createdAt`, or any
// column a route didn't explicitly opt into, no matter what it POSTs.
export const pickFields = <K extends string>(
  body: unknown,
  fields: readonly K[]
): Partial<Record<K, unknown>> => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw apiError(400, "body_must_be_an_object");
  }
  const source = body as Record<string, unknown>;
  const picked: Partial<Record<K, unknown>> = {};
  for (const field of fields) {
    if (field in source) picked[field] = source[field];
  }
  return picked;
};

// Guard for creates: PATCH may legitimately send a subset, but a POST that
// omits a NOT NULL column should fail as a 422 with the field named, not as a
// raw database constraint error.
export const requireFields = (
  values: Partial<Record<string, unknown>>,
  required: readonly string[]
): void => {
  const missing = required.filter((field) => {
    const value = values[field];
    return value === undefined || value === null || value === "";
  });
  if (missing.length > 0) {
    throw apiError(
      422,
      "missing_required_fields",
      Object.fromEntries(missing.map((field) => [field, "required"]))
    );
  }
};

// An empty PATCH is a client bug — silently returning the unchanged row hides
// it. Answer 400 so the caller notices nothing was sent.
export const requireNonEmpty = (values: Partial<Record<string, unknown>>): void => {
  if (Object.keys(values).length === 0) {
    throw apiError(400, "no_updatable_fields_supplied");
  }
};

// The visitor's address, for audit logs. Not an authorization input anywhere.
//
// In production the API has no published port: every request arrives through
// docker/nginx.conf, which overwrites X-Real-IP with Cloudflare's
// CF-Connecting-IP (or its own socket peer when nothing is in front). So the
// header is trustworthy there, and a client-sent X-Real-IP never survives the
// proxy. In development nothing sets it and the socket address is used.
//
// net.isIP keeps a malformed header from being stored as if it were an
// address; the IPv4-mapped prefix is dropped so 127.0.0.1 reads as itself.
export const clientIp = (c: Context): string | null => {
  const candidates = [c.req.header("x-real-ip")?.trim()];
  try {
    candidates.push(getConnInfo(c).remote.address);
  } catch {
    // Not running under @hono/node-server (e.g. app.request() in a test).
  }
  for (const raw of candidates) {
    const address = raw?.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
    if (address && isIP(address)) return address;
  }
  return null;
};
