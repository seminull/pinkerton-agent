import { Hono } from "hono";
import { Op, type WhereOptions } from "sequelize";
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

interface ImportedContact {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
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

const parseImportedContacts = (body: unknown): ImportedContact[] => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw apiError(400, "body_must_be_an_object");
  }
  const contacts = (body as Record<string, unknown>).contacts;
  if (!Array.isArray(contacts) || contacts.length === 0) {
    throw apiError(422, "contacts_must_be_a_nonempty_array");
  }
  if (contacts.length > MAX_IMPORT_CONTACTS) {
    throw apiError(413, "too_many_contacts", {
      contacts: `maximum_${MAX_IMPORT_CONTACTS}`,
    });
  }

  return contacts.map((contact, index) => {
    if (typeof contact !== "object" || contact === null || Array.isArray(contact)) {
      throw importFieldError(index, "contact", "must_be_an_object");
    }
    const values = contact as Record<string, unknown>;
    return {
      firstName: requiredImportField(values, "firstName", index),
      lastName: requiredImportField(values, "lastName", index),
      email: optionalImportField(values, "email", index),
      phone: optionalImportField(values, "phone", index),
    };
  });
};

const normalizeEmail = (email: string | null): string | null =>
  email ? email.trim().toLowerCase() : null;

const normalizePhone = (phone: string | null): string | null => {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  // Treat a North American country code as formatting so `(312) ...` and
  // `+1 312 ...` do not create two CRM records for the same person.
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
};

// Sort allowlist. Only these names ever reach the ORDER BY clause, so a caller
// can't order by (and thereby probe) an arbitrary column.
const SORT_FIELDS: Record<string, string> = {
  createdAt: "createdAt",
  updatedAt: "updatedAt",
  lastName: "lastName",
  stage: "stage",
};

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
    conditions.push({
      [Op.or]: [
        { firstName: { [Op.iLike]: term } },
        { lastName: { [Op.iLike]: term } },
        { email: { [Op.iLike]: term } },
        { phone: { [Op.iLike]: term } },
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

// POST /api/contacts/import — one all-or-nothing batch from a phone vCard.
// Duplicate detection stays on the server because the browser only has one
// paginated slice of the CRM and cannot make an authoritative decision.
app.post("/import", async (c) => {
  const importedContacts = parseImportedContacts(await c.req.json());

  const result = await sequelize.transaction(async (transaction) => {
    const existing = await Contact.findAll({
      attributes: ["email", "phone"],
      transaction,
    });
    const emails = new Set(
      existing
        .map((contact) => normalizeEmail(contact.email))
        .filter((value): value is string => value !== null)
    );
    const phones = new Set(
      existing
        .map((contact) => normalizePhone(contact.phone))
        .filter((value): value is string => value !== null)
    );

    const contactsToCreate: Array<ImportedContact & {
      type: "buyer";
      stage: "new";
      source: "Phone import";
    }> = [];
    let duplicates = 0;

    for (const contact of importedContacts) {
      const email = normalizeEmail(contact.email);
      const phone = normalizePhone(contact.phone);
      if ((email && emails.has(email)) || (phone && phones.has(phone))) {
        duplicates += 1;
        continue;
      }

      contactsToCreate.push({
        ...contact,
        type: "buyer",
        stage: "new",
        source: "Phone import",
      });
      // Add identifiers immediately so duplicates inside the uploaded file are
      // skipped as well as duplicates already stored in Postgres.
      if (email) emails.add(email);
      if (phone) phones.add(phone);
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
  const contact = await Contact.create(values as never);
  return c.json({ contact }, 201);
});

app.patch("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const values = pickFields(await c.req.json(), WRITABLE);
  requireNonEmpty(values);

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
