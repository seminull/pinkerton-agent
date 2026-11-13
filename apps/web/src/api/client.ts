// Same-origin by design: Vite proxies /api in dev and a reverse proxy will do
// it in production. Never point this at an absolute origin — that URL would be
// resolved by the visitor's browser, on their machine, not by the server.
export const API_BASE = "/api";

// A failed request needs to carry the status through to the UI, otherwise the
// components can't tell "not found" from "the database is down".
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, string>
  ) {
    super(code);
    this.name = "ApiError";
  }
}

// Fired when a data request comes back 401 — the session expired, was revoked,
// or the account was disabled while the app was open. AuthProvider listens and
// drops back to the login screen. An event rather than an import because this
// module sits underneath the auth code, not above it.
export const UNAUTHORIZED_EVENT = "pinkerton:unauthorized";

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  // The browser must supply multipart/form-data's boundary itself. Setting a
  // generic content type on FormData produces an unreadable upload body.
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    // The error body is JSON on every handled path, but a proxy or a crash can
    // still put HTML in front of us — treat an unparseable body as a generic
    // failure rather than throwing a SyntaxError from the error handler itself.
    const body = await res.json().catch(() => null);
    // Not for /auth/*: a 401 from the login form means "wrong password", which
    // the form reports itself — it is not a session ending.
    if (res.status === 401 && !path.startsWith("/auth/")) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(
      res.status,
      body?.error ?? `http_${res.status}`,
      body?.details
    );
  }

  // 204 has no body; calling .json() on it throws.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
};

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  postForm: <T>(path: string, body: FormData) =>
    request<T>(path, { method: "POST", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// Build a query string, dropping empty values so the API sees an absent filter
// rather than `?stage=` (which would match nothing).
export const queryString = (
  params: Record<string, string | number | undefined | null>
): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
};
