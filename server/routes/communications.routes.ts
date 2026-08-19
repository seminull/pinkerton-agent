import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { Op } from "sequelize";
import { apiError, parsePage, requireUuid } from "../http";
import { Communication, Contact, sequelize } from "../sequelize/models";

const app = new Hono();

const MAX_SYNC_EVENTS = 200;
const CHANNELS = new Set(["sms", "call", "email"]);
const DIRECTIONS = new Set(["incoming", "outgoing"]);

interface SyncEvent {
  externalId: string;
  contactId: string;
  channel: "sms" | "call" | "email";
  direction: "incoming" | "outgoing";
  occurredAt: Date;
  body: string | null;
  counterpartyAddress: string;
  durationSeconds: number | null;
}

const requireString = (
  value: unknown,
  field: string,
  maxLength: number
): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw apiError(422, "invalid_sync_event", { [field]: "required_string" });
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw apiError(422, "invalid_sync_event", { [field]: `max_${maxLength}` });
  }
  return normalized;
};

const parseEvent = (value: unknown, index: number): SyncEvent => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw apiError(422, "invalid_sync_event", {
      [`events.${index}`]: "must_be_an_object",
    });
  }

  const event = value as Record<string, unknown>;
  const channel = requireString(event.channel, `events.${index}.channel`, 16);
  const direction = requireString(
    event.direction,
    `events.${index}.direction`,
    16
  );
  if (!CHANNELS.has(channel)) {
    throw apiError(422, "invalid_sync_event", {
      [`events.${index}.channel`]: "unsupported",
    });
  }
  if (!DIRECTIONS.has(direction)) {
    throw apiError(422, "invalid_sync_event", {
      [`events.${index}.direction`]: "unsupported",
    });
  }

  const occurredAt = new Date(
    requireString(event.occurredAt, `events.${index}.occurredAt`, 64)
  );
  if (Number.isNaN(occurredAt.getTime())) {
    throw apiError(422, "invalid_sync_event", {
      [`events.${index}.occurredAt`]: "invalid_datetime",
    });
  }

  let body: string | null = null;
  if (event.body !== undefined && event.body !== null) {
    if (typeof event.body !== "string" || event.body.length > 100_000) {
      throw apiError(422, "invalid_sync_event", {
        [`events.${index}.body`]: "must_be_a_string_under_100000_chars",
      });
    }
    body = event.body;
  }

  let durationSeconds: number | null = null;
  if (event.durationSeconds !== undefined && event.durationSeconds !== null) {
    if (
      typeof event.durationSeconds !== "number" ||
      !Number.isInteger(event.durationSeconds) ||
      event.durationSeconds < 0
    ) {
      throw apiError(422, "invalid_sync_event", {
        [`events.${index}.durationSeconds`]: "must_be_a_non_negative_integer",
      });
    }
    durationSeconds = event.durationSeconds;
  }

  return {
    externalId: requireString(
      event.externalId,
      `events.${index}.externalId`,
      255
    ),
    contactId: requireUuid(
      requireString(event.contactId, `events.${index}.contactId`, 36)
    ),
    channel: channel as SyncEvent["channel"],
    direction: direction as SyncEvent["direction"],
    occurredAt,
    body,
    counterpartyAddress: requireString(
      event.counterpartyAddress,
      `events.${index}.counterpartyAddress`,
      255
    ),
    durationSeconds,
  };
};

const tokensMatch = (provided: string, expected: string): boolean => {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
};

// This token is intentionally separate from the future user session. A phone
// needs a revocable machine credential that can be rotated without signing the
// agent out of every browser.
app.use("*", async (c, next) => {
  const expected = process.env.MOBILE_SYNC_TOKEN;
  if (!expected) throw apiError(503, "mobile_sync_not_configured");

  const authorization = c.req.header("Authorization") ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!provided || !tokensMatch(provided, expected)) {
    throw apiError(401, "invalid_mobile_sync_token");
  }
  await next();
});

// GET /api/communications?contactId=&channel=&limit=&offset=
app.get("/", async (c) => {
  const query = c.req.query();
  const { limit, offset } = parsePage(query);
  const where: Record<string, unknown> = {};
  if (query.contactId) where.contactId = requireUuid(query.contactId);
  if (query.channel) {
    if (!CHANNELS.has(query.channel)) throw apiError(400, "invalid_channel");
    where.channel = query.channel;
  }

  const { rows, count } = await Communication.findAndCountAll({
    where,
    order: [["occurredAt", "DESC"]],
    limit,
    offset,
  });
  return c.json({ results: rows, total: count });
});

// POST /api/communications/sync
// Body: { deviceId, events: [...] }. The whole batch is validated before any
// row is written so one malformed event cannot leave a half-applied upload.
app.post("/sync", async (c) => {
  const body = await c.req.json().catch(() => {
    throw apiError(400, "invalid_json");
  });
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw apiError(400, "body_must_be_an_object");
  }

  const input = body as Record<string, unknown>;
  const deviceId = requireString(input.deviceId, "deviceId", 128);
  if (!Array.isArray(input.events)) {
    throw apiError(422, "invalid_sync_batch", { events: "must_be_an_array" });
  }
  if (input.events.length > MAX_SYNC_EVENTS) {
    throw apiError(413, "sync_batch_too_large");
  }

  const events = input.events.map(parseEvent);
  const contactIds = [...new Set(events.map((event) => event.contactId))];
  const contacts = await Contact.findAll({
    attributes: ["id"],
    where: { id: { [Op.in]: contactIds } },
  });
  const foundIds = new Set(contacts.map((contact) => contact.id));
  const missingId = contactIds.find((id) => !foundIds.has(id));
  if (missingId) {
    throw apiError(422, "sync_contact_not_found", { contactId: missingId });
  }

  let accepted = 0;
  await sequelize.transaction(async (transaction) => {
    for (const event of events) {
      const [, created] = await Communication.findOrCreate({
        where: { deviceId, externalId: event.externalId },
        defaults: { ...event, deviceId } as never,
        transaction,
      });
      if (created) accepted += 1;
    }
  });

  return c.json({
    accepted,
    duplicates: events.length - accepted,
  });
});

export default app;
