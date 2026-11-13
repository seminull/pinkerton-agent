import type { ReactNode } from "react";
import { Alert, Button, Center, Loader, Stack, Text } from "@mantine/core";
import { IconPlugConnectedX } from "@tabler/icons-react";
import { useAuth } from "./authContext";
import LoginPage from "./LoginPage";

// Sits outside the router, so the login screen is what a signed-out visitor
// gets at EVERY url, with the address bar untouched — sign in from a deep link
// and you land on the page you asked for, no redirect bookkeeping needed.
//
// This is a convenience, not the security boundary. The server refuses every
// /api request without a session; a visitor who forced their way past this
// component would get an app shell whose every request comes back 401.
export default function AuthGate({ children }: { children: ReactNode }) {
  const { status, user, refresh } = useAuth();

  if (status === "loading") {
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    );
  }

  // Deliberately not the login form: the server never answered, so signing in
  // couldn't work either, and a form that fails for no visible reason is worse
  // than saying so.
  if (status === "error") {
    return (
      <Center mih="100vh" p="md">
        <Stack maw={420}>
          <Alert
            color="red"
            icon={<IconPlugConnectedX size={18} />}
            title="Can't reach the server"
          >
            <Text size="sm">
              Pinkerton Agent couldn&apos;t check whether you&apos;re signed in. This is
              usually a brief outage.
            </Text>
          </Alert>
          <Button variant="light" onClick={refresh}>
            Try again
          </Button>
        </Stack>
      </Center>
    );
  }

  return user ? children : <LoginPage />;
}
