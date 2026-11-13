import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { ConnectionError } from "sequelize";
import { requireSession, type AuthEnv } from "./auth";
import { sequelize } from "./sequelize/models";
import authRoutes from "./routes/auth.routes";
import contactRoutes from "./routes/contacts.routes";
import listingRoutes from "./routes/listings.routes";
import activityRoutes from "./routes/activities.routes";

const port = parseInt(process.env.PORT ?? "", 10) || 3040;

const HEALTH_CHECK_TIMEOUT_MS = 5000;

// Bound the dependency check so a hung database can't hang the monitor that is
// probing us — a health endpoint that never answers is worse than a red one.
const withTimeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} health check timed out`)),
        HEALTH_CHECK_TIMEOUT_MS
      )
    ),
  ]);

const app = new Hono<AuthEnv>();

// Final safety net: an unhandled route error must never reach the browser as a
// plain-text 500, because the client can't parse that into an error message.
app.onError((err, c) => {
  // Deliberate errors from routes already carry a JSON body (see apiError in
  // server/http.ts), so they pass straight through.
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error(`${c.req.method} ${c.req.path} failed:`, err);
  // A dead database is an outage, not a bug — report it as one. ConnectionError
  // is the base of every Sequelize connection failure (refused, host not found,
  // pool acquire timeout, ...).
  if (err instanceof ConnectionError) {
    return c.json({ error: "database_unavailable" }, 503);
  }
  return c.json({ error: "internal_error" }, 500);
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

// One line in/out per request (method, path, status, duration) to stdout — the
// container's json-file driver handles retention (caps in docker-compose.yml).
app.use(logger());

// Production traffic will be same-origin behind a reverse proxy, and dev goes
// through the Vite proxy, so a cross-origin caller is never a legitimate
// browser. An allowlist rather than a wildcard keeps arbitrary websites from
// firing CRM requests from a signed-in agent's browser.
const ALLOWED_ORIGINS = [
  // Vite dev server, for anyone pointing the client straight at the API.
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];

app.use("/api/*", cors({ origin: ALLOWED_ORIGINS, credentials: true }));

// Liveness + dependency health, for uptime monitors and container healthchecks.
// 200 only when the database can actually serve traffic; 503 otherwise.
app.get("/api/health", async (c) => {
  const pg = await withTimeout(sequelize.authenticate(), "postgres").then(
    () => true,
    (err: unknown) => {
      console.error("health check: postgres unreachable:", err);
      return false;
    }
  );

  return c.json(
    { status: pg ? "ok" : "degraded", postgres: pg ? "up" : "down" },
    pg ? 200 : 503
  );
});

// Sign-in itself has to be reachable signed out, so it is mounted above the gate.
app.route("/api/auth", authRoutes);

// ---- the gate ------------------------------------------------------------
// Hono runs middleware in registration order, so everything mounted BELOW this
// line requires a session and everything above it (health, auth) does not.
// Add new resource routers below. Putting one above is a decision to make it
// public — the position is the access control.
app.use("/api/*", requireSession);

app.route("/api/contacts", contactRoutes);
app.route("/api/listings", listingRoutes);
app.route("/api/activities", activityRoutes);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Running at http://localhost:${info.port}`);
});
