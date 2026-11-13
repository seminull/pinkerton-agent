export interface VCardContact {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}

export interface VCardParseResult {
  contacts: VCardContact[];
  skipped: number;
}

interface VCardProperty {
  name: string;
  parameters: string;
  value: string;
}

// Phone exports commonly use physical line folding, while older vCard 2.1
// writers use quoted-printable soft breaks. Resolve both before interpreting
// properties so names containing non-ASCII characters survive an import.
const unfoldLines = (source: string): string[] => {
  const physicalLines = source.replace(/\r\n?/g, "\n").split("\n");
  const lines: string[] = [];

  for (const physicalLine of physicalLines) {
    const previous = lines.at(-1);
    if (previous?.toUpperCase().includes("ENCODING=QUOTED-PRINTABLE")) {
      if (previous.endsWith("=")) {
        lines[lines.length - 1] = previous.slice(0, -1) + physicalLine;
        continue;
      }
    }

    if (/^[ \t]/.test(physicalLine) && previous !== undefined) {
      lines[lines.length - 1] = previous + physicalLine.slice(1);
      continue;
    }

    lines.push(physicalLine);
  }

  return lines;
};

const parseProperty = (line: string): VCardProperty | null => {
  const colon = line.indexOf(":");
  if (colon === -1) return null;

  const descriptor = line.slice(0, colon);
  const semicolon = descriptor.indexOf(";");
  const rawName = semicolon === -1 ? descriptor : descriptor.slice(0, semicolon);
  // Apple uses grouped names such as `item1.TEL`; the group identifies related
  // metadata but does not change which vCard property this is.
  const name = (rawName.split(".").at(-1) ?? rawName).toUpperCase();

  return {
    name,
    parameters: semicolon === -1 ? "" : descriptor.slice(semicolon + 1),
    value: line.slice(colon + 1),
  };
};

const decodeBytes = (bytes: number[], charset: string): string => {
  try {
    return new TextDecoder(charset).decode(Uint8Array.from(bytes));
  } catch {
    // UTF-8 is the least surprising fallback for an unrecognised or omitted
    // charset and is what modern iOS and Android exports use.
    return new TextDecoder().decode(Uint8Array.from(bytes));
  }
};

const decodeQuotedPrintable = (value: string, charset: string): string => {
  const bytes: number[] = [];
  const encoder = new TextEncoder();

  for (let index = 0; index < value.length; ) {
    const hex = value.slice(index + 1, index + 3);
    if (value[index] === "=" && /^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16));
      index += 3;
      continue;
    }

    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    bytes.push(...encoder.encode(character));
    index += character.length;
  }

  return decodeBytes(bytes, charset);
};

const decodeBase64 = (value: string, charset: string): string => {
  try {
    const binary = atob(value.replace(/\s/g, ""));
    return decodeBytes(
      Array.from(binary, (character) => character.charCodeAt(0)),
      charset
    );
  } catch {
    return value;
  }
};

const decodePropertyValue = (property: VCardProperty): string => {
  const charset =
    /(?:^|;)CHARSET=([^;:]+)/i.exec(property.parameters)?.[1] ?? "utf-8";
  if (/(?:^|;)ENCODING=QUOTED-PRINTABLE(?:;|$)/i.test(property.parameters)) {
    return decodeQuotedPrintable(property.value, charset);
  }
  if (/(?:^|;)ENCODING=(?:B|BASE64)(?:;|$)/i.test(property.parameters)) {
    return decodeBase64(property.value, charset);
  }
  return property.value;
};

const splitEscaped = (value: string, delimiter: string): string[] => {
  const parts: string[] = [];
  let part = "";
  let escaped = false;

  for (const character of value) {
    if (!escaped && character === delimiter) {
      parts.push(part);
      part = "";
      continue;
    }
    part += character;
    escaped = !escaped && character === "\\";
    if (character !== "\\") escaped = false;
  }
  parts.push(part);
  return parts;
};

const unescapeValue = (value: string): string =>
  value
    .replace(/\\n/gi, "\n")
    .replace(/\\([\\,;:])/g, "$1")
    .trim();

const preferredValue = (
  properties: VCardProperty[],
  name: string
): string | null => {
  const candidates = properties.filter((property) => property.name === name);
  const preferred =
    candidates.find((property) =>
      /(?:^|;)(?:TYPE=)?[^;]*\bPREF\b|(?:^|;)PREF=1(?:;|$)/i.test(
        property.parameters
      )
    ) ?? candidates[0];
  if (!preferred) return null;

  let value = unescapeValue(decodePropertyValue(preferred));
  if (name === "TEL") value = value.replace(/^tel:/i, "");
  if (name === "EMAIL") value = value.replace(/^mailto:/i, "");
  return value || null;
};

const nameFromProperties = (
  properties: VCardProperty[]
): Pick<VCardContact, "firstName" | "lastName"> | null => {
  const structured = properties.find((property) => property.name === "N");
  if (structured) {
    const parts = splitEscaped(decodePropertyValue(structured), ";").map(
      unescapeValue
    );
    const family = parts[0] ?? "";
    const given = parts[1] ?? "";
    const additional = parts[2] ?? "";
    const prefix = parts[3] ?? "";
    const suffix = parts[4] ?? "";
    const firstName = [prefix, given, additional].filter(Boolean).join(" ");
    const lastName = [family, suffix].filter(Boolean).join(" ");
    if (firstName && lastName) return { firstName, lastName };
  }

  const formatted = preferredValue(properties, "FN");
  if (!formatted) return null;
  const words = formatted.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  return {
    firstName: words.slice(0, -1).join(" "),
    lastName: words.at(-1) ?? "",
  };
};

const parseCard = (lines: string[]): VCardContact | null => {
  const properties = lines
    .map(parseProperty)
    .filter((property): property is VCardProperty => property !== null);
  const name = nameFromProperties(properties);
  if (!name) return null;

  return {
    ...name,
    email: preferredValue(properties, "EMAIL"),
    phone: preferredValue(properties, "TEL"),
  };
};

export const parseVCards = (source: string): VCardParseResult => {
  const cards: string[][] = [];
  let current: string[] | null = null;

  for (const line of unfoldLines(source)) {
    if (line.trim().toUpperCase() === "BEGIN:VCARD") {
      current = [];
      continue;
    }
    if (line.trim().toUpperCase() === "END:VCARD") {
      if (current) cards.push(current);
      current = null;
      continue;
    }
    if (current) current.push(line);
  }

  const contacts = cards
    .map(parseCard)
    .filter((contact): contact is VCardContact => contact !== null);

  return { contacts, skipped: cards.length - contacts.length };
};
