export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  stage: string;
  type: string;
}

export interface ContactListResponse {
  results: Contact[];
  total: number;
}

export interface MobileSettings {
  apiBaseUrl: string;
  syncToken: string;
  deviceId: string;
}

export interface ContactLink {
  contactId: string;
  phoneNumber: string;
}

export interface LastSyncSummary {
  completedAt: string;
  matched: number;
  accepted: number;
  duplicates: number;
}
