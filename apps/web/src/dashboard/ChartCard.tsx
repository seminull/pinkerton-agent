import { useState, type ReactNode } from "react";
import { Card, Group, SegmentedControl, Stack, Table, Text, Title } from "@mantine/core";

export interface ChartTable {
  columns: string[];
  rows: { key: string; cells: ReactNode[] }[];
}

interface Props {
  title: string;
  /** One line under the title: what is counted, and over what period. */
  description: string;
  /** The same numbers as rows: the accessible view, and the exact one. */
  table: ChartTable;
  children: ReactNode;
}

// The frame every dashboard chart sits in. Each one has a Table view because
// a chart is not readable by everyone: a screen reader gets nothing from
// bars, two of the light-mode series colors are under 3:1 contrast against
// the card, and sometimes you just want the exact number.
export default function ChartCard({ title, description, table, children }: Props) {
  const [view, setView] = useState<"chart" | "table">("chart");

  return (
    <Card withBorder h="100%">
      <Stack gap="md" h="100%">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div>
            <Title order={4}>{title}</Title>
            <Text size="sm" c="dimmed">
              {description}
            </Text>
          </div>
          <SegmentedControl
            size="xs"
            value={view}
            onChange={(value) => setView(value as "chart" | "table")}
            data={[
              { value: "chart", label: "Chart" },
              { value: "table", label: "Table" },
            ]}
            aria-label={`${title}: chart or table`}
            // The title and description give way, never the toggle: squeezed,
            // it clips to "Tabl" on the narrower cards.
            style={{ flexShrink: 0 }}
          />
        </Group>

        {view === "chart" ? (
          children
        ) : (
          <Table.ScrollContainer minWidth={320} mah={320}>
            <Table striped verticalSpacing={4} fz="sm">
              <Table.Thead>
                <Table.Tr>
                  {table.columns.map((column, index) => (
                    // Every column after the first is a number, right-aligned
                    // so the digits line up.
                    <Table.Th key={column} ta={index === 0 ? "left" : "right"}>
                      {column}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {table.rows.map((row) => (
                  <Table.Tr key={row.key}>
                    {row.cells.map((cell, index) => (
                      <Table.Td
                        key={index}
                        ta={index === 0 ? "left" : "right"}
                        style={index === 0 ? undefined : { fontVariantNumeric: "tabular-nums" }}
                      >
                        {cell}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>
    </Card>
  );
}
