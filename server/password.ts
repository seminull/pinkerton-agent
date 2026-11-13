import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

// Password hashing, in one place so the API and the create-user CLI can never
// disagree about the format.
//
// Argon2id from node:crypto (Node 24.7+) rather than an npm package: it is the
// same algorithm with no native addon to compile in the Docker build and no
// dependency to keep patched.

// OWASP's Argon2id guidance, on the generous side: 64 MiB, 3 passes. Memory is
// what makes a GPU guess expensive. It also means each concurrent login costs
// 64 MiB, which is why the login route is rate limited in front (see
// docker/nginx.conf) — raise this only alongside the API's memory ceiling.
const PARAMS = { memory: 65536, passes: 3, parallelism: 1 } as const;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

interface Argon2Params {
  memory: number;
  passes: number;
  parallelism: number;
}

const derive = (
  password: string,
  salt: Buffer,
  params: Argon2Params,
  tagLength: number
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      { message: password, nonce: salt, tagLength, ...params },
      (err, key) => (err ? reject(err) : resolve(Buffer.from(key)))
    );
  });

// The standard PHC string — `$argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>` —
// so every hash carries the parameters it was made with. That is what lets
// PARAMS be raised later without invalidating the passwords already stored.
const b64 = (value: Buffer): string => value.toString("base64").replace(/=+$/, "");

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, PARAMS, TAG_BYTES);
  const { memory, passes, parallelism } = PARAMS;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(salt)}$${b64(hash)}`;
};

const PHC_RE = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export const verifyPassword = async (
  password: string,
  stored: string
): Promise<boolean> => {
  const match = PHC_RE.exec(stored);
  // An unrecognised format is a failed login, not an exception: a corrupt row
  // must not turn the login route into a 500.
  if (!match) return false;
  const [, memory, passes, parallelism, salt, hash] = match;
  const expected = Buffer.from(hash!, "base64");
  const actual = await derive(
    password,
    Buffer.from(salt!, "base64"),
    {
      memory: Number(memory),
      passes: Number(passes),
      parallelism: Number(parallelism),
    },
    expected.length
  );
  // Constant-time, so the comparison can't leak how many leading bytes matched.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

// Bounds shared by every place a password is set. The upper limit is not about
// strength: hashing is deliberately slow, and an unbounded input turns the
// login form into a way to make the server burn CPU on megabytes of text.
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export const passwordProblem = (password: string): string | null =>
  password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH
    ? `Use ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters.`
    : null;
