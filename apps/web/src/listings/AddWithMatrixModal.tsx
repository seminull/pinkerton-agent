import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { IconLink } from "@tabler/icons-react";
import { ApiError } from "../api/client";
import type { ListingLookup } from "../api/types";
import { useLookupMatrixListing } from "./queries";

interface Props {
  opened: boolean;
  onClose: () => void;
  onResult: (lookup: ListingLookup) => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  unsupported_matrix_link:
    "Paste a public Matrix shared-listing link, such as ntrdd.mlsmatrix.com/matrix/shared/…",
  matrix_link_unavailable:
    "Matrix couldn’t be reached. Try again in a moment, or add the property by hand.",
  matrix_link_unreadable:
    "That Matrix share no longer contains a readable listing. It may have expired or been withdrawn.",
};

export default function AddWithMatrixModal({ opened, onClose, onResult }: Props) {
  const lookup = useLookupMatrixListing();
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
      onSuccess: ({ lookup: result }) => {
        setUrl("");
        lookup.reset();
        onResult(result);
      },
    });
  };

  return (
    <Modal opened={opened} onClose={close} title="Add with NTREIS" centered>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Stack gap="md">
          <TextInput
            label="Matrix shared link"
            placeholder="https://ntrdd.mlsmatrix.com/matrix/shared/…"
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
            <Alert color="red" title="Couldn’t read that listing">
              {lookup.error instanceof ApiError
                ? (ERROR_MESSAGES[lookup.error.code] ?? lookup.error.code.replace(/_/g, " "))
                : "The server didn’t respond. Please try again."}
            </Alert>
          )}

          <Text size="sm" c="dimmed">
            Use Matrix’s public Share link. Address, MLS details, price or rent,
            status, description, and property facts will be filled in for review.
            Photos are copied into this app after you create the property.
          </Text>

          <Group justify="flex-end">
            <Button variant="default" onClick={close} disabled={lookup.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={lookup.isPending} disabled={!url.trim()}>
              Read listing
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
