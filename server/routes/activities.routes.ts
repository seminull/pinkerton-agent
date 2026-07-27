import { Hono } from "hono";
import { Op, type WhereOptions } from "sequelize";
import { Activity, Contact, Listing } from "../sequelize/models";
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
  "type",
  "subject",
  "body",
  "occurredAt",
  "completedAt",
  "contactId",
  "listingId",
] as const;

const REQUIRED_ON_CREATE = ["subject"] as const;

// GET /api/activities?contactId=&listingId=&type=&open=true&limit=&offset=
// Always newest-first: this is a timeline, and there's no other useful order.
app.get("/", async (c) => {
  const query = c.req.query();
  const { limit, offset } = parsePage(query);

  const conditions: WhereOptions[] = [];
  if (query.contactId) conditions.push({ contactId: requireUuid(query.contactId) });
  if (query.listingId) conditions.push({ listingId: requireUuid(query.listingId) });
  if (query.type) conditions.push({ type: query.type });
  // open=true is the follow-up queue — everything not yet marked done. Backed
  // by the partial index in the create-activities migration.
  if (query.open === "true") conditions.push({ completedAt: { [Op.is]: null } });

  const where: WhereOptions = conditions.length > 0 ? { [Op.and]: conditions } : {};

  const { rows, count } = await Activity.findAndCountAll({
    where,
    include: [
      { model: Contact, as: "contact" },
      { model: Listing, as: "listing" },
    ],
    order: [["occurredAt", "DESC"]],
    limit,
    offset,
    distinct: true,
  });

  return c.json({ results: rows, total: count });
});

app.post("/", async (c) => {
  const values = pickFields(await c.req.json(), WRITABLE);
  requireFields(values, REQUIRED_ON_CREATE);
  const activity = await Activity.create(values as never);
  return c.json({ activity }, 201);
});

app.patch("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const values = pickFields(await c.req.json(), WRITABLE);
  requireNonEmpty(values);

  const activity = await Activity.findByPk(id);
  if (!activity) throw apiError(404, "activity_not_found");

  await activity.update(values as never);
  return c.json({ activity });
});

app.delete("/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const deleted = await Activity.destroy({ where: { id } });
  if (deleted === 0) throw apiError(404, "activity_not_found");
  return c.body(null, 204);
});

export default app;
