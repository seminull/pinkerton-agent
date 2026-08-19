import { Hono } from "hono";
import { Op, type WhereOptions } from "sequelize";
import { Communication, Contact, Listing } from "../sequelize/models";
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

// GET /api/contacts/:id — the detail view, with the listings they're selling.
app.get("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const contact = await Contact.findByPk(id, {
    include: [
      { model: Listing, as: "listings" },
      {
        model: Communication,
        as: "communications",
        separate: true,
        limit: 50,
        order: [["occurredAt", "DESC"]],
      },
    ],
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
