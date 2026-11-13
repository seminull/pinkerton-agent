import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Pagination,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconActivity, IconLinkOff } from "@tabler/icons-react";
import type { TimeShareStatus, TimeShareSummary } from "../api/types";
import { describeError } from "./errors";
import { formatInstant, formatLongDay } from "./format";
import ShareAccessModal from "./ShareAccessModal";
import { useRemoveShareLink, useShareLinks } from "./shareLinkQueries";

const PAGE_SIZE = 25;

type Filter = "all" | TimeShareStatus;

const STATUS_BADGE: Record<TimeShareStatus, { color: string; label: string }> = {
  active: { color: "green", label: "Active" },
  removed: { color: "gray", label: "Removed" },
};

// A link has no name of its own, so an unlabelled one is described by what it
// shows. That is also the title its activity modal uses.
const describeShare = (share: TimeShareSummary): string =>
  share.scope === "calendar" ? "Whole calendar" : formatLongDay(share.day);

const titleOf = (share: TimeShareSummary): string => share.label ?? describeShare(share);

// The Shared links tab: every share link this user has made, what state it is
// in, and who has used it. Removing a link is a soft delete — it stops working
// immediately, and stays here (badged Removed) so its activity can still be
// reviewed, including anyone who keeps trying it.
export default function SharesTab() {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<TimeShareSummary | null>(null);
  const [removing, setRemoving] = useState<TimeShareSummary | null>(null);

  const links = useShareLinks(
    filter === "all" ? undefined : filter,
    (page - 1) * PAGE_SIZE,
    PAGE_SIZE
  );
  const remove = useRemoveShareLink();
  const totalPages = links.data ? Math.ceil(links.data.total / PAGE_SIZE) : 0;

  const confirmRemove = () => {
    if (!removing) return;
    remove.mutate(removing.id, {
      onSuccess: () => {
        notifications.show({
          color: "green",
          title: "Link removed",
          message: "It no longer opens. Its activity is still here.",
        });
        setRemoving(null);
      },
      onError: (error) =>
        notifications.show({
          color: "red",
          title: "Couldn't remove the link",
          message: describeError(error),
        }),
    });
  };

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Text size="sm" c="dimmed" maw={560}>
          Links you've shared from the Calendar tab. A link can't be copied again after
          it's created — make a new one from the Calendar if you need it.
        </Text>
        <SegmentedControl
          value={filter}
          onChange={(value) => {
            setFilter(value as Filter);
            setPage(1);
          }}
          data={[
            { value: "all", label: "All" },
            { value: "active", label: "Active" },
            { value: "removed", label: "Removed" },
          ]}
        />
      </Group>

      {links.isError && (
        <Alert color="red" title="Couldn't load your share links">
          {describeError(links.error)}
        </Alert>
      )}

      {!links.data ? (
        !links.isError && (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        )
      ) : links.data.results.length === 0 ? (
        <Card withBorder>
          <Text size="sm" c="dimmed">
            {filter === "all"
              ? "You haven't shared anything yet. Use Share this day or Share calendar on the Calendar tab."
              : `No ${filter} links.`}
          </Text>
        </Card>
      ) : (
        <Table.ScrollContainer minWidth={900}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Status</Table.Th>
                <Table.Th>Link</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th ta="right">Opens</Table.Th>
                <Table.Th ta="right">Unique IPs</Table.Th>
                <Table.Th>Last opened</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {links.data.results.map((share) => {
                const status = STATUS_BADGE[share.status];
                return (
                  <Table.Tr key={share.id}>
                    <Table.Td>
                      <Tooltip
                        disabled={!share.revokedAt}
                        label={share.revokedAt ? `Removed ${formatInstant(share.revokedAt)}` : ""}
                        withArrow
                      >
                        <Badge variant="light" color={status.color}>
                          {status.label}
                        </Badge>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {titleOf(share)}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {share.label ? `${describeShare(share)} · ` : ""}
                        {share.scope === "calendar" ? "Every recorded day" : "One day only"}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: "nowrap" }}>
                      {formatInstant(share.createdAt)}
                    </Table.Td>
                    <Table.Td ta="right">
                      <Tooltip
                        label={`${share.requestCount.toLocaleString()} requests in all, counting each day and month viewed`}
                        withArrow
                      >
                        <Text size="sm" span>
                          {share.openCount.toLocaleString()}
                        </Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td ta="right">{share.uniqueIpCount.toLocaleString()}</Table.Td>
                    <Table.Td style={{ whiteSpace: "nowrap" }}>
                      {share.lastAccessedAt ? formatInstant(share.lastAccessedAt) : "Never"}
                      {share.blockedCount > 0 && (
                        <Text size="xs" c="red">
                          {share.blockedCount.toLocaleString()} blocked since removal
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end" wrap="nowrap">
                        <Button
                          size="xs"
                          variant="default"
                          leftSection={<IconActivity size={14} />}
                          onClick={() => setViewing(share)}
                        >
                          Activity
                        </Button>
                        {share.status === "active" && (
                          <Button
                            size="xs"
                            variant="light"
                            color="red"
                            leftSection={<IconLinkOff size={14} />}
                            onClick={() => setRemoving(share)}
                          >
                            Remove
                          </Button>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {totalPages > 1 && (
        <Group justify="center">
          <Pagination value={page} onChange={setPage} total={totalPages} />
        </Group>
      )}

      {viewing && (
        <ShareAccessModal share={viewing} title={titleOf(viewing)} onClose={() => setViewing(null)} />
      )}

      {/* Confirmed, because there is no undo: a removed link can't be turned
          back on, only replaced by a new one with a different URL. */}
      <Modal
        opened={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this share link?"
        centered
      >
        <Stack>
          <Text size="sm">
            <b>{removing ? titleOf(removing) : ""}</b> will stop opening for anyone who has
            it. This can't be undone. Its activity stays on this tab, and any further
            attempts to open it will be recorded as blocked.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button color="red" loading={remove.isPending} onClick={confirmRemove}>
              Remove link
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
