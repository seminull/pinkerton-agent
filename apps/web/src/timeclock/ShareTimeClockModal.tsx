import { useState } from "react";
import {
  Alert,
  Button,
  CopyButton,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconCopy, IconLink } from "@tabler/icons-react";
import { api } from "../api/client";
import type { TimeShare, TimeShareScope } from "../api/types";
import { describeError } from "./errors";
import { formatLongDay } from "./format";
import { shareLinkKeys } from "./shareLinkQueries";

interface Props {
  scope: TimeShareScope;
  day: string;
  onClose: () => void;
}

interface CreatedShare extends TimeShare {
  id: string;
  token: string;
  label: string | null;
}

// The browser is the authority on which IANA zone the user's local dates use.
// Saving it with the link keeps "Tuesday" stable for a viewer in another zone.
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function ShareTimeClockModal({ scope, day, onClose }: Props) {
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [linkLabel, setLinkLabel] = useState("");
  const queryClient = useQueryClient();

  const label = scope === "calendar" ? "calendar" : formatLongDay(day);

  const createLink = async () => {
    setCreating(true);
    try {
      const response = await api.post<{ share: CreatedShare }>("/time-shares", {
        scope,
        day,
        timeZone: TIME_ZONE,
        // Blank is "no label"; the server stores NULL, not "".
        label: linkLabel.trim() || null,
      });
      void queryClient.invalidateQueries({ queryKey: shareLinkKeys.all });
      setUrl(`${window.location.origin}/shared/time-clock/${response.share.token}`);
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Couldn't create the share link",
        message: describeError(error),
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={`Share ${label}`} centered size="lg">
      <Stack>
        <Text size="sm">
          Anyone with the link can view this {scope === "calendar" ? "calendar" : "day"}
          {" "}without signing in. It is read-only, and file references
          are left out. You can see who opens it, and remove it, on the Shared links tab.
        </Text>

        {url ? (
          <>
            <Alert color="green" title="Share link created">
              This link can be opened in a signed-out browser.
            </Alert>
            <TextInput label="Share link" value={url} readOnly />
            <Group justify="flex-end">
              <CopyButton value={url} timeout={2000}>
                {({ copied, copy }) => (
                  <Button
                    onClick={copy}
                    leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  >
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                )}
              </CopyButton>
            </Group>
          </>
        ) : (
          <>
            <TextInput
              label="Label"
              description="Optional, and only you see it, on the Shared links tab. Who is it for?"
              placeholder="For Dana, November hours"
              maxLength={120}
              value={linkLabel}
              onChange={(event) => setLinkLabel(event.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button leftSection={<IconLink size={16} />} loading={creating} onClick={createLink}>
                Create share link
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
