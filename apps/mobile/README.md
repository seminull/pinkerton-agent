# Pinkerton Companion

Android companion app for opt-in contact communication sync. It is an Expo SDK
57 app in the repository's pnpm workspace.

## Why this uses an Expo development build

The contact-selection UI and `expo-contacts` work in Expo Go. Reading SMS,
receiving an SMS broadcast while the JavaScript app is not open, and later
reading the call log require Android native code that cannot be added to the
stock Expo Go binary.

An Expo development build is still the managed Expo workflow: it is a custom
version of Expo Go containing this app's Kotlin module, and it connects to the
same Metro server with Fast Refresh.

## Local setup

1. Add a long random `MOBILE_SYNC_TOKEN` to the repository `.env`.
2. Start Postgres, migrate, and run the API:

   ```bash
   pnpm services:up
   pnpm db:migrate
   pnpm dev:api
   ```

3. Make sure the phone and computer are on the same network. In the app, use the
   computer's LAN URL, such as `http://192.168.1.25:3040`; `localhost` on the
   phone means the phone itself.
4. Build and install the native development client over the already configured
   wireless ADB connection:

   ```bash
   pnpm mobile:android
   ```

5. For later JavaScript-only sessions, keep the installed client and run:

   ```bash
   pnpm dev:mobile
   ```

Re-run `pnpm mobile:android` after changing native Kotlin, Android permissions,
the app config, or native dependencies. JavaScript and styles continue to use
Fast Refresh without rebuilding.

An EAS alternative is available from this directory:

```bash
npx eas-cli build --profile development --platform android
```

## Sync behavior

- The user selects CRM contacts explicitly. Phone numbers for every other
  contact are ignored.
- Android's SMS receiver uploads selected incoming messages immediately.
- A foreground/manual sweep and an inexact 15-minute WorkManager task read sent
  and received SMS since the last cursor. That overlap also retries failed
  receiver uploads.
- The server de-duplicates on `(deviceId, externalId)`, so delivery is safely
  at-least-once.
- The first sweep starts 24 hours back. It does not import the full phone
  history.
- This version handles SMS text bodies, not MMS attachments or group-message
  participant metadata.

## Release constraints

`READ_SMS` and `RECEIVE_SMS` are restricted Google Play permissions. A Play
release needs a Permissions Declaration, a privacy policy, prominent in-app
disclosure, and approval for an eligible core use case such as cross-device
synchronization. Do not upload a production bundle until that review path is
settled.

iOS does not expose the user's Messages database to ordinary third-party apps,
so device-SMS mirroring is Android-only. A future iOS companion can still
support contacts and server-originated communication providers.
