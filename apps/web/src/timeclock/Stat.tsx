import { Paper, Text } from "@mantine/core";

/** One labelled figure — "My work time / 3h 20m". */
export default function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fz="xl" fw={700}>
        {value}
      </Text>
    </Paper>
  );
}
