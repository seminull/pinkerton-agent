import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type {
  ContactLink,
  LastSyncSummary,
  MobileSettings,
} from "./types";

const KEYS = {
  apiBaseUrl: "pinkerton.apiBaseUrl",
  deviceId: "pinkerton.deviceId",
  contactLinks: "pinkerton.contactLinks",
  smsCursor: "pinkerton.smsCursor",
  disclosureAccepted: "pinkerton.smsDisclosureAccepted",
  lastSync: "pinkerton.lastSync",
} as const;
const SYNC_TOKEN_KEY = "pinkerton.mobileSyncToken";

const createDeviceId = (): string =>
  `android-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export const loadSettings = async (): Promise<MobileSettings> => {
  const [apiBaseUrl, storedDeviceId, syncToken] = await Promise.all([
    AsyncStorage.getItem(KEYS.apiBaseUrl),
    AsyncStorage.getItem(KEYS.deviceId),
    SecureStore.getItemAsync(SYNC_TOKEN_KEY),
  ]);
  const deviceId = storedDeviceId ?? createDeviceId();
  if (!storedDeviceId) await AsyncStorage.setItem(KEYS.deviceId, deviceId);
  return {
    apiBaseUrl: apiBaseUrl ?? process.env.EXPO_PUBLIC_API_URL ?? "",
    syncToken: syncToken ?? "",
    deviceId,
  };
};

export const saveSettings = async (settings: MobileSettings): Promise<void> => {
  await Promise.all([
    AsyncStorage.setItem(KEYS.apiBaseUrl, settings.apiBaseUrl.trim().replace(/\/+$/, "")),
    AsyncStorage.setItem(KEYS.deviceId, settings.deviceId),
    SecureStore.setItemAsync(SYNC_TOKEN_KEY, settings.syncToken),
  ]);
};

export const loadContactLinks = async (): Promise<ContactLink[]> => {
  const raw = await AsyncStorage.getItem(KEYS.contactLinks);
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as ContactLink[]) : [];
  } catch {
    return [];
  }
};

export const saveContactLinks = (links: ContactLink[]): Promise<void> =>
  AsyncStorage.setItem(KEYS.contactLinks, JSON.stringify(links));

export const loadSmsCursor = async (): Promise<number> => {
  const raw = await AsyncStorage.getItem(KEYS.smsCursor);
  const value = Number(raw);
  // The first sweep intentionally starts 24 hours back. Importing an entire
  // phone history by surprise would violate the narrow opt-in the UI promises.
  return Number.isFinite(value) && value > 0
    ? value
    : Date.now() - 24 * 60 * 60 * 1_000;
};

export const saveSmsCursor = (cursor: number): Promise<void> =>
  AsyncStorage.setItem(KEYS.smsCursor, String(cursor));

export const hasAcceptedSmsDisclosure = async (): Promise<boolean> =>
  (await AsyncStorage.getItem(KEYS.disclosureAccepted)) === "true";

export const acceptSmsDisclosure = (): Promise<void> =>
  AsyncStorage.setItem(KEYS.disclosureAccepted, "true");

export const loadLastSync = async (): Promise<LastSyncSummary | null> => {
  const raw = await AsyncStorage.getItem(KEYS.lastSync);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastSyncSummary;
  } catch {
    return null;
  }
};

export const saveLastSync = (summary: LastSyncSummary): Promise<void> =>
  AsyncStorage.setItem(KEYS.lastSync, JSON.stringify(summary));
