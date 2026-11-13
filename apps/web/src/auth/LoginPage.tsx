import { useState } from "react";
import {
  Alert,
  Button,
  Center,
  Divider,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertCircle, IconBrandGoogle } from "@tabler/icons-react";
import { ApiError } from "../api/client";
import { BrandLogo } from "../brand/Brand";
import ColorSchemeToggle from "../routes/ColorSchemeToggle";
import { useAuth } from "./authContext";

// The codes the Google callback can send back as ?auth_error= (see
// server/routes/auth.routes.ts). An unknown code still gets the generic
// sentence rather than being echoed — the query string is attacker-writable,
// so its text never reaches the page.
const CALLBACK_ERRORS: Record<string, string> = {
  google_denied: "Google sign-in was cancelled.",
  google_invalid: "That sign-in attempt expired. Please try again.",
  google_unavailable: "Google couldn't be reached. Please try again in a moment.",
  google_unverified: "Google hasn't verified that email address yet.",
  not_invited:
    "That Google account doesn't have access to Pinkerton Agent. Try a different account, or ask the owner to add you.",
  account_disabled: "That account has been disabled.",
};
// True for a mouse-and-keyboard device, false for a phone or tablet. Used to
// decide whether to focus the email field on arrival: on a desktop that saves a
// click, but on a touch screen it throws the keyboard up over half the page
// before the visitor has seen what the page is.
const HAS_FINE_POINTER = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

const GENERIC_CALLBACK_ERROR = "Sign-in didn't complete. Please try again.";

// Read once, then scrubbed from the address bar so a refresh (or a bookmark)
// doesn't keep replaying an error from an attempt that is long over.
const takeCallbackError = (): string | null => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("auth_error");
  if (!code) return null;
  params.delete("auth_error");
  const rest = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`
  );
  return CALLBACK_ERRORS[code] ?? GENERIC_CALLBACK_ERROR;
};

export default function LoginPage() {
  const { login, googleAvailable } = useAuth();
  // Lazy initialiser: runs exactly once, so the scrub above can't race a
  // re-render into reading an already-cleaned URL.
  const [error, setError] = useState<string | null>(takeCallbackError);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm({
    initialValues: { email: "", password: "" },
    validate: {
      email: (value) => (value.trim() ? null : "Enter your email"),
      password: (value) => (value ? null : "Enter your password"),
    },
  });

  const submit = form.onSubmit(async (values) => {
    setSubmitting(true);
    setError(null);
    try {
      await login({ email: values.email.trim(), password: values.password });
      // Nothing to do on success: AuthGate swaps this page for the app.
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "That email and password don't match an account."
          : err instanceof ApiError && err.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : "Couldn't sign in right now. Please try again."
      );
      setSubmitting(false);
    }
  });

  return (
    // dvh, not vh: on a phone, 100vh is the height with the browser's address
    // bar hidden, so a vh-tall page is always slightly taller than the screen
    // and the card sits off-centre with a pointless scroll. dvh tracks what is
    // actually visible. When the card is taller than the screen (a phone on its
    // side), min-height lets the page grow and scroll rather than clipping.
    <Center mih="100dvh" p="md">
      {/* No header on this page, so the toggle floats in the corner. */}
      <ColorSchemeToggle affixed />
      {/* Tighter padding below the xs breakpoint: on a 320px phone the roomy
          desktop padding would leave the fields barely 220px wide. */}
      <Paper withBorder shadow="sm" p={{ base: "lg", xs: "xl" }} w="100%" maw={400}>
        <Stack>
          {/* The lockup carries the name, so there is no separate text title. */}
          <Center>
            <BrandLogo h={{ base: 150, xs: 190 }} />
          </Center>

          {error && (
            <Alert color="red" icon={<IconAlertCircle size={18} />}>
              {error}
            </Alert>
          )}

          {googleAvailable && (
            <>
              {/* A real navigation, not a fetch: the OAuth flow is a chain of
                  browser redirects that ends back here with a session cookie. */}
              <Button
                component="a"
                href="/api/auth/google/start"
                variant="default"
                size="md"
                leftSection={<IconBrandGoogle size={18} />}
              >
                Continue with Google
              </Button>
              <Divider label="or" labelPosition="center" />
            </>
          )}

          <form onSubmit={submit} noValidate>
            <Stack>
              {/* size="md" on every control here is load-bearing, not taste:
                  it makes the input text 16px. iOS Safari zooms the whole page
                  in when a focused field's text is smaller than that, and
                  doesn't zoom back out afterwards. It also takes the controls
                  to 42px tall, a comfortable thumb target. */}
              <TextInput
                label="Email"
                type="email"
                size="md"
                autoComplete="username"
                // Phone keyboards would otherwise capitalise the first letter
                // and "correct" an address into a dictionary word.
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus={HAS_FINE_POINTER}
                key={form.key("email")}
                {...form.getInputProps("email")}
              />
              <PasswordInput
                label="Password"
                size="md"
                autoComplete="current-password"
                key={form.key("password")}
                {...form.getInputProps("password")}
              />
              <Button type="submit" size="md" loading={submitting}>
                Sign in
              </Button>
            </Stack>
          </form>

          {/* No "create an account" link, on purpose — accounts are issued by
              the owner. Say so, or the missing link reads as a broken page. */}
          <Text c="dimmed" size="xs" ta="center">
            Accounts are by invitation. There&apos;s no public sign-up.
          </Text>
        </Stack>
      </Paper>
    </Center>
  );
}
