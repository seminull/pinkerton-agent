import { createHash, randomBytes } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Op, type Transaction } from "sequelize";
import { apiError } from "./http";
import {
  User,
  UserSession,
  type UserInstance,
  type UserSessionInstance,
} from "./sequelize/models";
import type { AuthUser } from "./types";

// Sessions: an opaque random token in an HttpOnly cookie, looked up by its hash
// on every request. Server-side rather than a signed JWT because a CRM needs
// sign-out and "disable this account" to take effect immediately, and a
// stateless token can't be revoked before it expires.

const SESSION_COOKIE = "pinkerton_session";
const SESSION_DAYS = 30;
const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60;
// lastSeenAt is for "is this session still in use", not an audit trail — one
// write per quarter hour answers that without a database write on every request.
const SESSION_TOUCH_INTERVAL_MS = 15 * 60 * 1000;

// What the client is told about the signed-in user. A projection, never the
// row: passwordHash must not be one careless `c.json(user)` away from the wire.
export const publicUser = (user: UserInstance): AuthUser => ({
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  avatarUrl: user.avatarUrl,
  role: user.role === "admin" ? "admin" : "user",
});

// Secure cookies are only sent over https, which is right in production and
// breaks plain-http local development — hence the NODE_ENV default.
// AUTH_COOKIE_SECURE overrides it for the one awkward case: a production build
// reached over http on a LAN, where the browser would silently drop the cookie.
const secureCookies = (): boolean => {
  const explicit = process.env.AUTH_COOKIE_SECURE;
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return process.env.NODE_ENV === "production";
};

const cookieOptions = () => ({
  // Not readable from JavaScript, so an XSS bug can't walk off with a session.
  httpOnly: true,
  secure: secureCookies(),
  // Lax is the CSRF control: the browser withholds the cookie from cross-site
  // POST/PATCH/DELETE, while still sending it on the top-level redirect back
  // from Google that completes a sign-in (Strict would drop it there).
  sameSite: "Lax" as const,
  path: "/",
});

const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const sha256Base64Url = (value: string): string =>
  createHash("sha256").update(value).digest("base64url");

export const issueSession = async (
  c: Context,
  userId: string,
  transaction?: Transaction
): Promise<void> => {
  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);

  await UserSession.create(
    {
      userId,
      tokenHash: sha256Hex(token),
      // Bounded to the column width — a header is attacker-controlled length.
      userAgent: c.req.header("user-agent")?.slice(0, 500) || null,
      lastSeenAt: now,
      expiresAt,
      revokedAt: null,
    },
    { transaction }
  );

  setCookie(c, SESSION_COOKIE, token, {
    ...cookieOptions(),
    maxAge: SESSION_MAX_AGE_SECONDS,
    expires: expiresAt,
  });
};

const clearSessionCookie = (c: Context): void => {
  deleteCookie(c, SESSION_COOKIE, cookieOptions());
};

export interface AuthenticatedRequest {
  user: UserInstance;
  session: UserSessionInstance;
}

// Resolve the request's cookie to a live session and an active user, or null.
// Every failure mode — no cookie, unknown token, expired, revoked, disabled
// account — collapses to the same null, so a caller can't accidentally treat a
// half-valid session as signed in.
export const authenticatedRequest = async (
  c: Context
): Promise<AuthenticatedRequest | null> => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;

  const session = await UserSession.findOne({
    where: {
      tokenHash: sha256Hex(token),
      revokedAt: null,
      expiresAt: { [Op.gt]: new Date() },
    },
  });
  if (!session) {
    clearSessionCookie(c);
    return null;
  }

  const user = await User.findByPk(session.userId);
  if (!user || user.status !== "active") {
    // Disabling an account has to end its sessions now, not at expiry.
    await session.update({ revokedAt: new Date() });
    clearSessionCookie(c);
    return null;
  }

  if (Date.now() - new Date(session.lastSeenAt).getTime() > SESSION_TOUCH_INTERVAL_MS) {
    await session.update({ lastSeenAt: new Date() });
  }

  return { user, session };
};

/** Hono env for everything mounted behind `requireSession`. */
export interface AuthEnv {
  Variables: { auth: AuthenticatedRequest };
}

// The gate. Mounted once in server/index.ts with `app.use("/api/*", ...)`,
// above every resource router, so the API is closed by construction: a route
// added later is protected whether or not its author thought about auth.
export const requireSession: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const auth = await authenticatedRequest(c);
  if (!auth) throw apiError(401, "authentication_required");
  c.set("auth", auth);
  await next();
};

export const revokeCurrentSession = async (c: Context): Promise<void> => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await UserSession.update(
      { revokedAt: new Date() },
      { where: { tokenHash: sha256Hex(token), revokedAt: null } }
    );
  }
  clearSessionCookie(c);
};

// Short-lived cookies that carry the OAuth `state` and PKCE verifier across the
// round trip to the provider. Ten minutes is long enough to pick an account and
// short enough that an abandoned attempt doesn't linger.
export const oauthCookie = {
  set(c: Context, name: string, value: string): void {
    setCookie(c, name, value, { ...cookieOptions(), maxAge: 10 * 60 });
  },
  get(c: Context, name: string): string | undefined {
    return getCookie(c, name);
  },
  clear(c: Context, name: string): void {
    deleteCookie(c, name, cookieOptions());
  },
};

export const newOauthSecret = (): string => randomToken(48);

// --- who may have an account ----------------------------------------------

export const normalizeEmail = (value: unknown): string =>
  typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";

// This is a private CRM, not a product with a sign-up page. Without a list,
// "Continue with Google" would hand the whole book of business to anyone with
// a Google account. AUTH_ALLOWED_EMAILS names the addresses that may create an
// account by signing in; everyone else is turned away at the callback.
//
// It governs account *creation* only. Removing an address later does not lock
// out an account that already exists — disable the account for that — so a
// typo in the env file can't lock you out of your own CRM.
export const allowedEmails = (): Set<string> =>
  new Set(
    (process.env.AUTH_ALLOWED_EMAILS ?? "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean)
  );
