import { Hono } from "hono";
import { Op, type WhereOptions } from "sequelize";
import { normalizePhoneNumber } from "../phone";
import { Contact, Listing, sequelize } from "../sequelize/models";
import {
  apiError,
  parsePage,
  pickFields,
  requireFields,
  requireNonEmpty,
  requireUuid,
} from "../http";

const app = new Hono();

// Columns a client may write. `id`, `createdAt`, and `updatedAt` are absent by
// design — see pickFields.
const WRITABLE = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "type",
  "stage",
  "source",
  "notes",
] as const;

const REQUIRED_ON_CREATE = ["firstName", "lastName"] as const;

const MAX_IMPORT_CONTACTS = 2000;
const MAX_CONTACT_FIELD_LENGTH = 255;
const MAX_CONTACT_NOTES_LENGTH = 100_000;

type ImportSource = "Phone import" | "Matrix CSV";

interface ImportedContact {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

interface ContactImport {
  contacts: ImportedContact[];
  source: ImportSource;
}

const importFieldError = (index: number, field: string, reason: string) =>
  apiError(422, "invalid_import_contact", {
    [`contacts.${index}.${field}`]: reason,
  });

const requiredImportField = (
  contact: Record<string, unknown>,
  field: "firstName" | "lastName",
  index: number
): string => {
  const value = contact[field];
  if (typeof value !== "string" || !value.trim()) {
    throw importFieldError(index, field, "required");
  }
  if (value.trim().length > MAX_CONTACT_FIELD_LENGTH) {
    throw importFieldError(index, field, "too_long");
  }
  return value.trim();
};

const optionalImportField = (
  contact: Record<string, unknown>,
  field: "email" | "phone",
  index: number
): string | null => {
  const value = contact[field];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw importFieldError(index, field, "must_be_a_string");
  }
  if (value.trim().length > MAX_CONTACT_FIELD_LENGTH) {
    throw importFieldError(index, field, "too_long");
  }
  return value.trim() || null;
};

const optionalImportNotes = (
  contact: Record<string, unknown>,
  index: number
): string | null => {
  const value = contact.notes;
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw importFieldError(index, "notes", "must_be_a_string");
  }
  if (value.trim().length > MAX_CONTACT_NOTES_LENGTH) {
    throw importFieldError(index, "notes", "too_long");
  }
  return value.trim() || null;
};

const parseContactImport = (body: unknown): ContactImport => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw apiError(400, "body_must_be_an_object");
  }
  const values = body as Record<string, unknown>;
  const contacts = values.contacts;
  if (!Array.isArray(contacts) || contacts.length === 0) {
    throw apiError(422, "contacts_must_be_a_nonempty_array");
  }
  if (contacts.length > MAX_IMPORT_CONTACTS) {
    throw apiError(413, "too_many_contacts", {
      contacts: `maximum_${MAX_IMPORT_CONTACTS}`,
    });
  }
  // Default keeps older API clients compatible; current clients always name
  // the import so the source shown in the contact table is accurate.
  const source = values.source ?? "Phone import";
  if (source !== "Phone import" && source !== "Matrix CSV") {
    throw apiError(422, "invalid_import_source");
  }

  const parsedContacts = contacts.map((contact, index) => {
    if (typeof contact !== "object" || contact === null || Array.isArray(contact)) {
      throw importFieldError(index, "contact", "must_be_an_object");
    }
    const contactValues = contact as Record<string, unknown>;
    const phoneInput = optionalImportField(contactValues, "phone", index);
    const phone = normalizePhoneNumber(phoneInput);
    if (phoneInput && !phone) {
      throw importFieldError(index, "phone", "invalid_phone_number");
    }
    return {
      firstName: requiredImportField(contactValues, "firstName", index),
      lastName: requiredImportField(contactValues, "lastName", index),
      email: optionalImportField(contactValues, "email", index),
      phone,
      notes: optionalImportNotes(contactValues, index),
    };
  });
  return { contacts: parsedContacts, source };
};

const normalizeEmail = (email: string | null): string | null =>
  email ? email.trim().toLowerCase() : null;

const normalizeContactValues = (
  values: Partial<Record<(typeof WRITABLE)[number], unknown>>
): void => {
  if (values.phone === undefined) return;
  if (values.phone === null || values.phone === "") {
    values.phone = null;
    return;
  }
  if (typeof values.phone !== "string") {
    throw apiError(422, "invalid_phone_number", { phone: "must_be_a_string" });
  }
  const phone = normalizePhoneNumber(values.phone);
  if (!phone) throw apiError(422, "invalid_phone_number", { phone: "invalid" });
  values.phone = phone;
};

const normalizeName = (firstName: string, lastName: string): string =>
  `${firstName.trim().replace(/\s+/g, " ").toLowerCase()}\u0000${lastName
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()}`;

// Sort allowlist. Only these names ever reach the ORDER BY clause, so a caller
// can't order by (and thereby probe) an arbitrary column.
const SORT_FIELDS: Record<string, string> = {
  createdAt: "createdAt",
  updatedAt: "updatedAt",
  lastName: "lastName",
  stage: "stage",
};

const csvCell = (value: unknown): string =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;

// GET /api/contacts?q=&stage=&type=&sort=&dir=&limit=&offset=
app.get("/", async (c) => {
  const query = c.req.query();
  const { limit, offset } = parsePage(query);

  // Filters accumulate as a list and get AND-ed together at the end. Building
  // the object key-by-key doesn't work once a clause is keyed by a symbol
  // (Op.or), and this keeps every branch a plain, typed WhereOptions.
  const conditions: WhereOptions[] = [];
  if (query.stage) conditions.push({ stage: query.stage });
  if (query.type) conditions.push({ type: query.type });

  // One search box across the fields an agent would actually type into it.
  // A leading-wildcard ILIKE can't use a plain btree index — fine at this size;
  // revisit with pg_trgm when the book of business gets large.
  if (query.q) {
    const term = `%${query.q}%`;
    const phoneDigits = query.q.replace(/\D/g, "");
    conditions.push({
      [Op.or]: [
        { firstName: { [Op.iLike]: term } },
        { lastName: { [Op.iLike]: term } },
        { email: { [Op.iLike]: term } },
        ...(phoneDigits ? [{ phone: { [Op.iLike]: `%${phoneDigits}%` } }] : []),
      ],
    });
  }

  const where: WhereOptions = conditions.length > 0 ? { [Op.and]: conditions } : {};

  const sort = SORT_FIELDS[query.sort ?? ""] ?? "createdAt";
  const dir = query.dir?.toLowerCase() === "asc" ? "ASC" : "DESC";

  const { rows, count } = await Contact.findAndCountAll({
    where,
    order: [[sort, dir]],
    limit,
    offset,
  });

  return c.json({ results: rows, total: count });
});

// GET /api/contacts/export.csv — a complete portable copy. Phone values are
// canonical E.164, matching API/storage rather than whichever punctuation was
// used when the contact was entered or imported.
app.get("/export.csv", async (c) => {
  const contacts = await Contact.findAll({
    order: [
      ["lastName", "ASC"],
      ["firstName", "ASC"],
    ],
  });
  const rows = [
    ["First name", "Last name", "Email", "Phone", "Type", "Stage", "Source", "Notes"],
    ...contacts.map((contact) => [
      contact.firstName,
      contact.lastName,
      contact.email,
      contact.phone,
      contact.type,
      contact.stage,
      contact.source,
      contact.notes,
    ]),
  ];
  const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  return c.body(csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="contacts.csv"',
  });
});

// POST /api/contacts/import — one all-or-nothing batch from a phone vCard or
// Matrix CSV. Duplicate detection stays on the server because the browser only
// has one paginated slice of the CRM and cannot make an authoritative decision.
app.post("/import", async (c) => {
  const contactImport = parseContactImport(await c.req.json());

  const result = await sequelize.transaction(async (transaction) => {
    // Serialise imports so two simultaneous uploads cannot both inspect the
    // same old snapshot and insert the same contacts.
    await sequelize.query('LOCK TABLE "contacts" IN SHARE ROW EXCLUSIVE MODE', {
      transaction,
    });
    const existing = await Contact.findAll({
      attributes: ["firstName", "lastName", "email", "phone"],
      transaction,
    });
    const emails = new Set(
      existing
        .map((contact) => normalizeEmail(contact.email))
        .filter((value): value is string => value !== null)
    );
    const phones = new Set(
      existing
        .map((contact) => normalizePhoneNumber(contact.phone))
        .filter((value): value is string => value !== null)
    );
    const names = new Set(
      existing.map((contact) => normalizeName(contact.firstName, contact.lastName))
    );

    const contactsToCreate: Array<ImportedContact & {
      type: "buyer";
      stage: "new";
      source: ImportSource;
    }> = [];
    let duplicates = 0;

    for (const contact of contactImport.contacts) {
      const email = normalizeEmail(contact.email);
      const phone = normalizePhoneNumber(contact.phone);
      const name = normalizeName(contact.firstName, contact.lastName);
      if (
        (email && emails.has(email)) ||
        (phone && phones.has(phone)) ||
        (!email && !phone && names.has(name))
      ) {
        duplicates += 1;
        continue;
      }

      contactsToCreate.push({
        ...contact,
        type: "buyer",
        stage: "new",
        source: contactImport.source,
      });
      // Add identifiers immediately so duplicates inside the uploaded file are
      // skipped as well as duplicates already stored in Postgres.
      if (email) emails.add(email);
      if (phone) phones.add(phone);
      if (!email && !phone) names.add(name);
    }

    if (contactsToCreate.length > 0) {
      await Contact.bulkCreate(contactsToCreate as never[], { transaction });
    }
    return { imported: contactsToCreate.length, duplicates };
  });

  return c.json(result, 201);
});

// GET /api/contacts/:id — the detail view, with the listings they're selling.
app.get("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const contact = await Contact.findByPk(id, {
    include: [{ model: Listing, as: "listings" }],
  });
  if (!contact) throw apiError(404, "contact_not_found");
  return c.json({ contact });
});

app.post("/", async (c) => {
  const values = pickFields(await c.req.json(), WRITABLE);
  requireFields(values, REQUIRED_ON_CREATE);
  normalizeContactValues(values);
  const contact = await Contact.create(values as never);
  return c.json({ contact }, 201);
});

app.patch("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const values = pickFields(await c.req.json(), WRITABLE);
  requireNonEmpty(values);
  normalizeContactValues(values);

  const contact = await Contact.findByPk(id);
  if (!contact) throw apiError(404, "contact_not_found");

  await contact.update(values as never);
  return c.json({ contact });
});

app.delete("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const deleted = await Contact.destroy({ where: { id } });
  if (deleted === 0) throw apiError(404, "contact_not_found");
  return c.body(null, 204);
});

export default app;
