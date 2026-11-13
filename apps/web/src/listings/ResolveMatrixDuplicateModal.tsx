import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Modal,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import type { Listing } from "../api/types";
import { formatDate, formatPriceCents, humanize } from "../format";
import type { ListingUrlLookupResult } from "./queries";

export type MatrixResolutionMode = "add" | "full" | "partial";

export interface MatrixResolution {
  mode: MatrixResolutionMode;
  /** Present for full/partial replacement; absent when adding a new row. */
  initialListing?: Listing;
  replacePhotos: boolean;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  result: ListingUrlLookupResult;
  onResolve: (resolution: MatrixResolution) => void;
}

type Side = "current" | "matrix";
type MergeKey =
  | "addressLine1"
  | "addressLine2"
  | "city"
  | "state"
  | "postalCode"
  | "mlsNumber"
  | "listingType"
  | "status"
  | "listPriceCents"
  | "bedrooms"
  | "bathrooms"
  | "livingAreaSqft"
  | "lotAcres"
  | "yearBuilt"
  | "parcelNumber"
  | "listedOn"
  | "sellerContactId"
  | "externalLinks"
  | "notes"
  | "photos";

const FIELD_LABELS: Array<{ key: MergeKey; label: string }> = [
  { key: "addressLine1", label: "Street address" },
  { key: "addressLine2", label: "Unit / suite" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "postalCode", label: "ZIP" },
  { key: "mlsNumber", label: "MLS #" },
  { key: "listingType", label: "Listing type" },
  { key: "status", label: "Status" },
  { key: "listPriceCents", label: "Price / rent" },
  { key: "bedrooms", label: "Beds" },
  { key: "bathrooms", label: "Baths" },
  { key: "livingAreaSqft", label: "Square feet" },
  { key: "lotAcres", label: "Lot acres" },
  { key: "yearBuilt", label: "Year built" },
  { key: "parcelNumber", label: "Parcel number" },
  { key: "listedOn", label: "Listed on" },
  { key: "sellerContactId", label: "Seller" },
  { key: "externalLinks", label: "External links" },
  { key: "notes", label: "Notes" },
  { key: "photos", label: "Photos" },
];

const matrixVersion = (current: Listing, result: ListingUrlLookupResult): Listing => {
  const draft = result.lookup.draft;
  return {
    ...current,
    addressLine1: draft.addressLine1,
    addressLine2: null,
    city: draft.city,
    state: draft.state,
    postalCode: draft.postalCode,
    mlsNumber: draft.mlsNumber,
    listingType: draft.listingType,
    status: draft.status ?? "draft",
    listPriceCents: draft.listPriceCents,
    bedrooms: draft.bedrooms,
    bathrooms: draft.bathrooms === null ? null : String(draft.bathrooms),
    livingAreaSqft: draft.livingAreaSqft,
    lotAcres: draft.lotAcres === null ? null : String(draft.lotAcres),
    yearBuilt: draft.yearBuilt,
    parcelNumber: draft.parcelNumber,
    listedOn: null,
    sellerContactId: null,
    seller: undefined,
    externalLinks: [{ label: "NTREIS Matrix", url: result.lookup.sourceUrl }],
    notes: draft.notes || null,
  };
};

const displayValue = (
  key: MergeKey,
  listing: Listing,
  photoCount: number
): string => {
  const blank = "Blank";
  switch (key) {
    case "listingType":
      return listing.listingType === "lease" ? "For lease" : "For sale";
    case "status":
      return humanize(listing.status);
    case "listPriceCents":
      return listing.listPriceCents === null
        ? blank
        : `${formatPriceCents(listing.listPriceCents)}${
            listing.listingType === "lease" ? " / mo" : ""
          }`;
    case "listedOn":
      return listing.listedOn ? formatDate(listing.listedOn) : blank;
    case "sellerContactId":
      return listing.seller
        ? `${listing.seller.firstName} ${listing.seller.lastName}`
        : blank;
    case "externalLinks":
      return listing.externalLinks.length > 0
        ? listing.externalLinks.map((link) => link.label).join(", ")
        : blank;
    case "photos":
      return `${photoCount.toLocaleString()} photo${photoCount === 1 ? "" : "s"}`;
    default: {
      const value = listing[key as keyof Listing];
      return value === null || value === undefined || value === "" ? blank : String(value);
    }
  }
};

const initialChoices = (): Record<MergeKey, Side> =>
  Object.fromEntries(
    FIELD_LABELS.map(({ key }) => [
      key,
      key === "addressLine2" || key === "listedOn" || key === "sellerContactId"
        ? "current"
        : "matrix",
    ])
  ) as Record<MergeKey, Side>;

export default function ResolveMatrixDuplicateModal({
  opened,
  onClose,
  result,
  onResolve,
}: Props) {
  const current = result.existingListing!;
  const matrix = matrixVersion(current, result);
  const [partial, setPartial] = useState(false);
  const [choices, setChoices] = useState<Record<MergeKey, Side>>(initialChoices);

  const choose = (key: MergeKey, side: Side) =>
    setChoices((values) => ({ ...values, [key]: side }));

  const mergedListing = (): Listing => {
    const pick = <K extends keyof Listing>(key: K): Listing[K] =>
      choices[key as MergeKey] === "matrix" ? matrix[key] : current[key];
    return {
      ...current,
      addressLine1: pick("addressLine1"),
      addressLine2: pick("addressLine2"),
      city: pick("city"),
      state: pick("state"),
      postalCode: pick("postalCode"),
      mlsNumber: pick("mlsNumber"),
      listingType: pick("listingType"),
      status: pick("status"),
      listPriceCents: pick("listPriceCents"),
      bedrooms: pick("bedrooms"),
      bathrooms: pick("bathrooms"),
      livingAreaSqft: pick("livingAreaSqft"),
      lotAcres: pick("lotAcres"),
      yearBuilt: pick("yearBuilt"),
      parcelNumber: pick("parcelNumber"),
      listedOn: pick("listedOn"),
      sellerContactId: pick("sellerContactId"),
      seller: choices.sellerContactId === "matrix" ? undefined : current.seller,
      externalLinks: pick("externalLinks"),
      notes: pick("notes"),
    };
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Property may already exist"
      size={partial ? "90rem" : "lg"}
    >
      <Stack gap="md">
        <Alert color="yellow" title={`${current.addressLine1}, ${current.city}`}>
          Matrix matched this property by {result.matchReason === "mls" ? "MLS number" : "address"}.
          Choose whether to keep both records or update the existing one.
        </Alert>

        {!partial ? (
          <Stack gap="sm">
            <Button
              variant="light"
              onClick={() => onResolve({ mode: "add", replacePhotos: false })}
            >
              Add New
            </Button>
            <Text size="sm" c="dimmed">
              Create a separate property from Matrix and leave the existing property untouched.
            </Text>

            <Button
              variant="light"
              color="orange"
              onClick={() =>
                onResolve({
                  mode: "full",
                  initialListing: matrix,
                  replacePhotos: true,
                })
              }
            >
              Full Replace
            </Button>
            <Text size="sm" c="dimmed">
              Review a form where every editable field and the photo gallery come from Matrix.
              Current-only values such as seller and listed date will be blank.
            </Text>

            <Button onClick={() => setPartial(true)}>Partial Replace</Button>
            <Text size="sm" c="dimmed">
              Choose the current or Matrix value separately for every field and for photos.
            </Text>

            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
            </Group>
          </Stack>
        ) : (
          <>
            <Text size="sm" c="dimmed">
              Each row controls the value placed into the review form. Nothing changes until
              you review that form and press Replace.
            </Text>
            <ScrollArea h="min(62vh, 680px)" type="auto">
              <Table striped withTableBorder verticalSpacing="sm" stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={150}>Field</Table.Th>
                    <Table.Th>Current property</Table.Th>
                    <Table.Th>Matrix listing</Table.Th>
                    <Table.Th w={190}>Keep from</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {FIELD_LABELS.map(({ key, label }) => (
                    <Table.Tr key={key}>
                      <Table.Td fw={600}>{label}</Table.Td>
                      <Table.Td>
                        <Text size="sm" lineClamp={key === "notes" ? 4 : 2}>
                          {displayValue(key, current, result.existingPhotoCount)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" lineClamp={key === "notes" ? 4 : 2}>
                          {displayValue(key, matrix, result.lookup.photoCount)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <SegmentedControl
                          fullWidth
                          size="xs"
                          value={choices[key]}
                          onChange={(value) => choose(key, value as Side)}
                          data={[
                            { value: "current", label: "Current" },
                            { value: "matrix", label: "Matrix" },
                          ]}
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            <Group justify="space-between">
              <Button variant="default" onClick={() => setPartial(false)}>
                Back
              </Button>
              <Group>
                <Button variant="subtle" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    onResolve({
                      mode: "partial",
                      initialListing: mergedListing(),
                      replacePhotos: choices.photos === "matrix",
                    })
                  }
                >
                  Review Partial Replace
                </Button>
              </Group>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
