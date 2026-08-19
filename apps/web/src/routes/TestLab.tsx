import { Alert, Stack, Tabs, Text, Title } from "@mantine/core";
import { IconBook2, IconFlask, IconListDetails, IconTable } from "@tabler/icons-react";
import FieldCoverage from "../mls/FieldCoverage";
import MlsDocs from "../mls/MlsDocs";
import MlsExplorer from "../mls/MlsExplorer";

// A scratch area for integrations that aren't part of the product yet.
//
// Kept as its own route rather than folded into Listings on purpose: this reads
// from someone else's system under a licence we don't hold yet, and mixing it
// into the CRM's own screens would blur which records the agent owns and which
// ones we're only allowed to look at. When the MLS sync becomes real it moves
// out of here.

export default function TestLab() {
  return (
    <Stack>
      <div>
        <Title order={2}>Test lab</Title>
        <Text size="sm" c="dimmed">
          Integration scratch space. Nothing here is wired into the CRM.
        </Text>
      </div>

      <Alert
        variant="light"
        color="blue"
        icon={<IconFlask size={18} />}
        title="Read-only, and nothing is stored"
      >
        <Text size="sm">
          Every query on this page goes straight to the MLS feed and back to your browser.
          No MLS record is written to the database — there's no table for it yet, and
          there shouldn't be until the licence terms are known. Start with{" "}
          <strong>How this works</strong> if this is your first visit.
        </Text>
      </Alert>

      <Tabs defaultValue="docs" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="docs" leftSection={<IconBook2 size={16} />}>
            How this works
          </Tabs.Tab>
          <Tabs.Tab value="explorer" leftSection={<IconTable size={16} />}>
            MLS explorer
          </Tabs.Tab>
          <Tabs.Tab value="coverage" leftSection={<IconListDetails size={16} />}>
            Field coverage
          </Tabs.Tab>
        </Tabs.List>

        {/* keepMounted={false} above: the coverage tab pulls full-width records,
            which is the most expensive call here. Don't spend that quota on a
            tab nobody opened. */}
        <Tabs.Panel value="docs">
          <MlsDocs />
        </Tabs.Panel>
        <Tabs.Panel value="explorer">
          <MlsExplorer />
        </Tabs.Panel>
        <Tabs.Panel value="coverage">
          <FieldCoverage />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
