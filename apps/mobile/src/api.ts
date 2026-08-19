import type { Contact, ContactListResponse } from "./types";

const requireApiBaseUrl = (value: string): string => {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error("Enter a complete server URL beginning with http:// or https://.");
  }
  return normalized;
};

export const fetchContacts = async (apiBaseUrl: string): Promise<Contact[]> => {
  const root = requireApiBaseUrl(apiBaseUrl);
  const apiRoot = root.endsWith("/api") ? root : `${root}/api`;
  const response = await fetch(`${apiRoot}/contacts?limit=100`);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `Server returned HTTP ${response.status}.`);
  }
  const body = (await response.json()) as ContactListResponse;
  return body.results;
};
