import { Hono } from "hono";
import { Op, UniqueConstraintError, type WhereOptions } from "sequelize";
import { adminOnly } from "../admin";
import { normalizeEmail, type AuthEnv } from "../auth";
import { apiError, parsePage, pickFields, requireNonEmpty, requireUuid } from "../http";
import { hashPassword, passwordProblem } from "../password";
import {
  AuthIdentity,
  User,
  UserSession,
  type AuthIdentityInstance,
  type UserInstance,
} from "../sequelize/models";
import type { AdminUser } from "../types";

// Mounted at /api/admin. Account management: there is no sign-up page, so this
// is how people other than the owner get in.

const app = new Hono<AuthEnv>();

// Every route below is admin-only, enforced here rather than route by route —
// one added later inherits the guard whether or not its author remembered it.
app.use("*", adminOnly);

const ROLES = ["user", "admin"] as const;
const STATUSES = ["active", "disabled"] as const;
const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;

// `email` is writable on create only. It is the key a Google sign-in is matched
// to an account by, so changing it later would quietly hand the account to
// whoever owns the new address. To move someone, create a new account.
const WRITABLE_ON_CREATE = ["email", "firstName", "lastName", "role", "password"] as const;
const WRITABLE_ON_UPDATE = ["firstName", "lastName", "role", "status", "password"] as const;

const SORT_FIELDS: Record<string, string> = {
  createdAt: "createdAt",
  lastLoginAt: "lastLoginAt",
  email: "email",
  lastName: "lastName",
};

type UserWithIdentities = UserInstance & { identities?: AuthIdentityInstance[] };

// What an admin sees about an account. Like publicUser, a projection and never
// the row — `hasPassword` is a boolean precisely so the hash itself can't leak.
const adminUser = (user: UserWithIdentities): AdminUser => ({
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  avatarUrl: user.avatarUrl,
  role: user.role === "admin" ? "admin" : "user",
  status: user.status === "disabled" ? "disabled" : "active",
  emailVerified: user.emailVerifiedAt !== null,
  hasPassword: user.passwordHash !== null,
  providers: (user.identities ?? []).map((identity) => identity.provider),
  lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  createdAt: user.createdAt.toISOString(),
});

const withIdentities = { model: AuthIdentity, as: "identities", attributes: ["provider"] };

const findUser = async (id: string): Promise<UserWithIdentities> => {
  const user = await User.findByPk(id, { include: [withIdentities] });
  if (!user) throw apiError(404, "user_not_found");
  return user;
};

// Field checks shared by create and update. Collects every problem rather than
// stopping at the first, so the form can mark all the bad fields in one go.
const validate = (values: Partial<Record<string, unknown>>): void => {
  const details: Record<string, string> = {};
  const name = (field: "firstName" | "lastName", label: string) => {
    if (!(field in values)) return;
    const value = values[field];
    if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_NAME_LENGTH) {
      details[field] = `Enter a ${label} (up to ${MAX_NAME_LENGTH} characters).`;
    }
  };
  name("firstName", "first name");
  name("lastName", "last name");

  if ("email" in values) {
    const email = normalizeEmail(values.email);
    if (email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      details.email = "Enter a valid email address.";
    }
  }
  if ("role" in values && !ROLES.includes(values.role as never)) {
    details.role = "Choose a role.";
  }
  if ("status" in values && !STATUSES.includes(values.status as never)) {
    details.status = "Choose a status.";
  }
  // null/"" means "no password" (a Google-only account) and is allowed.
  if (values.password !== undefined && values.password !== null && values.password !== "") {
    const problem =
      typeof values.password === "string" ? passwordProblem(values.password) : "Invalid password.";
    if (problem) details.password = problem;
  }

  if (Object.keys(details).length > 0) throw apiError(422, "validation_failed", details);
};

const revokeSessions = async (userId: string, exceptSessionId?: string): Promise<number> => {
  const [count] = await UserSession.update(
    { revokedAt: new Date() },
    {
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { [Op.ne]: exceptSessionId } } : {}),
      },
    }
  );
  return count;
};

// GET /api/admin/users?q=&sort=&dir=&limit=&offset=
app.get("/users", async (c) => {
  const query = c.req.query();
  const { limit, offset } = parsePage(query);

  const where: WhereOptions = {};
  if (query.q) {
    const term = `%${query.q}%`;
    Object.assign(where, {
      [Op.or]: [
        { email: { [Op.iLike]: term } },
        { firstName: { [Op.iLike]: term } },
        { lastName: { [Op.iLike]: term } },
      ],
    });
  }

  const sort = SORT_FIELDS[query.sort ?? ""] ?? "createdAt";
  const dir = query.dir?.toLowerCase() === "asc" ? "ASC" : "DESC";

  const { rows, count } = await User.findAndCountAll({
    where,
    include: [withIdentities],
    order: [[sort, dir]],
    limit,
    offset,
    // The identities join multiplies rows; without this, `count` counts
    // identities and the pagination total drifts from the number of users.
    distinct: true,
  });

  return c.json({ results: rows.map(adminUser), total: count });
});

// POST /api/admin/users  { email, firstName, lastName, role?, password? }
//
// This is the invitation. With a password, the admin passes it on and the
// person signs in with it. Without one, the account can only be entered by a
// Google sign-in from that exact address — which is why creating it here is
// enough to let them in, with no separate allowlist entry.
app.post("/users", async (c) => {
  const values = pickFields(await c.req.json(), WRITABLE_ON_CREATE);
  // Presence first, so a missing field reads as "required" rather than as a
  // format complaint about `undefined`.
  validate({ email: "", firstName: "", lastName: "", ...values });

  const password = typeof values.password === "string" ? values.password : "";
  try {
    const user = await User.create({
      email: normalizeEmail(values.email),
      passwordHash: password ? await hashPassword(password) : null,
      firstName: (values.firstName as string).trim(),
      lastName: (values.lastName as string).trim(),
      avatarUrl: null,
      role: values.role === "admin" ? "admin" : "user",
      status: "active",
      // An admin typing an address proves nothing about who reads its inbox.
      // A later Google sign-in is what sets this.
      emailVerifiedAt: null,
      lastLoginAt: null,
    });
    return c.json({ user: adminUser(user) }, 201);
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw apiError(409, "email_in_use", { email: "An account already uses this email." });
    }
    throw err;
  }
});

// PATCH /api/admin/users/:id  { firstName?, lastName?, role?, status?, password? }
app.patch("/users/:id", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const values = pickFields(await c.req.json(), WRITABLE_ON_UPDATE);
  requireNonEmpty(values);
  validate(values);

  const { user: actor, session } = c.get("auth");
  const target = await findUser(id);
  const isSelf = target.id === actor.id;

  // An admin can't demote or disable themselves. This one rule is also what
  // guarantees the system always has a working admin: every change to someone
  // else's access is made by an admin who is, by this rule, still one after it.
  const changesAccess =
    ("role" in values && values.role !== target.role) ||
    ("status" in values && values.status !== target.status);
  if (isSelf && changesAccess) {
    throw apiError(409, "cannot_change_own_access");
  }

  const changes: Record<string, unknown> = {};
  if (typeof values.firstName === "string") changes.firstName = values.firstName.trim();
  if (typeof values.lastName === "string") changes.lastName = values.lastName.trim();
  if ("role" in values) changes.role = values.role;
  if ("status" in values) changes.status = values.status;

  const newPassword = typeof values.password === "string" ? values.password : "";
  if (newPassword) changes.passwordHash = await hashPassword(newPassword);

  await target.update(changes as never);

  // A password reset or a disable has to end what is already signed in — the
  // usual reason for either is that someone shouldn't have access any more,
  // and leaving their 30-day session alive would make the change cosmetic.
  // An admin resetting their own password keeps the browser they did it from.
  if (newPassword || changes.status === "disabled") {
    await revokeSessions(target.id, isSelf ? session.id : undefined);
  }

  return c.json({ user: adminUser(target) });
});

// POST /api/admin/users/:id/revoke-sessions — "sign out everywhere".
// For a lost laptop or a phone left in a showing: ends every session without
// touching the password or the account.
app.post("/users/:id/revoke-sessions", async (c) => {
  const id = requireUuid(c.req.param("id"));
  const { user: actor, session } = c.get("auth");
  const target = await findUser(id);
  // On yourself it means "everywhere else" — signing out the browser you
  // clicked the button in would look like the app crashing.
  const revoked = await revokeSessions(
    target.id,
    target.id === actor.id ? session.id : undefined
  );
  return c.json({ revoked });
});

// No DELETE on purpose. Disabling is reversible and keeps the row for whatever
// later points at it (activity authorship, an audit trail); a hard delete is
// neither, and nothing yet needs it.

export default app;
