import { StatusBar } from "expo-status-bar";
import * as Contacts from "expo-contacts";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { fetchContacts } from "./src/api";
import { registerSmsBackgroundSync } from "./src/background";
import {
  configureNativeSync,
  hasSmsPermissions,
  nativeSmsSyncAvailable,
  requestSmsPermissions,
  syncNow,
} from "./src/communicationSync";
import { displayPhone, normalizePhone } from "./src/phone";
import {
  acceptSmsDisclosure,
  hasAcceptedSmsDisclosure,
  loadContactLinks,
  loadLastSync,
  loadSettings,
  saveContactLinks,
  saveSettings,
} from "./src/storage";
import type {
  Contact,
  ContactLink,
  LastSyncSummary,
  MobileSettings,
} from "./src/types";

const COLORS = {
  ink: "#172018",
  muted: "#657066",
  background: "#F3F1E8",
  surface: "#FFFEF9",
  line: "#D9D8CE",
  forest: "#244D34",
  forestSoft: "#E1EADF",
  gold: "#B37B24",
  danger: "#A44235",
  white: "#FFFFFF",
};

const EMPTY_SETTINGS: MobileSettings = {
  apiBaseUrl: "",
  syncToken: "",
  deviceId: "",
};

function ActionButton({
  label,
  onPress,
  variant = "primary",
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "secondary" && styles.buttonSecondary,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          variant === "secondary" && styles.buttonSecondaryText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "good" | "warn" | "neutral";
}) {
  return (
    <View
      style={[
        styles.pill,
        tone === "good" && styles.pillGood,
        tone === "warn" && styles.pillWarn,
      ]}
    >
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

function CompanionApp() {
  const [settings, setSettings] = useState<MobileSettings>(EMPTY_SETTINGS);
  const [links, setLinks] = useState<ContactLink[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [devicePhones, setDevicePhones] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [booting, setBooting] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [smsGranted, setSmsGranted] = useState(false);
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [lastSync, setLastSync] = useState<LastSyncSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedIds = useMemo(
    () => new Set(links.map((link) => link.contactId)),
    [links]
  );

  const filteredContacts = useMemo(() => {
    const term = query.trim().toLowerCase();
    return contacts
      .filter((contact) => contact.phone)
      .filter((contact) =>
        term
          ? `${contact.firstName} ${contact.lastName} ${contact.phone}`
              .toLowerCase()
              .includes(term)
          : true
      );
  }, [contacts, query]);

  const loadDeviceContactPhones = useCallback(async (ask = false) => {
    const permission = ask
      ? await Contacts.requestPermissionsAsync()
      : await Contacts.getPermissionsAsync();
    if (permission.status !== "granted") return;
    const response = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers],
      pageSize: 10_000,
    });
    const numbers = new Set<string>();
    response.data.forEach((contact) =>
      contact.phoneNumbers?.forEach((phone) => {
        if (phone.number) numbers.add(normalizePhone(phone.number));
      })
    );
    setDevicePhones(numbers);
  }, []);

  const refreshContacts = useCallback(
    async (apiBaseUrl = settings.apiBaseUrl) => {
      if (!apiBaseUrl) return;
      setError(null);
      const result = await fetchContacts(apiBaseUrl);
      setContacts(result);
    },
    [settings.apiBaseUrl]
  );

  useEffect(() => {
    void (async () => {
      try {
        const [storedSettings, storedLinks, permission, storedLastSync] =
          await Promise.all([
            loadSettings(),
            loadContactLinks(),
            hasSmsPermissions(),
            loadLastSync(),
          ]);
        setSettings(storedSettings);
        setLinks(storedLinks);
        setSmsGranted(permission);
        setLastSync(storedLastSync);
        await loadDeviceContactPhones(false);
        if (storedSettings.apiBaseUrl) {
          await refreshContacts(storedSettings.apiBaseUrl);
        }
        if (nativeSmsSyncAvailable) {
          await configureNativeSync(storedSettings, storedLinks);
          if (permission && storedLinks.length > 0) {
            await registerSmsBackgroundSync();
          }
        }
      } catch (bootstrapError) {
        setError(
          bootstrapError instanceof Error
            ? bootstrapError.message
            : "Companion setup failed."
        );
      } finally {
        setBooting(false);
      }
    })();
  }, [loadDeviceContactPhones, refreshContacts]);

  const onSaveConnection = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (!settings.syncToken.trim()) throw new Error("Enter the mobile sync token.");
      const normalized = {
        ...settings,
        apiBaseUrl: settings.apiBaseUrl.trim().replace(/\/+$/, ""),
        syncToken: settings.syncToken.trim(),
      };
      await saveSettings(normalized);
      await refreshContacts(normalized.apiBaseUrl);
      await configureNativeSync(normalized, links);
      setSettings(normalized);
      setNotice("Server connected and contact list refreshed.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Couldn't save the connection."
      );
    } finally {
      setSaving(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await Promise.all([
        refreshContacts(),
        loadDeviceContactPhones(false),
      ]);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Couldn't refresh contacts."
      );
    } finally {
      setRefreshing(false);
    }
  };

  const onToggleContact = async (contact: Contact, selected: boolean) => {
    if (!contact.phone) return;
    const next = selected
      ? [
          ...links.filter((link) => link.contactId !== contact.id),
          { contactId: contact.id, phoneNumber: contact.phone },
        ]
      : links.filter((link) => link.contactId !== contact.id);
    setLinks(next);
    setError(null);
    try {
      await saveContactLinks(next);
      await configureNativeSync(settings, next);
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Couldn't update contact sync."
      );
    }
  };

  const beginSmsPermissionFlow = async () => {
    if (!nativeSmsSyncAvailable) {
      Alert.alert(
        "Development build required",
        "Expo Go can show this setup UI, but the Pinkerton development build is required for Android SMS access."
      );
      return;
    }
    if (await hasAcceptedSmsDisclosure()) {
      await grantSmsPermissions();
    } else {
      setShowDisclosure(true);
    }
  };

  const grantSmsPermissions = async () => {
    setShowDisclosure(false);
    setError(null);
    try {
      const granted = await requestSmsPermissions();
      setSmsGranted(granted);
      if (!granted) {
        throw new Error(
          "SMS access was not granted. Pinkerton will not read or upload messages."
        );
      }
      await configureNativeSync(settings, links);
      await registerSmsBackgroundSync();
      setNotice("SMS sync is enabled for opted-in contacts only.");
    } catch (permissionError) {
      setError(
        permissionError instanceof Error
          ? permissionError.message
          : "Couldn't enable SMS sync."
      );
    }
  };

  const acceptDisclosureAndContinue = async () => {
    await acceptSmsDisclosure();
    await grantSmsPermissions();
  };

  const onSyncNow = async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const summary = await syncNow(settings, links);
      setLastSync(summary);
      setNotice(
        summary.accepted > 0
          ? `${summary.accepted} new message${summary.accepted === 1 ? "" : "s"} synced.`
          : "Sync is current."
      );
    } catch (syncError) {
      setError(
        syncError instanceof Error ? syncError.message : "SMS sync failed."
      );
    } finally {
      setSyncing(false);
    }
  };

  if (booting) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={COLORS.forest} />
        <Text style={styles.loadingText}>Opening your field notebook…</Text>
      </SafeAreaView>
    );
  }

  const serverReady = Boolean(settings.apiBaseUrl && settings.syncToken);
  const ready = serverReady && nativeSmsSyncAvailable && smsGranted && links.length > 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.masthead}>
          <Text style={styles.eyebrow}>PINKERTON AGENT</Text>
          <Text style={styles.title}>Companion</Text>
          <Text style={styles.subtitle}>
            A private bridge between your phone and the contact record.
          </Text>
        </View>

        <View style={[styles.card, styles.statusCard]}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardLabel}>SYNC STATUS</Text>
              <Text style={styles.statusTitle}>
                {ready ? "Watching selected contacts" : "Setup needs attention"}
              </Text>
            </View>
            <StatusPill
              label={ready ? "Active" : "Not active"}
              tone={ready ? "good" : "warn"}
            />
          </View>
          <View style={styles.statusGrid}>
            <Text style={styles.statusLine}>
              {nativeSmsSyncAvailable ? "✓" : "○"} Development build
            </Text>
            <Text style={styles.statusLine}>{serverReady ? "✓" : "○"} Server</Text>
            <Text style={styles.statusLine}>{smsGranted ? "✓" : "○"} SMS access</Text>
            <Text style={styles.statusLine}>
              {links.length > 0 ? "✓" : "○"} {links.length} opted in
            </Text>
          </View>
          {!nativeSmsSyncAvailable && (
            <Text style={styles.helpText}>
              You are in Expo Go. Contact setup works here; message watching starts
              after installing the custom development build.
            </Text>
          )}
          {lastSync && (
            <Text style={styles.helpText}>
              Last sweep {new Date(lastSync.completedAt).toLocaleString()} ·{" "}
              {lastSync.accepted} new · {lastSync.duplicates} already stored
            </Text>
          )}
        </View>

        {error && (
          <View style={[styles.notice, styles.errorNotice]}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        {notice && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionNumber}>01</Text>
          <View>
            <Text style={styles.sectionTitle}>Connect the server</Text>
            <Text style={styles.sectionHint}>Use your computer’s LAN address.</Text>
          </View>
        </View>
        <View style={styles.card}>
          <Text style={styles.inputLabel}>PINKERTON SERVER URL</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={(apiBaseUrl) =>
              setSettings((current) => ({ ...current, apiBaseUrl }))
            }
            placeholder="http://192.168.1.25:3040"
            placeholderTextColor="#999B93"
            style={styles.input}
            value={settings.apiBaseUrl}
          />
          <Text style={styles.inputLabel}>MOBILE SYNC TOKEN</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(syncToken) =>
              setSettings((current) => ({ ...current, syncToken }))
            }
            placeholder="Token from MOBILE_SYNC_TOKEN"
            placeholderTextColor="#999B93"
            secureTextEntry
            style={styles.input}
            value={settings.syncToken}
          />
          <Text style={styles.helpText}>
            HTTP is suitable only on your private development network. Use HTTPS
            before syncing real client conversations outside local testing.
          </Text>
          <ActionButton
            disabled={saving}
            label={saving ? "Connecting…" : "Save & test connection"}
            onPress={() => void onSaveConnection()}
          />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionNumber}>02</Text>
          <View style={styles.flex}>
            <Text style={styles.sectionTitle}>Choose contacts</Text>
            <Text style={styles.sectionHint}>
              Nothing syncs until you turn a person on.
            </Text>
          </View>
          {devicePhones.size === 0 && (
            <Pressable onPress={() => void loadDeviceContactPhones(true)}>
              <Text style={styles.textAction}>Match phone</Text>
            </Pressable>
          )}
        </View>
        <TextInput
          onChangeText={setQuery}
          placeholder="Search CRM contacts"
          placeholderTextColor="#858B84"
          style={[styles.input, styles.searchInput]}
          value={query}
        />
        <View style={styles.contactList}>
          {filteredContacts.map((contact, index) => {
            const phone = contact.phone ?? "";
            const onDevice = devicePhones.has(normalizePhone(phone));
            const selected = selectedIds.has(contact.id);
            return (
              <View
                key={contact.id}
                style={[
                  styles.contactRow,
                  index > 0 && styles.contactRowBorder,
                ]}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {contact.firstName.slice(0, 1)}
                    {contact.lastName.slice(0, 1)}
                  </Text>
                </View>
                <View style={styles.contactBody}>
                  <View style={styles.nameLine}>
                    <Text style={styles.contactName}>
                      {contact.firstName} {contact.lastName}
                    </Text>
                    {onDevice && <StatusPill label="On phone" tone="neutral" />}
                  </View>
                  <Text style={styles.contactMeta}>
                    {displayPhone(phone)} · {contact.stage}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel={`Sync messages with ${contact.firstName} ${contact.lastName}`}
                  onValueChange={(value) =>
                    void onToggleContact(contact, value)
                  }
                  thumbColor={COLORS.white}
                  trackColor={{ false: "#C9CBC4", true: COLORS.forest }}
                  value={selected}
                />
              </View>
            );
          })}
          {serverReady && filteredContacts.length === 0 && (
            <Text style={styles.emptyText}>
              No CRM contacts with phone numbers match this search.
            </Text>
          )}
          {!serverReady && (
            <Text style={styles.emptyText}>
              Connect the server to load CRM contacts.
            </Text>
          )}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionNumber}>03</Text>
          <View>
            <Text style={styles.sectionTitle}>Enable message sync</Text>
            <Text style={styles.sectionHint}>
              Incoming is immediate; outgoing catches up periodically.
            </Text>
          </View>
        </View>
        <View style={styles.card}>
          <Text style={styles.bodyText}>
            Pinkerton reads SMS only after Android permission is granted, filters
            them to the contacts selected above, and sends those messages to your
            Pinkerton server.
          </Text>
          <View style={styles.buttonRow}>
            <View style={styles.flex}>
              <ActionButton
                label={smsGranted ? "SMS access granted" : "Enable SMS access"}
                onPress={() => void beginSmsPermissionFlow()}
                variant={smsGranted ? "secondary" : "primary"}
              />
            </View>
            <View style={styles.flex}>
              <ActionButton
                disabled={!ready || syncing}
                label={syncing ? "Syncing…" : "Sync now"}
                onPress={() => void onSyncNow()}
                variant="secondary"
              />
            </View>
          </View>
          <Text style={styles.helpText}>
            The first manual sweep looks back 24 hours and only includes opted-in
            contacts. MMS attachments are not included in this first version.
          </Text>
        </View>

        <View style={styles.roadmap}>
          <Text style={styles.cardLabel}>NEXT CHANNEL</Text>
          <Text style={styles.roadmapTitle}>Calls, then email</Text>
          <Text style={styles.helpText}>
            The server envelope already supports call direction and duration.
            Android call-log capture and a visible contact timeline come next.
          </Text>
        </View>
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={() => setShowDisclosure(false)}
        presentationStyle="pageSheet"
        visible={showDisclosure}
      >
        <SafeAreaView style={styles.disclosure}>
          <Text style={styles.eyebrow}>BEFORE ANDROID ASKS</Text>
          <Text style={styles.disclosureTitle}>How message access works</Text>
          <Text style={styles.disclosureBody}>
            Pinkerton Companion will access incoming and sent SMS messages in the
            background. For contacts you explicitly opt in, it sends the phone
            number, message body, direction, and timestamp to the Pinkerton server
            URL you configured.
          </Text>
          <Text style={styles.disclosureBody}>
            Messages from all other numbers are ignored. Turning a contact off
            stops future collection for that number. Android may still show
            Pinkerton as having SMS permission until you revoke it in system
            settings.
          </Text>
          <Text style={styles.disclosureBody}>
            Do not continue with real client data over a public or unencrypted HTTP
            connection.
          </Text>
          <View style={styles.disclosureActions}>
            <ActionButton
              label="I understand — continue"
              onPress={() => void acceptDisclosureAndContinue()}
            />
            <ActionButton
              label="Not now"
              onPress={() => setShowDisclosure(false)}
              variant="secondary"
            />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <CompanionApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.background,
    gap: 14,
  },
  loadingText: { color: COLORS.muted, fontSize: 15 },
  content: { padding: 18, paddingBottom: 48, gap: 14 },
  masthead: { paddingVertical: 18 },
  eyebrow: {
    color: COLORS.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2.2,
  },
  title: {
    color: COLORS.ink,
    fontSize: 42,
    fontWeight: "800",
    letterSpacing: -1.5,
    lineHeight: 46,
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 16,
    lineHeight: 23,
    marginTop: 7,
    maxWidth: 360,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.line,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  statusCard: {
    borderTopColor: COLORS.forest,
    borderTopWidth: 4,
  },
  cardLabel: {
    color: COLORS.gold,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.7,
  },
  statusTitle: {
    color: COLORS.ink,
    fontSize: 20,
    fontWeight: "700",
    marginTop: 3,
  },
  rowBetween: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  statusGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 8,
  },
  statusLine: {
    color: COLORS.muted,
    fontSize: 13,
    width: "50%",
  },
  flex: { flex: 1 },
  pill: {
    backgroundColor: "#ECEDE8",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  pillGood: { backgroundColor: COLORS.forestSoft },
  pillWarn: { backgroundColor: "#F5E5C9" },
  pillText: {
    color: COLORS.ink,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  notice: {
    backgroundColor: COLORS.forestSoft,
    borderRadius: 10,
    padding: 12,
  },
  errorNotice: { backgroundColor: "#F7E1DC" },
  noticeText: { color: COLORS.forest, fontSize: 13 },
  errorText: { color: COLORS.danger, fontSize: 13 },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 11,
    marginTop: 16,
  },
  sectionNumber: {
    color: COLORS.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  sectionTitle: { color: COLORS.ink, fontSize: 19, fontWeight: "700" },
  sectionHint: { color: COLORS.muted, fontSize: 12, marginTop: 1 },
  inputLabel: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  input: {
    backgroundColor: COLORS.white,
    borderColor: COLORS.line,
    borderRadius: 10,
    borderWidth: 1,
    color: COLORS.ink,
    fontSize: 15,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  searchInput: { backgroundColor: COLORS.surface },
  helpText: { color: COLORS.muted, fontSize: 12, lineHeight: 18 },
  bodyText: { color: COLORS.ink, fontSize: 14, lineHeight: 21 },
  button: {
    alignItems: "center",
    backgroundColor: COLORS.forest,
    borderColor: COLORS.forest,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  buttonSecondary: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.forest,
  },
  buttonDisabled: { opacity: 0.38 },
  buttonPressed: { opacity: 0.78 },
  buttonText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  buttonSecondaryText: { color: COLORS.forest },
  buttonRow: { flexDirection: "row", gap: 10 },
  textAction: { color: COLORS.forest, fontSize: 12, fontWeight: "700" },
  contactList: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.line,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    paddingHorizontal: 14,
  },
  contactRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 11,
    minHeight: 76,
    paddingVertical: 10,
  },
  contactRowBorder: { borderTopColor: COLORS.line, borderTopWidth: 1 },
  avatar: {
    alignItems: "center",
    backgroundColor: COLORS.forestSoft,
    borderRadius: 10,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  avatarText: { color: COLORS.forest, fontSize: 14, fontWeight: "800" },
  contactBody: { flex: 1, gap: 3 },
  nameLine: { alignItems: "center", flexDirection: "row", gap: 7 },
  contactName: { color: COLORS.ink, fontSize: 15, fontWeight: "700" },
  contactMeta: {
    color: COLORS.muted,
    fontSize: 12,
    textTransform: "capitalize",
  },
  emptyText: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 22,
    textAlign: "center",
  },
  roadmap: {
    borderColor: COLORS.line,
    borderRadius: 16,
    borderStyle: "dashed",
    borderWidth: 1,
    marginTop: 12,
    padding: 16,
  },
  roadmapTitle: {
    color: COLORS.ink,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 5,
    marginTop: 3,
  },
  disclosure: {
    backgroundColor: COLORS.background,
    flex: 1,
    gap: 18,
    padding: 24,
  },
  disclosureTitle: {
    color: COLORS.ink,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1,
  },
  disclosureBody: {
    color: COLORS.ink,
    fontSize: 16,
    lineHeight: 25,
  },
  disclosureActions: { gap: 10, marginTop: "auto" },
});
