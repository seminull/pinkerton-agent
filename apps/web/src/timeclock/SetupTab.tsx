import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArchive,
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconPencil,
  IconPlus,
  IconRestore,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { ApiError } from "../api/client";
import type { TimeOption } from "../api/types";
import PageStack from "../motion/PageStack";
import {
  useCreateOption,
  useDeleteOption,
  useReorderOptions,
  useTimeOptions,
  useUpdateOption,
  type OptionList,
} from "./queries";

// Error codes from server/routes/time-options.routes.ts, as sentences.
const ERROR_MESSAGES: Record<string, string> = {
  name_in_use: "You already have one with that name.",
  last_active_option: "At least one has to stay active, or there'd be nothing to pick.",
  option_in_use: "Entries use this one, so it can be archived but not deleted.",
  option_not_found: "That one no longer exists.",
};

const describe = (error: unknown): string =>
  error instanceof ApiError
    ? (error.details?.name ?? ERROR_MESSAGES[error.code] ?? error.code)
    : "The server didn't respond. Please try again.";

const fail = (title: string) => (error: unknown) =>
  notifications.show({ color: "red", title, message: describe(error) });

interface ListProps {
  list: OptionList;
  title: string;
  /** What the list is for, and what its switch does. */
  description: string;
  options: TimeOption[];
  /** The boolean each row carries. */
  flag: "isBreak" | "countsAsOwnTime";
  /** The switch's label — phrased so that ON is the state it names. */
  flagLabel: string;
  /** Placeholder for the "add" field. */
  addPlaceholder: string;
}

// One editable list. Categories and work types are the same thing with a
// different switch, so both cards are this component.
function OptionListCard({
  list,
  title,
  description,
  options,
  flag,
  flagLabel,
  addPlaceholder,
}: ListProps) {
  const create = useCreateOption(list);
  const update = useUpdateOption(list);
  const remove = useDeleteOption(list);
  const reorder = useReorderOptions(list);

  const [newName, setNewName] = useState("");
  // The row being renamed, and the text in its field.
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const active = options.filter((option) => !option.archived);
  const archived = options.filter((option) => option.archived);

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    create.mutate(
      { name },
      { onSuccess: () => setNewName(""), onError: fail(`Couldn't add "${name}"`) }
    );
  };

  const saveRename = () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    const original = options.find((option) => option.id === renaming.id)?.name;
    // Unchanged or emptied: just close the field. An empty name isn't an
    // error worth a red toast — it is someone changing their mind.
    if (!name || name === original) {
      setRenaming(null);
      return;
    }
    update.mutate(
      { id: renaming.id, name },
      { onSuccess: () => setRenaming(null), onError: fail("Couldn't rename") }
    );
  };

  // Move one active row up or down. The server wants the complete list of ids
  // in the new order, so this swaps two neighbours and sends everything, with
  // the archived rows kept after the active ones.
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= active.length) return;
    const ids = active.map((option) => option.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate([...ids, ...archived.map((option) => option.id)], {
      onError: fail("Couldn't reorder"),
    });
  };

  return (
    <Card withBorder>
      <Stack gap="sm">
        <div>
          <Title order={4}>{title}</Title>
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        </div>

        <Stack gap={4}>
          {active.map((option, index) => (
            <Group key={option.id} gap="xs" wrap="nowrap" align="center">
              {/* Reorder controls first, where a drag handle would be. Arrows
                  rather than drag-and-drop: they work the same with a mouse, a
                  finger, and a keyboard, and need no extra library. */}
              <Group gap={0} wrap="nowrap">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={`Move ${option.name} up`}
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => move(index, -1)}
                >
                  <IconArrowUp size={14} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={`Move ${option.name} down`}
                  disabled={index === active.length - 1 || reorder.isPending}
                  onClick={() => move(index, 1)}
                >
                  <IconArrowDown size={14} />
                </ActionIcon>
              </Group>

              {renaming?.id === option.id ? (
                <TextInput
                  flex={1}
                  size="xs"
                  maxLength={80}
                  autoFocus
                  aria-label={`New name for ${option.name}`}
                  value={renaming.name}
                  onChange={(event) =>
                    setRenaming({ id: option.id, name: event.currentTarget.value })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveRename();
                    if (event.key === "Escape") setRenaming(null);
                  }}
                  rightSectionWidth={52}
                  rightSection={
                    <Group gap={0} wrap="nowrap">
                      <ActionIcon
                        variant="subtle"
                        color="green"
                        size="sm"
                        aria-label="Save name"
                        onClick={saveRename}
                      >
                        <IconCheck size={14} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        aria-label="Cancel rename"
                        onClick={() => setRenaming(null)}
                      >
                        <IconX size={14} />
                      </ActionIcon>
                    </Group>
                  }
                />
              ) : (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" truncate>
                    {option.name}
                  </Text>
                  {/* Tells the user what Archive vs Delete is about to mean
                      before they press it. */}
                  {option.entryCount > 0 && (
                    <Text size="xs" c="dimmed">
                      {option.entryCount.toLocaleString()}{" "}
                      {option.entryCount === 1 ? "entry" : "entries"}
                    </Text>
                  )}
                </div>
              )}

              <Switch
                size="xs"
                label={flagLabel}
                checked={option[flag] === true}
                disabled={update.isPending}
                onChange={(event) =>
                  update.mutate(
                    { id: option.id, [flag]: event.currentTarget.checked },
                    { onError: fail("Couldn't update") }
                  )
                }
              />

              <Tooltip label="Rename" withArrow>
                <ActionIcon
                  variant="subtle"
                  aria-label={`Rename ${option.name}`}
                  onClick={() => setRenaming({ id: option.id, name: option.name })}
                >
                  <IconPencil size={16} />
                </ActionIcon>
              </Tooltip>

              {/* One slot, two meanings. An option nothing uses is simply
                  deleted. One that entries use is archived instead: it leaves
                  the dropdown but those entries keep their name and their
                  break / own-time meaning. */}
              {option.entryCount === 0 ? (
                <Tooltip label="Delete" withArrow>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Delete ${option.name}`}
                    onClick={() => remove.mutate(option.id, { onError: fail("Couldn't delete") })}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Tooltip>
              ) : (
                <Tooltip label="Archive — hide from the dropdown, keep past entries" withArrow>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={`Archive ${option.name}`}
                    onClick={() =>
                      update.mutate(
                        { id: option.id, archived: true },
                        { onError: fail("Couldn't archive") }
                      )
                    }
                  >
                    <IconArchive size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          ))}
        </Stack>

        <Group gap="xs" wrap="nowrap">
          <TextInput
            flex={1}
            placeholder={addPlaceholder}
            maxLength={80}
            aria-label={`New ${title.toLowerCase()} name`}
            value={newName}
            onChange={(event) => setNewName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") add();
            }}
          />
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={add}
            loading={create.isPending}
            disabled={!newName.trim()}
          >
            Add
          </Button>
        </Group>

        {archived.length > 0 && (
          <>
            <Divider label={`Archived (${archived.length})`} labelPosition="left" />
            <Stack gap={4}>
              {archived.map((option) => (
                <Group key={option.id} gap="xs" wrap="nowrap">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" c="dimmed" truncate>
                      {option.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {option.entryCount.toLocaleString()}{" "}
                      {option.entryCount === 1 ? "entry" : "entries"}
                    </Text>
                  </div>
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    leftSection={<IconRestore size={14} />}
                    onClick={() =>
                      update.mutate(
                        { id: option.id, archived: false },
                        { onError: fail("Couldn't restore") }
                      )
                    }
                  >
                    Restore
                  </Button>
                </Group>
              ))}
            </Stack>
          </>
        )}
      </Stack>
    </Card>
  );
}

// The Setup tab: the categories and work types offered when starting a task.
// They are the signed-in user's own lists; nobody else's dropdowns change.
export default function SetupTab() {
  const options = useTimeOptions();

  if (options.isError) {
    return (
      <Alert color="red" title="Couldn't load your setup">
        {describe(options.error)}
      </Alert>
    );
  }
  if (!options.data) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    );
  }

  return (
    <PageStack>
      <Text size="sm" c="dimmed">
        These lists are yours — they decide what you can pick when you start a task. Renaming
        one renames it on your past entries too.
      </Text>
      {/* Side by side when there is room; stacked on a phone or tablet. */}
      <SimpleGrid cols={{ base: 1, lg: 2 }} style={{ alignItems: "start" }}>
        <OptionListCard
          list="categories"
          title="Categories"
          description="What the time was spent on. Turn on Break for categories like lunch: that time is totalled separately and left out of your work time."
          options={options.data.categories}
          flag="isBreak"
          flagLabel="Break"
          addPlaceholder="New category, e.g. Signing appointment"
        />
        <OptionListCard
          list="work-types"
          title="Work types"
          description="Whose work it was. Turn off My time for work someone else did, such as an assistant: it is still tracked, but not counted in your work time."
          options={options.data.workTypes}
          flag="countsAsOwnTime"
          flagLabel="My time"
          addPlaceholder="New work type, e.g. Covering for a colleague"
        />
      </SimpleGrid>
    </PageStack>
  );
}
