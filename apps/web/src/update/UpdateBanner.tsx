import { useEffect, useState } from "react";
import { Affix, Button, CloseButton, Group, Paper, Text, Transition } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { newVersionDeployed } from "./version";

// Checked on a timer for a tab left open and untouched, and again whenever the
// tab becomes visible — which is when someone is about to use it, and the
// moment a stale tab matters.
const CHECK_EVERY_MS = 5 * 60 * 1000;

// "A new version is available — Refresh."
//
// A tab left open keeps running the client it loaded, however many deploys
// happen behind it. Usually that is harmless; when the server has changed in a
// way the old client doesn't expect, it shows up as odd errors until someone
// thinks to reload. This says so instead.
//
// It asks rather than reloading by itself, on purpose. People leave this app
// open mid-task — a half-typed form, a note being written — and a page that
// reloads under them loses it. They pick the moment.
export default function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Once an update has been found there is nothing more to learn by asking.
    if (available) return;
    let cancelled = false;
    const check = () => {
      void newVersionDeployed().then((found) => {
        if (found && !cancelled) setAvailable(true);
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [available]);

  return (
    // Bottom-right: notifications use the top-right, and this must not sit on
    // top of the page's own header and buttons.
    <Affix position={{ bottom: 16, right: 16 }} zIndex={300}>
      <Transition mounted={available && !dismissed} transition="slide-up" duration={250}>
        {(styles) => (
          <Paper withBorder shadow="md" p="sm" radius="md" maw={360} style={styles} role="status">
            <Group gap="sm" wrap="nowrap" align="flex-start">
              <div style={{ flex: 1 }}>
                <Text size="sm" fw={600}>
                  A new version is available
                </Text>
                {/* The one worry worth answering before they click. */}
                <Text size="xs" c="dimmed">
                  Refresh when you&apos;re ready. A running Time Clock task keeps running;
                  anything typed but not saved will be lost.
                </Text>
                <Button
                  mt="xs"
                  size="compact-sm"
                  leftSection={<IconRefresh size={14} />}
                  onClick={() => window.location.reload()}
                >
                  Refresh now
                </Button>
              </div>
              {/* Dismissing is "not now": it stays away for this tab, and the
                  next reload — whenever they choose it — picks up the update. */}
              <CloseButton aria-label="Dismiss" onClick={() => setDismissed(true)} />
            </Group>
          </Paper>
        )}
      </Transition>
    </Affix>
  );
}
