import { Alert, Button, Container, Group, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Link, useRouteError } from "react-router";

// The router's errorElement. Anything a child throws during render lands here,
// so this is the last thing between a bug and a blank white page.
export default function ErrorPage() {
  const error = useRouteError();
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";

  return (
    <Container size="sm" py="xl">
      <Stack>
        <Title order={2}>Something went wrong</Title>
        <Alert
          color="red"
          icon={<IconAlertTriangle size={18} />}
          title="Unhandled error"
        >
          <Text size="sm">{message}</Text>
        </Alert>
        <Group>
          <Button component={Link} to="/" variant="light">
            Back to dashboard
          </Button>
        </Group>
      </Stack>
    </Container>
  );
}
