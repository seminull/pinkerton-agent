import { useState } from "react";
import {
  Alert,
  Badge,
  Group,
  Loader,
  Modal,
  Pagination,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import type { TimeShareAccess, TimeShareSummary } from "../api/types";
import { describeError } from "./errors";
import { formatInstant, formatLongDay } from "./format";
import { useShareAccesses } from "./shareLinkQueries";

const PAGE_SIZE = 25;

const shortDay = (day: string): string =>
  formatLongDay(day).replace(/^\w+, /, "");

// What the visitor was looking at, in words. The raw resource names are API
// vocabulary; "Opened the link" is what the owner actually wants to know.
const describeAccess = (access: TimeShareAccess): string => {
  switch (access.resource) {
    case "share":
      return "Opened the link";
    case "entries":
      return access.detail ? `Viewed entries for ${shortDay(access.detail)}` : "Viewed entries";
    case "summary":
      return access.detail ? `Viewed totals for ${shortDay(access.detail)}` : "Viewed all-time totals";
    case "daily": {
      // The calendar asks for its visible month padded by a week either side,
      // so the middle of the range is the month on screen.
      const [from, to] = access.detail?.split("..") ?? [];
      if (!from || !to) return "Viewed the calendar";
      const middle = new Date((Date.parse(from) + Date.parse(to)) / 2);
      return `Viewed the calendar for ${middle.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })}`;
    }
  }
};

const OUTCOME_BADGE: Record<TimeShareAccess["outcome"], { color: string; label: string }> = {
  allowed: { color: "green", label: "Allowed" },
  revoked: { color: "red", label: "Blocked — removed" },
  owner_disabled: { color: "orange", label: "Blocked — account disabled" },
};

// Enough to tell a phone from a laptop at a glance; the full string is in the
// tooltip for anyone who needs it.
const describeDevice = (userAgent: string | null): string => {
  if (!userAgent) return "Unknown";
  const browser =
    /Edg\//.test(userAgent) ? "Edge"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : /Safari\//.test(userAgent) ? "Safari"
    : null;
  const platform =
    /iPhone|iPad/.test(userAgent) ? "iOS"
    : /Android/.test(userAgent) ? "Android"
    : /Mac OS X/.test(userAgent) ? "macOS"
    : /Windows/.test(userAgent) ? "Windows"
    : /Linux/.test(userAgent) ? "Linux"
    : null;
  return [browser, platform].filter(Boolean).join(" on ") || "Other";
};

interface Props {
  share: TimeShareSummary;
  title: string;
  onClose: () => void;
}

export default function ShareAccessModal({ share, title, onClose }: Props) {
  const [page, setPage] = useState(1);
  const accesses = useShareAccesses(share.id, (page - 1) * PAGE_SIZE, PAGE_SIZE);
  const totalPages = accesses.data ? Math.ceil(accesses.data.total / PAGE_SIZE) : 0;

  return (
    <Modal opened onClose={onClose} title={`Activity: ${title}`} centered size="xl">
      <Stack>
        <Text size="sm" c="dimmed">
          Every request made with this link, newest first. Requests made after it was
          removed are still recorded, and were refused.
        </Text>

        {accesses.isError && (
          <Alert color="red" title="Couldn't load the activity">
            {describeError(accesses.error)}
          </Alert>
        )}

        {!accesses.data ? (
          !accesses.isError && (
            <Group justify="center" py="xl">
              <Loader />
            </Group>
          )
        ) : accesses.data.results.length === 0 ? (
          <Text size="sm" c="dimmed">
            Nobody has opened this link yet.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={720}>
            <Table verticalSpacing="xs" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>When</Table.Th>
                  <Table.Th>IP address</Table.Th>
                  <Table.Th>What</Table.Th>
                  <Table.Th>Device</Table.Th>
                  <Table.Th>Result</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {accesses.data.results.map((access) => {
                  const outcome = OUTCOME_BADGE[access.outcome];
                  return (
                    <Table.Tr key={access.id}>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        {formatInstant(access.createdAt)}
                      </Table.Td>
                      <Table.Td ff="monospace" style={{ whiteSpace: "nowrap" }}>
                        {access.ipAddress ?? "—"}
                      </Table.Td>
                      <Table.Td>{describeAccess(access)}</Table.Td>
                      <Table.Td>
                        <Tooltip
                          label={access.userAgent ?? "No user agent sent"}
                          multiline
                          w={320}
                          withArrow
                        >
                          <Text size="sm" span>
                            {describeDevice(access.userAgent)}
                          </Text>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="light" color={outcome.color}>
                          {outcome.label}
                        </Badge>
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
      </Stack>
    </Modal>
  );
}
