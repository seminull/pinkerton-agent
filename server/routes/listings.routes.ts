import { Hono } from "hono";
import { Op, type WhereOptions } from "sequelize";
import { Contact, Listing } from "../sequelize/models";
import {
  apiError,
  parsePage,
  pickFields,
  requireFields,
  requireNonEmpty,
  requireUuid,
} from "../http";

const app = new Hono();

const WRITABLE = [
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "mlsNumber",
  "status",
  "listPriceCents",
  "bedrooms",
  "bathrooms",
  "livingAreaSqft",
  "lotAcres",
  "yearBuilt",
  "listedOn",
  "sellerContactId",
  "notes",
] as const;

const REQUIRED_ON_CREATE = ["addressLine1", "city", "state", "postalCode"] as const;

const SORT_FIELDS: Record<string, string> = {
  createdAt: "createdAt",
  updatedAt: "updatedAt",
  listPriceCents: "listPriceCents",
  listedOn: "listedOn",
  status: "status",
};

// GET /api/listings?q=&status=&city=&minPrice=&maxPrice=&sort=&dir=&limit=&offset=
// Prices are cents on the wire, matching the column — the client formats.
app.get("/", async (c) => {
  const query = c.req.query();
  const { limit, offset } = parsePage(query);

  // Filters accumulate as a list and get AND-ed together at the end — see the
  // same pattern in contacts.routes.ts.
  const conditions: WhereOptions[] = [];
  if (query.status) conditions.push({ status: query.status });
  if (query.city) conditions.push({ city: { [Op.iLike]: query.city } });

  const min = parseInt(query.minPrice ?? "", 10);
  const max = parseInt(query.maxPrice ?? "", 10);
  if (Number.isFinite(min) || Number.isFinite(max)) {
    conditions.push({
      listPriceCents: {
        ...(Number.isFinite(min) ? { [Op.gte]: min } : {}),
        ...(Number.isFinite(max) ? { [Op.lte]: max } : {}),
      },
    });
  }

  if (query.q) {
    const term = `%${query.q}%`;
    conditions.push({
      [Op.or]: [
        { addressLine1: { [Op.iLike]: term } },
        { city: { [Op.iLike]: term } },
        { postalCode: { [Op.iLike]: term } },
        { mlsNumber: { [Op.iLike]: term } },
      ],
    });
  }

  const where: WhereOptions = conditions.length > 0 ? { [Op.and]: conditions } : {};

  const sort = SORT_FIELDS[query.sort ?? ""] ?? "createdAt";
  const dir = query.dir?.toLowerCase() === "asc" ? "ASC" : "DESC";

  const { rows, count } = await Listing.findAndCountAll({
    where,
    include: [{ model: Contact, as: "seller" }],
    order: [[sort, dir]],
    limit,
    offset,
    // findAndCountAll counts the joined rows without this, which inflates the
    // total once a listing has more than one associated row.
    distinct: true,
  });

  return c.json({ results: rows, total: count });
});

app.get("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const listing = await Listing.findByPk(id, {
    include: [{ model: Contact, as: "seller" }],
  });
  if (!listing) throw apiError(404, "listing_not_found");
  return c.json({ listing });
});

app.post("/", async (c) => {
  const values = pickFields(await c.req.json(), WRITABLE);
  requireFields(values, REQUIRED_ON_CREATE);
  const listing = await Listing.create(values as never);
  return c.json({ listing }, 201);
});

app.patch("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const values = pickFields(await c.req.json(), WRITABLE);
  requireNonEmpty(values);

  const listing = await Listing.findByPk(id);
  if (!listing) throw apiError(404, "listing_not_found");

  await listing.update(values as never);
  return c.json({ listing });
});

app.delete("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const deleted = await Listing.destroy({ where: { id } });
  if (deleted === 0) throw apiError(404, "listing_not_found");
  return c.body(null, 204);
});

export default app;
