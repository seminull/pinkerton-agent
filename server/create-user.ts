import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { normalizeEmail } from "./auth";
import { hashPassword, passwordProblem } from "./password";
import { sequelize, User } from "./sequelize/models";

// Create an account, or reset the password on an existing one.
//
//   pnpm user:create <email> [first name] [last name]
//
// There is no sign-up page, so this is how a password account comes to exist.
// Running it is the authorization: whoever has a shell on the server already
// has the database.
//
// The password is prompted for, or read from USER_PASSWORD when there is no
// terminal (a scripted run). Never an argument — those end up in shell history
// and in `ps` output for every other user on the machine.

const USAGE = "usage: pnpm user:create <email> [first name] [last name]";

const promptHidden = async (label: string): Promise<string> => {
  // readline echoes whatever it writes to `output`; swallowing those writes is
  // what keeps the password off the screen. The label is printed directly.
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stdout.write(label);
  try {
    return await rl.question("");
  } finally {
    rl.close();
    process.stdout.write("\n");
  }
};

const readPassword = async (): Promise<string> => {
  if (process.env.USER_PASSWORD) return process.env.USER_PASSWORD;
  if (!process.stdin.isTTY) {
    throw new Error("no terminal to prompt on — set USER_PASSWORD instead");
  }
  const first = await promptHidden("Password: ");
  const second = await promptHidden("Again:    ");
  if (first !== second) throw new Error("passwords did not match");
  return first;
};

const main = async (): Promise<void> => {
  const [rawEmail, firstName, lastName] = process.argv.slice(2);
  const email = normalizeEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(USAGE);

  const password = await readPassword();
  const problem = passwordProblem(password);
  if (problem) throw new Error(`password rejected: ${problem}`);
  const passwordHash = await hashPassword(password);

  const existing = await User.findOne({ where: { email } });
  if (existing) {
    // Re-running on an existing address is the password reset, and also how a
    // Google-only account gains a password. Names are left alone — the person
    // may have edited them since.
    await existing.update({ passwordHash });
    console.log(`Password set for existing account ${email}.`);
    return;
  }

  await User.create({
    email,
    passwordHash,
    // NOT NULL columns, so a bare `user:create sam@x.com` still works. The
    // local part is a better placeholder than a literal "User".
    firstName: firstName?.trim().slice(0, 80) || email.split("@")[0]!.slice(0, 80),
    lastName: lastName?.trim().slice(0, 80) || "",
    avatarUrl: null,
    role: "user",
    status: "active",
    // Typing an address here proves nothing about who owns it. A later Google
    // sign-in is what sets this.
    emailVerifiedAt: null,
    lastLoginAt: null,
  });
  console.log(`Created account ${email}.`);
};

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  // The pool holds the event loop open; without this the command never exits.
  .finally(() => sequelize.close());
