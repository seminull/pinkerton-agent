import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { IconLink } from "@tabler/icons-react";
import { ApiError } from "../api/client";
import type { ListingLookup } from "../api/types";
import { useLookupListing } from "./queries";

interface Props {
  opened: boolean;
  onClose: () => void;
  /** Called with the lookup result; the parent opens the listing form on it. */
  onResult: (lookup: ListingLookup) => void;
}

// Error codes from server/bigdistrict.ts and the lookup route, as sentences.
const ERROR_MESSAGES: Record<string, string> = {
  unsupported_listing_url:
    "That doesn't look like a Zillow home link. Open the home's page on Zillow and copy the address from your browser — it should contain “/homedetails/”.",
  listing_lookup_unavailable:
    "BigDistrict couldn't be reached. Try again in a moment, or add the listing by hand.",
  listing_lookup_busy: "Too many lookups in the last minute. Wait a little and try again.",
  listing_lookup_not_configured: "The BigDistrict connection isn't set up on this server.",
};

// Step one of "Add with Zillow": paste the link.
//
// This app never contacts Zillow. The link is sent to BigDistrict, which reads
// the address out of the link's own text and looks it up in county appraisal
// records. So the result is the home's recorded details — not its price,
// photos, or description, which exist only on the listing. The dialog says so
// up front, because "why is the price blank?" is the obvious next question.
export default function AddWithZillowModal({ opened, onClose, onResult }: Props) {
  const lookup = useLookupListing();
  const [url, setUrl] = useState("");

  const close = () => {
    setUrl("");
    lookup.reset();
    onClose();
  };

  const submit = () => {
    const link = url.trim();
    if (!link) return;
    lookup.mutate(link, {
      onSuccess: ({ lookup: result }) => {
        setUrl("");
        lookup.reset();
        onResult(result);
      },
    });
  };

  const error = lookup.error;

  return (
    <Modal opened={opened} onClose={close} title="Add with Zillow" centered>
      {/* A real form, so pasting the link and pressing Enter is the whole
          interaction. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Stack gap="md">
          <TextInput
            label="Zillow link"
            placeholder="https://www.zillow.com/homedetails/…"
            leftSection={<IconLink size={16} />}
            data-autofocus
            // A URL: phone keyboards shouldn't capitalise or autocorrect it.
            type="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={url}
            onChange={(event) => {
              setUrl(event.currentTarget.value);
              // Typing after a failure means they're fixing it; clear the
              // stale error rather than leave it contradicting the field.
              if (lookup.isError) lookup.reset();
            }}
          />

          {error && (
            <Alert color="red" title="Couldn't look that up">
              {error instanceof ApiError
                ? (ERROR_MESSAGES[error.code] ?? error.code)
                : "The server didn't respond. Please try again."}
            </Alert>
          )}

          <Text size="sm" c="dimmed">
            The address in the link is looked up in county records through BigDistrict, and
            the home&apos;s details — beds, baths, square footage, lot, year built — are filled
            in for you to review. Nothing is taken from Zillow itself, so you&apos;ll add the
            price and status yourself.
          </Text>

          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={lookup.isPending} disabled={!url.trim()}>
              Look up
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
