import { Button, Container, Stack, Text, Title } from "@mantine/core";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <Container size="sm" py="xl">
      <Stack align="flex-start">
        <Title order={2}>Page not found</Title>
        <Text c="dimmed">That URL doesn&apos;t match anything in the app.</Text>
        <Button component={Link} to="/" variant="light">
          Back to dashboard
        </Button>
      </Stack>
    </Container>
  );
}
