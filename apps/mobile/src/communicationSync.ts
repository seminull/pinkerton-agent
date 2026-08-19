import { PermissionsAndroid, Platform } from "react-native";
import PinkertonCommunications from "../modules/pinkerton-communications";
import type { SmsSyncResult } from "../modules/pinkerton-communications";
import {
  loadContactLinks,
  loadSettings,
  loadSmsCursor,
  saveLastSync,
  saveSmsCursor,
} from "./storage";
import type { ContactLink, LastSyncSummary, MobileSettings } from "./types";

export const nativeSmsSyncAvailable =
  Platform.OS === "android" && PinkertonCommunications !== null;

export const hasSmsPermissions = async (): Promise<boolean> => {
  if (Platform.OS !== "android") return false;
  const [read, receive] = await Promise.all([
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS),
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS),
  ]);
  return read && receive;
};

export const requestSmsPermissions = async (): Promise<boolean> => {
  if (Platform.OS !== "android") return false;
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.READ_SMS,
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
  ]);
  return (
    result[PermissionsAndroid.PERMISSIONS.READ_SMS] ===
      PermissionsAndroid.RESULTS.GRANTED &&
    result[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] ===
      PermissionsAndroid.RESULTS.GRANTED
  );
};

export const configureNativeSync = async (
  settings: MobileSettings,
  links: ContactLink[]
): Promise<void> => {
  if (!PinkertonCommunications) return;
  if (!settings.apiBaseUrl || !settings.syncToken || links.length === 0) {
    await PinkertonCommunications.clearConfiguration();
    return;
  }
  await PinkertonCommunications.configure(
    settings.apiBaseUrl,
    settings.syncToken,
    settings.deviceId,
    links
  );
};

export const syncNow = async (
  settings?: MobileSettings,
  links?: ContactLink[]
): Promise<LastSyncSummary> => {
  if (!PinkertonCommunications) {
    throw new Error("Install the Pinkerton development build to enable SMS sync.");
  }
  const activeSettings = settings ?? (await loadSettings());
  const activeLinks = links ?? (await loadContactLinks());
  if (!activeSettings.apiBaseUrl || !activeSettings.syncToken) {
    throw new Error("Save the server URL and mobile sync token first.");
  }
  if (activeLinks.length === 0) {
    throw new Error("Opt in at least one contact first.");
  }
  if (!(await hasSmsPermissions())) {
    throw new Error("SMS permission has not been granted.");
  }

  await configureNativeSync(activeSettings, activeLinks);
  const cursor = await loadSmsCursor();
  const result: SmsSyncResult =
    await PinkertonCommunications.syncSmsSince(cursor);
  await saveSmsCursor(result.nextCursor);
  const summary: LastSyncSummary = {
    completedAt: new Date().toISOString(),
    matched: result.matched,
    accepted: result.accepted,
    duplicates: result.duplicates,
  };
  await saveLastSync(summary);
  return summary;
};
