import type { MiddlewareHandler } from "hono";
import type { Transaction } from "sequelize";
import { normalizeEmail, type AuthEnv } from "./auth";
import { apiError } from "./http";
import type { UserInstance } from "./sequelize/models";

// Who is an admin, and how a route insists on one.
//
// Admin is a value of `users.role`. An admin can create accounts, change other
// people's roles, disable them, and reset their passwords (routes/admin.routes.ts).
// The role is granted three ways, and the differences between them matter:
//
//   1. ADMIN_EMAILS (comma-separated) designates addresses that SHOULD be
//      admin. A designated account is promoted when it signs in — but ONLY
//      once its email is verified, which today means it has signed in with
//      Google. A password account's address was typed by whoever created the
//      account and proves nothing; without this condition, creating an account
//      under the owner's address would be a path to the role.
//
//   2. `pnpm user:admin <email>` grants it from the server shell, with no
//      verification condition: having a shell on the server is the
//      authorization. This is how the first admin of a password-only
//      deployment comes to exist.
//
//   3. An existing admin grants it from the Users screen.
//
// Promotion never demotes. Removing an address from ADMIN_EMAILS leaves the
// role in place, so a typo in the env file can't lock the owner out. Revoke
// deliberately, with `pnpm user:admin <email> --revoke` or from the Users screen.

export const adminEmails = (): Set<string> =>
  new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean)
  );

// Bring one account's role in line with ADMIN_EMAILS. Called on every
// successful sign-in, so a designation added to the env file takes effect the
// next time that person signs in — no manual step.
export const syncAdminRole = async (
  user: UserInstance,
  transaction?: Transaction
): Promise<void> => {
  if (user.role === "admin") return;
  if (!adminEmails().has(user.email)) return;
  // The security of path 1. See the note at the top of the file.
  if (user.emailVerifiedAt === null) return;
  await user.update({ role: "admin" }, { transaction });
  console.log(`Promoted ${user.email} to admin (designated in ADMIN_EMAILS).`);
};

// The gate in front of the admin router. Mounted there with `app.use("*")`, so
// that router is closed by construction, the same way requireSession closes the
// API as a whole.
//
// It runs below requireSession, so there is always a signed-in user by the time
// it is reached: no session is a 401 from that gate, and a session without the
// role is a 403 from this one. The distinction is safe to expose — the client
// already knows its own role from /api/auth/me.
export const adminOnly: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (c.get("auth").user.role !== "admin") throw apiError(403, "forbidden");
  await next();
};
