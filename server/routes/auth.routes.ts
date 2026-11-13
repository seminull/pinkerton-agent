import { Hono, type Context } from "hono";
import {
  allowedEmails,
  authenticatedRequest,
  issueSession,
  newOauthSecret,
  normalizeEmail,
  oauthCookie,
  publicUser,
  revokeCurrentSession,
  sha256Base64Url,
} from "../auth";
import { syncAdminRole } from "../admin";
import { apiError } from "../http";
import { hashPassword, MAX_PASSWORD_LENGTH, verifyPassword } from "../password";
import { AuthIdentity, sequelize, User } from "../sequelize/models";

// Mounted at /api/auth, ABOVE the session gate in server/index.ts — these are
// the routes a signed-out visitor has to be able to reach.
//
// There is deliberately no register route. Accounts come from exactly two
// places: the create-user CLI, and a first Google sign-in by an address listed
// in AUTH_ALLOWED_EMAILS.

const app = new Hono();

const MAX_EMAIL_LENGTH = 254;
const GOOGLE_STATE_COOKIE = "pinkerton_google_state";
const GOOGLE_VERIFIER_COOKIE = "pinkerton_google_verifier";
const PROVIDER_TIMEOUT_MS = 10_000;

// All three or nothing. A half-configured provider would fail halfway through
// someone's sign-in, so it is reported as simply unavailable instead.
const googleConfig = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  return clientId && clientSecret && redirectUri
    ? { clientId, clientSecret, redirectUri }
    : null;
};

const normalizeName = (value: unknown): string =>
  typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : "";

const validEmail = (email: string): boolean =>
  email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// The OAuth callback is a browser navigation, not a fetch, so it can't answer
// with a JSON error — nobody would see it. It lands the visitor back on the
// login screen with a code the page turns into a sentence.
const backToLogin = (c: Context, code: string) =>
  c.redirect(`/?auth_error=${encodeURIComponent(code)}`);

// GET /api/auth/me
// 200 with `user: null` when signed out, not a 401: "nobody is signed in" is
// the normal answer the login screen is built from, not an error.
app.get("/me", async (c) => {
  const auth = await authenticatedRequest(c);
  return c.json({
    user: auth ? publicUser(auth.user) : null,
    // Lets the login screen offer only the buttons that will actually work.
    providers: { google: googleConfig() !== null },
  });
});

// Verifying against this when the account doesn't exist (or has no password)
// keeps both failures as slow as a real wrong password. Without it, response
// time alone tells an attacker which addresses have accounts.
let decoyHash: Promise<string> | undefined;
const burnTime = async (password: string): Promise<void> => {
  decoyHash ??= hashPassword("not-a-real-password");
  await verifyPassword(password, await decoyHash);
};

// POST /api/auth/login  { email, password }
app.post("/login", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  const fields =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const email = normalizeEmail(fields.email);
  const password = typeof fields.password === "string" ? fields.password : "";

  // One error for every way this can fail — unknown address, wrong password,
  // Google-only account, disabled account. Distinguishing them would confirm
  // to a stranger which addresses are real.
  const rejected = apiError(401, "invalid_credentials");
  if (!validEmail(email) || !password || password.length > MAX_PASSWORD_LENGTH) {
    throw rejected;
  }

  const user = await User.findOne({ where: { email } });
  if (!user?.passwordHash) {
    await burnTime(password);
    throw rejected;
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid || user.status !== "active") throw rejected;

  await sequelize.transaction(async (transaction) => {
    await user.update({ lastLoginAt: new Date() }, { transaction });
    // Only ever promotes an account whose email is already verified, so a
    // password sign-in alone can't earn the role — see server/admin.ts.
    await syncAdminRole(user, transaction);
    await issueSession(c, user.id, transaction);
  });
  return c.json({ user: publicUser(user) });
});

// POST /api/auth/logout
// Succeeds whether or not there was a session: signing out twice is not an error.
app.post("/logout", async (c) => {
  await revokeCurrentSession(c);
  return c.body(null, 204);
});

// GET /api/auth/google/start
// Authorization-code flow with `state` (so the callback can prove this browser
// started it) and PKCE (so an intercepted code is useless without the verifier
// held in this browser's cookie).
app.get("/google/start", (c) => {
  const config = googleConfig();
  if (!config) throw apiError(503, "google_not_configured");

  const state = newOauthSecret();
  const verifier = newOauthSecret();
  oauthCookie.set(c, GOOGLE_STATE_COOKIE, state);
  oauthCookie.set(c, GOOGLE_VERIFIER_COOKIE, verifier);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    // Identity only. No Gmail, Calendar, or Drive scope is requested here;
    // those integrations get their own consent when they are built.
    scope: "openid email profile",
    state,
    code_challenge: sha256Base64Url(verifier),
    code_challenge_method: "S256",
    access_type: "online",
    // Always show the account chooser: agents commonly have a personal and a
    // brokerage Google account, and silently reusing the wrong one is a
    // confusing way to be told "not invited".
    prompt: "select_account",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

interface GoogleProfile {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

// Trade the one-time code for the visitor's profile. Returns null on any
// provider-side failure, including a timeout or a network error, so the
// callback has a single "Google didn't cooperate" branch.
const fetchGoogleProfile = async (
  config: NonNullable<ReturnType<typeof googleConfig>>,
  code: string,
  verifier: string
): Promise<GoogleProfile | null> => {
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!tokenResponse.ok) return null;
    const tokens = (await tokenResponse.json()) as { access_token?: string };
    if (!tokens.access_token) return null;

    const profileResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: { authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      }
    );
    if (!profileResponse.ok) return null;
    // The access token goes out of scope here and is never stored.
    return (await profileResponse.json()) as GoogleProfile;
  } catch (err) {
    console.error("google sign-in: provider request failed:", err);
    return null;
  }
};

// GET /api/auth/google/callback
app.get("/google/callback", async (c) => {
  const config = googleConfig();
  const expectedState = oauthCookie.get(c, GOOGLE_STATE_COOKIE);
  const verifier = oauthCookie.get(c, GOOGLE_VERIFIER_COOKIE);
  const state = c.req.query("state");
  const code = c.req.query("code");
  // Single use: cleared before anything can fail, so a replayed callback URL
  // finds no state to match.
  oauthCookie.clear(c, GOOGLE_STATE_COOKIE);
  oauthCookie.clear(c, GOOGLE_VERIFIER_COOKIE);

  // The visitor pressed Cancel on Google's screen.
  if (c.req.query("error")) return backToLogin(c, "google_denied");
  if (!config || !expectedState || state !== expectedState || !verifier || !code) {
    return backToLogin(c, "google_invalid");
  }

  const profile = await fetchGoogleProfile(config, code, verifier);
  if (!profile) return backToLogin(c, "google_unavailable");

  const email = normalizeEmail(profile.email);
  const subject = profile.sub;
  // email_verified is what makes it safe to match an existing account by
  // address below. Without it, anyone could claim someone else's email at a
  // provider and be handed their account.
  if (!subject || !validEmail(email) || profile.email_verified !== true) {
    return backToLogin(c, "google_unverified");
  }

  const outcome = await sequelize.transaction(async (transaction) => {
    const identity = await AuthIdentity.findOne({
      where: { provider: "google", providerUserId: subject },
      transaction,
    });
    // A returning Google account is found by its subject id, so it keeps
    // working even after the person changes their address at Google. A first
    // sign-in falls back to the email, which is how an account pre-created
    // with the CLI gets its Google identity attached.
    let account = identity
      ? await User.findByPk(identity.userId, { transaction })
      : await User.findOne({ where: { email }, transaction });

    if (!account) {
      if (!allowedEmails().has(email)) return "not_invited" as const;
      account = await User.create(
        {
          email,
          passwordHash: null,
          firstName: normalizeName(profile.given_name).slice(0, 80) || "Google",
          lastName: normalizeName(profile.family_name).slice(0, 80) || "User",
          avatarUrl: profile.picture?.slice(0, 2000) || null,
          role: "user",
          status: "active",
          emailVerifiedAt: new Date(),
          lastLoginAt: new Date(),
        },
        { transaction }
      );
    }
    if (account.status !== "active") return "account_disabled" as const;

    if (identity) {
      await identity.update({ lastUsedAt: new Date() }, { transaction });
    } else {
      await AuthIdentity.create(
        {
          userId: account.id,
          provider: "google",
          providerUserId: subject,
          providerEmail: email,
          profile: {
            givenName: profile.given_name,
            familyName: profile.family_name,
            picture: profile.picture,
          },
          lastUsedAt: new Date(),
        },
        { transaction }
      );
    }
    await account.update(
      {
        lastLoginAt: new Date(),
        emailVerifiedAt: account.emailVerifiedAt ?? new Date(),
        avatarUrl: account.avatarUrl ?? profile.picture?.slice(0, 2000) ?? null,
      },
      { transaction }
    );
    // After the update above, so a first-ever Google sign-in already counts as
    // verified when the designation is checked.
    await syncAdminRole(account, transaction);
    await issueSession(c, account.id, transaction);
    return "ok" as const;
  });

  return outcome === "ok" ? c.redirect("/") : backToLogin(c, outcome);
});

export default app;
