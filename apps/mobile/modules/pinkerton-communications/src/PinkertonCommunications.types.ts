export interface ContactSyncLink {
  contactId: string;
  phoneNumber: string;
}

export interface SmsSyncResult {
  examined: number;
  matched: number;
  accepted: number;
  duplicates: number;
  nextCursor: number;
}

export interface PinkertonCommunicationsNativeModule {
  configure(
    apiBaseUrl: string,
    syncToken: string,
    deviceId: string,
    links: ContactSyncLink[]
  ): Promise<{ configuredContacts: number }>;
  clearConfiguration(): Promise<void>;
  syncSmsSince(sinceEpochMillis: number): Promise<SmsSyncResult>;
}
