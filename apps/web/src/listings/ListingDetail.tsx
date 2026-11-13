import { useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Anchor,
  AspectRatio,
  Badge,
  Button,
  Card,
  Center,
  Grid,
  Group,
  Image,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { Dropzone, MIME_TYPES } from "@mantine/dropzone";
import { notifications } from "@mantine/notifications";
import {
  IconArrowLeft,
  IconExternalLink,
  IconPencil,
  IconPhoto,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { Link, useParams } from "react-router";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import { ApiError } from "../api/client";
import { formatDate, formatPriceCents, humanize } from "../format";
import PageStack from "../motion/PageStack";
import { LISTING_STATUS_COLORS } from "../theme";
import ListingFormModal from "./ListingFormModal";
import {
  listingPhotoUrl,
  useListing,
  useListingPhotos,
  useUploadListingPhotos,
} from "./queries";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text component="div" size="sm">
        {value ?? "—"}
      </Text>
    </Stack>
  );
}

const displayNumber = (value: number | null): string =>
  value === null ? "—" : value.toLocaleString();

const displayDecimal = (value: string | null, suffix = ""): string => {
  if (value === null) return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 4 })}${suffix}`;
};

const linkHost = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export default function ListingDetail() {
  const { listingId } = useParams();
  const { data, isPending, isError, error } = useListing(listingId);
  const photosQuery = useListingPhotos(listingId);
  const uploadPhotos = useUploadListingPhotos(listingId ?? "");
  const openPhotoPickerRef = useRef<() => void>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(-1);

  const handlePhotoDrop = async (files: File[]) => {
    try {
      const uploaded = await uploadPhotos.mutateAsync(files);
      notifications.show({
        color: "green",
        message: `${uploaded.length} ${uploaded.length === 1 ? "photo" : "photos"} uploaded`,
      });
    } catch (uploadError) {
      const code = uploadError instanceof ApiError ? uploadError.code : "upload_failed";
      const messages: Record<string, string> = {
        invalid_photo_size: "Each photo must be 10 MB or smaller.",
        unsupported_photo_type: "Photos must be JPEG, PNG, or WebP files.",
        photo_limit_reached: "This property already has the maximum of 50 photos.",
        photo_storage_unavailable: "Photo storage is temporarily unavailable.",
        http_413: "That photo is too large for the server.",
      };
      notifications.show({
        color: "red",
        title: "Photo upload failed",
        message: messages[code] ?? "The photo could not be uploaded. Please try again.",
      });
    }
  };

  if (isPending) {
    return (
      <PageStack>
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      </PageStack>
    );
  }

  if (isError) {
    return (
      <PageStack>
        <Button
          component={Link}
          to="/listings"
          variant="subtle"
          leftSection={<IconArrowLeft size={16} />}
          w="fit-content"
        >
          Listings
        </Button>
        <Alert color="red" title="Couldn't load property">
          {error instanceof Error ? error.message : "Unknown error"}
        </Alert>
      </PageStack>
    );
  }

  const { listing } = data;
  const streetAddress = [listing.addressLine1, listing.addressLine2]
    .filter(Boolean)
    .join(", ");
  const locality = `${listing.city}, ${listing.state} ${listing.postalCode}`;

  return (
    <PageStack>
      <Button
        component={Link}
        to="/listings"
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        w="fit-content"
      >
        Listings
      </Button>

      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Group gap="sm">
            <Title order={2}>{streetAddress}</Title>
            <Badge
              variant="light"
              color={LISTING_STATUS_COLORS[listing.status] ?? "gray"}
            >
              {humanize(listing.status)}
            </Badge>
          </Group>
          <Text c="dimmed">{locality}</Text>
        </Stack>
        <Button
          variant="light"
          leftSection={<IconPencil size={16} />}
          onClick={() => setEditOpen(true)}
        >
          Edit property
        </Button>
      </Group>

      <Grid align="stretch">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder padding={0} h="100%" style={{ overflow: "hidden" }}>
            <Dropzone
              onDrop={handlePhotoDrop}
              onReject={() =>
                notifications.show({
                  color: "red",
                  title: "Photo not accepted",
                  message: "Choose up to 10 JPEG, PNG, or WebP photos, each under 10 MB.",
                })
              }
              accept={[MIME_TYPES.jpeg, MIME_TYPES.png, MIME_TYPES.webp]}
              maxSize={MAX_PHOTO_BYTES}
              maxFiles={10}
              loading={uploadPhotos.isPending}
              multiple
              // The gallery contains several independent click targets. File
              // selection is explicit so a thumbnail can only open its viewer.
              activateOnClick={false}
              openRef={openPhotoPickerRef}
              p={0}
              radius={0}
              mih={290}
              h="100%"
              bd={0}
            >
              <Dropzone.Accept>
                <Center mih={290} bg="var(--mantine-color-blue-light)">
                  <Stack align="center" gap="xs" p="xl">
                    <IconUpload size={44} stroke={1.4} color="var(--mantine-color-blue-6)" />
                    <Text fw={600}>Drop photos to upload</Text>
                  </Stack>
                </Center>
              </Dropzone.Accept>
              <Dropzone.Reject>
                <Center mih={290} bg="var(--mantine-color-red-light)">
                  <Stack align="center" gap="xs" p="xl">
                    <IconX size={44} stroke={1.4} color="var(--mantine-color-red-6)" />
                    <Text fw={600}>That file cannot be uploaded</Text>
                    <Text size="sm" c="dimmed">
                      Use JPEG, PNG, or WebP files under 10 MB.
                    </Text>
                  </Stack>
                </Center>
              </Dropzone.Reject>
              <Dropzone.Idle>
                {!photosQuery.data ? (
                  <Center mih={290}>
                    {photosQuery.isError ? (
                      <Text c="red" size="sm">
                        Couldn't load property photos.
                      </Text>
                    ) : (
                      <Loader size="sm" />
                    )}
                  </Center>
                ) : photosQuery.data.photos.length === 0 ? (
                  <Center
                    mih={290}
                    style={{ background: "var(--mantine-color-default-hover)" }}
                  >
                    <Stack align="center" gap="xs" p="xl">
                      <IconPhoto
                        size={44}
                        stroke={1.4}
                        color="var(--mantine-color-dimmed)"
                      />
                      <Text fw={600}>Drag property photos here</Text>
                      <Text size="sm" c="dimmed" ta="center">
                        Or choose up to 10 JPEG, PNG, or WebP files from your device.
                      </Text>
                      <Text size="xs" c="dimmed">
                        10 MB maximum per photo
                      </Text>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconUpload size={14} />}
                        style={{ pointerEvents: "all" }}
                        onClick={(event) => {
                          event.stopPropagation();
                          openPhotoPickerRef.current?.();
                        }}
                      >
                        Choose photos
                      </Button>
                    </Stack>
                  </Center>
                ) : (
                  <Stack gap={0}>
                    <Group justify="space-between" px="sm" py="xs">
                      <Text size="sm" fw={600}>
                        {photosQuery.data.photos.length}{" "}
                        {photosQuery.data.photos.length === 1 ? "photo" : "photos"}
                      </Text>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconUpload size={14} />}
                        style={{ pointerEvents: "all" }}
                        onClick={(event) => {
                          event.stopPropagation();
                          openPhotoPickerRef.current?.();
                        }}
                      >
                        Add photos
                      </Button>
                    </Group>
                    <SimpleGrid cols={{ base: 2, sm: 3 }} spacing={4} p={4}>
                      {photosQuery.data.photos.map((photo, index) => {
                        const photoUrl = listingPhotoUrl(listing.id, photo.id);
                        return (
                          <UnstyledButton
                            key={photo.id}
                            w="100%"
                            display="block"
                            aria-label={`View ${photo.originalName} full screen`}
                            style={{ cursor: "zoom-in", pointerEvents: "all" }}
                            onClick={(event) => {
                              event.stopPropagation();
                              setPhotoIndex(index);
                            }}
                          >
                            <AspectRatio ratio={4 / 3}>
                              <Image src={photoUrl} alt={photo.originalName} fit="cover" />
                            </AspectRatio>
                          </UnstyledButton>
                        );
                      })}
                    </SimpleGrid>
                  </Stack>
                )}
              </Dropzone.Idle>
            </Dropzone>
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder padding="lg" h="100%">
            <Stack gap="lg">
              <Stack gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  {listing.listingType === "lease" ? "Monthly rent" : "List price"}
                </Text>
                <Text size="xl" fw={700}>
                  {formatPriceCents(listing.listPriceCents)}
                </Text>
              </Stack>
              <SimpleGrid cols={2} spacing="lg">
                <Field label="Beds" value={displayNumber(listing.bedrooms)} />
                <Field label="Baths" value={displayDecimal(listing.bathrooms)} />
                <Field
                  label="Living area"
                  value={
                    listing.livingAreaSqft === null
                      ? "—"
                      : `${listing.livingAreaSqft.toLocaleString()} sq ft`
                  }
                />
                <Field label="Year built" value={displayNumber(listing.yearBuilt)} />
              </SimpleGrid>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      <Lightbox
        open={photoIndex >= 0}
        close={() => setPhotoIndex(-1)}
        index={Math.max(photoIndex, 0)}
        slides={(photosQuery.data?.photos ?? []).map((photo) => ({
          src: listingPhotoUrl(listing.id, photo.id),
          alt: photo.originalName,
        }))}
        plugins={[Zoom]}
        zoom={{ maxZoomPixelRatio: 3 }}
      />

      <Card withBorder padding="lg">
        <Title order={4} mb="md">
          Property details
        </Title>
        <Grid>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <Field label="MLS number" value={listing.mlsNumber ?? "—"} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <Field
              label="Listing type"
              value={listing.listingType === "lease" ? "For lease" : "For sale"}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <Field label="Parcel number" value={listing.parcelNumber ?? "—"} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <Field label="Listed on" value={formatDate(listing.listedOn)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <Field label="Lot size" value={displayDecimal(listing.lotAcres, " acres")} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <Field
              label="Seller"
              value={
                listing.seller ? (
                  <Anchor component={Link} to={`/contacts/${listing.seller.id}`}>
                    {listing.seller.firstName} {listing.seller.lastName}
                  </Anchor>
                ) : (
                  "—"
                )
              }
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <Field label="Added" value={formatDate(listing.createdAt)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <Field label="Last updated" value={formatDate(listing.updatedAt)} />
          </Grid.Col>
        </Grid>
      </Card>

      <Card withBorder padding="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>External links</Title>
          <Text size="sm" c="dimmed">
            {listing.externalLinks.length} {listing.externalLinks.length === 1 ? "link" : "links"}
          </Text>
        </Group>
        {listing.externalLinks.length === 0 ? (
          <Text size="sm" c="dimmed">
            No links saved. Edit the property to add Zillow or another property page.
          </Text>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {listing.externalLinks.map((link, index) => (
              <Anchor
                key={`${link.url}-${index}`}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                underline="never"
              >
                <Card withBorder padding="sm">
                  <Group justify="space-between" wrap="nowrap">
                    <Stack gap={1} style={{ minWidth: 0 }}>
                      <Text fw={600} size="sm">
                        {link.label}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {linkHost(link.url)}
                      </Text>
                    </Stack>
                    <IconExternalLink size={16} />
                  </Group>
                </Card>
              </Anchor>
            ))}
          </SimpleGrid>
        )}
      </Card>

      <Card withBorder padding="lg">
        <Title order={4} mb="md">
          Notes
        </Title>
        <Text size="sm" c={listing.notes ? undefined : "dimmed"} style={{ whiteSpace: "pre-wrap" }}>
          {listing.notes ?? "No notes added."}
        </Text>
      </Card>

      <ListingFormModal
        key={`${listing.id}-${listing.updatedAt}`}
        opened={editOpen}
        onClose={() => setEditOpen(false)}
        listing={listing}
      />
    </PageStack>
  );
}
