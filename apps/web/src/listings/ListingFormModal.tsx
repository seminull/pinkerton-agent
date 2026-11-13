import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { ApiError } from "../api/client";
import type {
  ExternalLink,
  Listing,
  ListingLookup,
  ListingStatus,
  ListingType,
} from "../api/types";
import { dollarsToCents } from "../format";
import { useContacts } from "../contacts/queries";
import {
  useCreateListing,
  useImportMatrixPhotos,
  useUpdateListing,
  type ListingInput,
} from "./queries";

const STATUS_OPTIONS: { value: ListingStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "coming_soon", label: "Coming soon" },
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "sold", label: "Sold" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "expired", label: "Expired" },
];

const LISTING_TYPE_OPTIONS: { value: ListingType; label: string }[] = [
  { value: "sale", label: "For sale" },
  { value: "lease", label: "For lease" },
];

interface Props {
  opened: boolean;
  onClose: () => void;
  listing?: Listing;
  /**
   * A lookup result to start a NEW listing from Zillow or Matrix. Its draft
   * pre-fills the form; nothing is saved until the person presses Create.
   * Ignored when editing an existing listing.
   */
  lookup?: ListingLookup;
}

// What the form says above its fields when it was opened from a lookup: where
// the pre-filled details came from and how far to trust them. The differences
// matter — a confident match can be skimmed, a probable one needs its address
// checked, and a miss means only the address was filled in.
const lookupNotice = (
  lookup: ListingLookup
): { color: string; title: string; message: string } => {
  if (lookup.source === "matrix") {
    return {
      color: "green",
      title: "Loaded from NTREIS Matrix",
      message: `MLS details were filled in from the shared listing. Review them before creating the property.${
        lookup.photoCount > 0
          ? ` ${lookup.photoCount.toLocaleString()} photos will be copied into this app after creation.`
          : ""
      }`,
    };
  }
  if (lookup.status === "matched" && lookup.quality === "exact") {
    return {
      color: "green",
      title: "Found in county records",
      message:
        "Address and home details were filled in from the county appraisal record. Add the price and status, then check the rest.",
    };
  }
  if (lookup.status === "matched") {
    return {
      color: "yellow",
      title: "Probable match — check the address",
      message:
        "The county record found is the closest fit, not an exact one (the street may be spelled differently, or it may be a unit of the building). Confirm the address and details before saving.",
    };
  }
  if (lookup.status === "ambiguous") {
    return {
      color: "yellow",
      title: "More than one home fits that address",
      message:
        "County records have several addresses matching the link, so none was chosen. The address from the link is filled in; enter the home's details yourself.",
    };
  }
  return {
    color: "blue",
    title: "Not in BigDistrict's records",
    message:
      "BigDistrict covers Dallas, Tarrant, Collin, and Denton counties. Only the address from the link was filled in — check that the street and city are split correctly, and enter the rest.",
  };
};

const lookupLinks = (lookup: ListingLookup | undefined): ExternalLink[] => {
  if (!lookup) return [];
  if (lookup.source === "matrix") {
    return [{ label: "NTREIS Matrix", url: lookup.sourceUrl }];
  }
  return [
    { label: "Zillow", url: lookup.sourceUrl },
    ...(lookup.bigDistrictUrl
      ? [{ label: "County record", url: lookup.bigDistrictUrl }]
      : []),
  ];
};

const isWebUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export default function ListingFormModal({ opened, onClose, listing, lookup }: Props) {
  // An edit never takes a draft: its values are the listing's own.
  const draft = listing ? undefined : lookup?.draft;
  const create = useCreateListing();
  const update = useUpdateListing();
  const importMatrixPhotos = useImportMatrixPhotos();
  const isEdit = Boolean(listing);

  // The seller picker. Capped at the first 100 — replace with a searchable
  // async select once an agent's book outgrows one page.
  const { data: contactsData } = useContacts({ limit: 100 });
  const sellerOptions = (contactsData?.results ?? []).map((contact) => ({
    value: contact.id,
    label: `${contact.firstName} ${contact.lastName}`,
  }));

  const form = useForm({
    initialValues: {
      addressLine1: listing?.addressLine1 ?? draft?.addressLine1 ?? "",
      addressLine2: listing?.addressLine2 ?? "",
      city: listing?.city ?? draft?.city ?? "",
      state: listing?.state ?? draft?.state ?? "TX",
      postalCode: listing?.postalCode ?? draft?.postalCode ?? "",
      mlsNumber: listing?.mlsNumber ?? draft?.mlsNumber ?? "",
      status: listing?.status ?? draft?.status ?? ("draft" as ListingStatus),
      listingType:
        listing?.listingType ?? draft?.listingType ?? ("sale" as ListingType),
      // The form works in dollars; the API and column are in cents.
      priceDollars:
        listing?.listPriceCents !== null && listing?.listPriceCents !== undefined
          ? Number(listing.listPriceCents) / 100
          : draft?.listPriceCents !== null && draft?.listPriceCents !== undefined
            ? draft.listPriceCents / 100
            : ("" as number | ""),
      bedrooms: (listing?.bedrooms ?? draft?.bedrooms ?? "") as number | "",
      bathrooms: (listing?.bathrooms
        ? Number(listing.bathrooms)
        : (draft?.bathrooms ?? "")) as number | "",
      livingAreaSqft: (listing?.livingAreaSqft ?? draft?.livingAreaSqft ?? "") as number | "",
      // DECIMAL column, so it arrives as a string on an existing listing.
      lotAcres: (listing?.lotAcres
        ? Number(listing.lotAcres)
        : (draft?.lotAcres ?? "")) as number | "",
      yearBuilt: (listing?.yearBuilt ?? draft?.yearBuilt ?? "") as number | "",
      parcelNumber: listing?.parcelNumber ?? draft?.parcelNumber ?? "",
      listedOn: listing?.listedOn ?? "",
      sellerContactId: listing?.sellerContactId ?? "",
      // A lookup already knows the source portal and, on a match, the county
      // record. Seed both as real links instead of burying them in notes.
      externalLinks: (listing?.externalLinks ?? lookupLinks(lookup)) as ExternalLink[],
      notes: listing?.notes ?? draft?.notes ?? "",
    },
    validate: {
      addressLine1: (value) => (value.trim() ? null : "Street address is required"),
      city: (value) => (value.trim() ? null : "City is required"),
      state: (value) =>
        value.trim().length === 2 ? null : "Use the two-letter state code",
      postalCode: (value) => (value.trim() ? null : "ZIP is required"),
    },
  });

  const handleSubmit = form.onSubmit(async (values) => {
    let hasLinkError = false;
    values.externalLinks.forEach((link, index) => {
      const label = link.label.trim();
      const url = link.url.trim();
      // A completely blank added row is harmless and simply is not saved.
      if (!label && !url) return;
      if (!label) {
        form.setFieldError(`externalLinks.${index}.label`, "Add a label");
        hasLinkError = true;
      }
      if (!url || !isWebUrl(url)) {
        form.setFieldError(
          `externalLinks.${index}.url`,
          "Enter a full http:// or https:// URL"
        );
        hasLinkError = true;
      }
    });
    if (hasLinkError) return;

    const externalLinks = values.externalLinks
      .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
      .filter((link) => link.label && link.url);
    const { priceDollars, bathrooms, lotAcres, ...rest } = values;
    const payload: ListingInput = {
      ...rest,
      state: rest.state.toUpperCase(),
      listPriceCents: dollarsToCents(priceDollars),
      // DECIMAL columns round-trip as strings; send one so the value the API
      // stores is exactly what was typed.
      bathrooms: bathrooms === "" ? null : String(bathrooms),
      lotAcres: lotAcres === "" ? null : String(lotAcres),
      bedrooms: rest.bedrooms === "" ? null : rest.bedrooms,
      livingAreaSqft: rest.livingAreaSqft === "" ? null : rest.livingAreaSqft,
      yearBuilt: rest.yearBuilt === "" ? null : rest.yearBuilt,
      listedOn: rest.listedOn || null,
      addressLine2: rest.addressLine2 || null,
      mlsNumber: rest.mlsNumber || null,
      parcelNumber: rest.parcelNumber || null,
      sellerContactId: rest.sellerContactId || null,
      externalLinks,
      notes: rest.notes || null,
    };

    try {
      if (listing) {
        await update.mutateAsync({ id: listing.id, ...payload });
        notifications.show({ message: "Listing updated", color: "green" });
      } else {
        const result = await create.mutateAsync(payload);
        let photoMessage = "";
        if (lookup?.source === "matrix" && lookup.photoCount > 0) {
          try {
            const photos = await importMatrixPhotos.mutateAsync({
              listingId: result.listing.id,
              url: lookup.sourceUrl,
            });
            if (photos.imported > 0) {
              photoMessage = ` ${photos.imported.toLocaleString()} photo${photos.imported === 1 ? " was" : "s were"} copied.`;
            }
            if (photos.failed > 0 || photos.omitted > 0) {
              photoMessage += ` ${(photos.failed + photos.omitted).toLocaleString()} photo${
                photos.failed + photos.omitted === 1 ? " was" : "s were"
              } not copied.`;
            }
          } catch {
            photoMessage = " The property was created, but its Matrix photos could not be copied.";
          }
        }
        notifications.show({
          message: `Listing created.${photoMessage}`,
          color: photoMessage.includes("not copied") || photoMessage.includes("could not")
            ? "yellow"
            : "green",
          autoClose: 8000,
        });
      }
      form.reset();
      onClose();
    } catch (error) {
      notifications.show({
        title: "Save failed",
        message: error instanceof ApiError ? error.code : "Unexpected error",
        color: "red",
      });
    }
  });

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!create.isPending && !update.isPending && !importMatrixPhotos.isPending) {
          onClose();
        }
      }}
      title={isEdit ? "Edit listing" : "New listing"}
      size="lg"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          {/* Only when this form was opened from a listing lookup. */}
          {!listing && lookup && (
            <Alert color={lookupNotice(lookup).color} title={lookupNotice(lookup).title}>
              {lookupNotice(lookup).message}
            </Alert>
          )}
          <TextInput
            label="Street address"
            withAsterisk
            {...form.getInputProps("addressLine1")}
          />
          <TextInput
            label="Unit / suite"
            {...form.getInputProps("addressLine2")}
          />
          <Group grow>
            <TextInput label="City" withAsterisk {...form.getInputProps("city")} />
            <TextInput
              label="State"
              withAsterisk
              maxLength={2}
              {...form.getInputProps("state")}
            />
            <TextInput label="ZIP" withAsterisk {...form.getInputProps("postalCode")} />
          </Group>
          <Group grow>
            <Select
              label="Listing type"
              data={LISTING_TYPE_OPTIONS}
              allowDeselect={false}
              {...form.getInputProps("listingType")}
            />
            <Select
              label="Status"
              data={STATUS_OPTIONS}
              allowDeselect={false}
              {...form.getInputProps("status")}
            />
            <NumberInput
              label={form.values.listingType === "lease" ? "Monthly rent" : "List price"}
              prefix="$"
              thousandSeparator=","
              min={0}
              {...form.getInputProps("priceDollars")}
            />
          </Group>
          <Group grow>
            <TextInput label="MLS #" {...form.getInputProps("mlsNumber")} />
            <TextInput label="Parcel number" {...form.getInputProps("parcelNumber")} />
            <TextInput
              type="date"
              label="Listed on"
              {...form.getInputProps("listedOn")}
            />
          </Group>
          <Group grow>
            <NumberInput label="Beds" min={0} {...form.getInputProps("bedrooms")} />
            <NumberInput
              label="Baths"
              min={0}
              step={0.5}
              decimalScale={1}
              {...form.getInputProps("bathrooms")}
            />
            <NumberInput
              label="Sq ft"
              min={0}
              thousandSeparator=","
              {...form.getInputProps("livingAreaSqft")}
            />
            <NumberInput
              label="Year built"
              min={1700}
              max={new Date().getFullYear() + 2}
              {...form.getInputProps("yearBuilt")}
            />
            <NumberInput
              label="Lot (acres)"
              min={0}
              decimalScale={4}
              {...form.getInputProps("lotAcres")}
            />
          </Group>
          <Select
            label="Seller"
            placeholder="Unassigned"
            searchable
            clearable
            data={sellerOptions}
            {...form.getInputProps("sellerContactId")}
          />
          <Group justify="space-between" align="flex-end" mt="xs">
            <Stack gap={1}>
              <Text fw={600} size="sm">
                External links
              </Text>
              <Text size="xs" c="dimmed">
                Zillow, Realtor.com, Redfin, county records, or another property page.
              </Text>
            </Stack>
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={() => form.insertListItem("externalLinks", { label: "", url: "" })}
            >
              Add link
            </Button>
          </Group>
          {form.values.externalLinks.length === 0 ? (
            <Text size="sm" c="dimmed">
              No external links saved.
            </Text>
          ) : (
            <Stack gap="xs">
              {form.values.externalLinks.map((_link, index) => (
                <Group key={index} align="flex-start" wrap="nowrap">
                  <TextInput
                    label="Label"
                    placeholder="Zillow"
                    w={180}
                    {...form.getInputProps(`externalLinks.${index}.label`)}
                  />
                  <TextInput
                    label="URL"
                    placeholder="https://…"
                    flex={1}
                    {...form.getInputProps(`externalLinks.${index}.url`)}
                  />
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    mt={26}
                    aria-label={`Remove link ${index + 1}`}
                    onClick={() => form.removeListItem("externalLinks", index)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          )}
          <Textarea label="Notes" autosize minRows={2} {...form.getInputProps("notes")} />
          <Group justify="flex-end" mt="sm">
            <Button
              variant="subtle"
              onClick={onClose}
              disabled={create.isPending || update.isPending || importMatrixPhotos.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={create.isPending || update.isPending || importMatrixPhotos.isPending}
            >
              {importMatrixPhotos.isPending ? "Copying photos" : isEdit ? "Save" : "Create"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
