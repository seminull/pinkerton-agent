import { normalizeEmail } from "./auth";
import { sequelize, User } from "./sequelize/models";

// Grant or revoke the admin role from the server shell.
//
//   pnpm user:admin <email>            grant
//   pnpm user:admin <email> --revoke   take it back
//   pnpm user:admin --list             who holds it
//
// The escape hatch beside ADMIN_EMAILS (see server/admin.ts). That path refuses
// to promote an account whose email isn't verified; this one has no such
// condition, because running a command on the server is the authorization.
// It is how the first admin is made, and how you get back in if the last admin
// is ever disabled.

const USAGE =
  "usage: pnpm user:admin <email> [--revoke]\n       pnpm user:admin --list";

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const revoke = args.includes("--revoke");

  if (args.includes("--list")) {
    const admins = await User.findAll({ where: { role: "admin" }, order: [["email", "ASC"]] });
    if (admins.length === 0) {
      console.log("No admin accounts.");
      return;
    }
    for (const admin of admins) {
      // A disabled admin holds the role but can't use it — worth seeing here,
      // since "one admin" that is disabled is really zero.
      console.log(`${admin.email}  (${admin.status})`);
    }
    return;
  }

  const email = normalizeEmail(args.find((arg) => !arg.startsWith("--")));
  if (!email.includes("@")) throw new Error(USAGE);

  const user = await User.findOne({ where: { email } });
  if (!user) {
    throw new Error(`No account with email ${email}. Create it first: pnpm user:create ${email}`);
  }

  const role = revoke ? "user" : "admin";
  if (user.role === role) {
    console.log(`${email} is already ${role === "admin" ? "an admin" : "a regular user"}.`);
    return;
  }
  await user.update({ role });
  console.log(`${email} is now ${role === "admin" ? "an admin" : "a regular user"}.`);
};

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  // The pool holds the event loop open; without this the command never exits.
  .finally(() => sequelize.close());
