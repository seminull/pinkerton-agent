import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { IconLink } from "@tabler/icons-react";
import { ApiError } from "../api/client";
import {
  useListingUrlCapabilities,
  useLookupListingUrl,
  type ListingUrlLookupResult,
} from "./queries";

interface Props {
  opened: boolean;
  onClose: () => void;
  onResult: (result: ListingUrlLookupResult) => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  unsupported_listing_url:
    "Paste either a Zillow home URL or a public NTREIS Matrix shared-listing URL.",
  matrix_link_unavailable:
    "Matrix couldn’t be reached. Try again in a moment, or add the property by hand.",
  matrix_link_unreadable:
    "That Matrix share no longer contains a readable listing. It may have expired or been withdrawn.",
  listing_lookup_unavailable:
    "The county-record lookup couldn’t be reached. Try again in a moment, or add the property by hand.",
  listing_lookup_busy: "Too many lookups in the last minute. Wait a little and try again.",
  listing_lookup_not_configured:
    "Zillow lookup isn’t configured on this server. Public Matrix shared links still work.",
};

export default function AddWithUrlModal({ opened, onClose, onResult }: Props) {
  const lookup = useLookupListingUrl();
  const capabilities = useListingUrlCapabilities();
  const [url, setUrl] = useState("");

  const close = () => {
    if (lookup.isPending) return;
    setUrl("");
    lookup.reset();
    onClose();
  };

  const submit = () => {
    const link = url.trim();
    if (!link) return;
    lookup.mutate(link, {
      onSuccess: (result) => {
        setUrl("");
        lookup.reset();
        onResult(result);
      },
    });
  };

  return (
    <Modal opened={opened} onClose={close} title="Add with URL" centered>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Stack gap="md">
          <TextInput
            label="Property URL"
            placeholder="Zillow or NTREIS Matrix URL"
            leftSection={<IconLink size={16} />}
            data-autofocus
            type="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={url}
            onChange={(event) => {
              setUrl(event.currentTarget.value);
              if (lookup.isError) lookup.reset();
            }}
          />

          {lookup.error && (
            <Alert color="red" title="Couldn’t read that property URL">
              {lookup.error instanceof ApiError
                ? (ERROR_MESSAGES[lookup.error.code] ?? lookup.error.code.replace(/_/g, " "))
                : "The server didn’t respond. Please try again."}
            </Alert>
          )}

          <Text size="sm" c="dimmed">
            Matrix shared links import MLS details and photos. {capabilities.data?.available === false
              ? "Zillow lookup is not configured on this server. "
              : "Zillow links are matched to county records for the address and property facts. "}
            You’ll review everything before the property is saved.
          </Text>

          <Group justify="flex-end">
            <Button variant="default" onClick={close} disabled={lookup.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={lookup.isPending} disabled={!url.trim()}>
              Read property
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
