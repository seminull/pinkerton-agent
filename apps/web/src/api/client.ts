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

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    // The error body is JSON on every handled path, but a proxy or a crash can
    // still put HTML in front of us — treat an unparseable body as a generic
    // failure rather than throwing a SyntaxError from the error handler itself.
    const body = await res.json().catch(() => null);
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
