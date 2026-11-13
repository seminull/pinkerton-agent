export interface MatrixCsvContact {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export interface MatrixCsvParseResult {
  contacts: MatrixCsvContact[];
  skipped: number;
}

// Matrix exports RFC 4180-style CSV: fields are quoted, embedded quotes are
// doubled, and notes may contain commas or line breaks. Keeping the parser
// here (rather than splitting on commas) also makes previewing the file safe.
const parseCsv = (source: string): string[][] => {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field === "") {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("The CSV ends in the middle of a quoted value.");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
};

const clean = (value: string | undefined): string =>
  (value ?? "").trim().replace(/[ \t]+/g, " ");

const firstEmail = (value: string): { primary: string | null; others: string[] } => {
  const emails = value
    .split(/[;,]/)
    .map(clean)
    .filter(Boolean);
  return { primary: emails[0] ?? null, others: emails.slice(1) };
};

const phoneDigits = (value: string): string => value.replace(/\D/g, "");

/** Turn Matrix-only fields into readable notes instead of silently losing them. */
const matrixNotes = (
  get: (header: string) => string,
  primaryPhone: string | null,
  additionalEmails: string[]
): string | null => {
  const lines: string[] = [];
  const add = (label: string, value: string) => {
    if (value) lines.push(`${label}: ${value}`);
  };

  add("Middle name", get("name_middle"));
  add("Title", get("name_title"));
  add("Suffix", get("name_suffix"));
  add("Spouse", get("name_spouse"));

  const address = (prefix: "addr_home" | "addr_bus"): string => {
    const street = get(`${prefix}_street`);
    const locality = [get(`${prefix}_city`), get(`${prefix}_state`)]
      .filter(Boolean)
      .join(", ");
    const localityAndZip = [locality, get(`${prefix}_zip`)]
      .filter(Boolean)
      .join(" ");
    return [street, localityAndZip, get(`${prefix}_country`)]
      .filter(Boolean)
      .join(", ");
  };
  add("Home address", address("addr_home"));
  add("Business address", address("addr_bus"));

  add("Company", get("company_name"));
  add("Department", get("company_department"));
  add("Office", get("company_office"));
  add("Profession", get("profession"));
  add("Website", get("www"));
  for (const email of additionalEmails) add("Additional email", email);

  const phoneFields = [
    ["Home phone", "telephone_home"],
    ["Office phone", "telephone_office"],
    ["Fax", "telephone_fax"],
    ["Pager", "telephone_pager"],
    ["Mobile phone", "telephone_mobile"],
    ["Other phone", "telephone_other"],
  ] as const;
  const primaryDigits = phoneDigits(primaryPhone ?? "");
  const seen = new Set(primaryDigits ? [primaryDigits] : []);
  for (const [label, header] of phoneFields) {
    const value = get(header);
    const digits = phoneDigits(value);
    if (!value || (digits && seen.has(digits))) continue;
    add(label, value);
    if (digits) seen.add(digits);
  }

  const originalNotes = get("notes");
  if (originalNotes) {
    if (lines.length > 0) lines.push("");
    lines.push(originalNotes);
  }
  return lines.length > 0 ? lines.join("\n") : null;
};

/** Parse the contacts CSV produced by NTREIS Matrix. */
export const parseMatrixCsv = (source: string): MatrixCsvParseResult => {
  const table = parseCsv(source);
  const header = table[0]?.map((name) => clean(name).toLowerCase());
  if (!header || header.every((name) => !name)) {
    throw new Error("That file is empty.");
  }

  const required = ["name_first", "name_last"];
  if (required.some((name) => !header.includes(name))) {
    throw new Error(
      "This doesn’t look like a Matrix contacts export. It needs name_first and name_last columns."
    );
  }

  const columns = new Map(header.map((name, index) => [name, index]));
  const contacts: MatrixCsvContact[] = [];
  let skipped = 0;

  for (const cells of table.slice(1)) {
    if (cells.every((cell) => !clean(cell))) continue;
    const get = (name: string): string => clean(cells[columns.get(name) ?? -1]);
    const firstName = get("name_first");
    const lastName = get("name_last");
    if (!firstName || !lastName) {
      skipped += 1;
      continue;
    }

    const { primary: email, others: additionalEmails } = firstEmail(get("email1"));
    // A cell number is normally the best number to put in the CRM's single
    // phone field; fall back through the other Matrix phone columns.
    const phone =
      [
        "telephone_mobile",
        "telephone_home",
        "telephone_office",
        "telephone_other",
        "telephone_pager",
        "telephone_fax",
      ]
        .map(get)
        .find(Boolean) ?? null;

    contacts.push({
      firstName,
      lastName,
      email,
      phone,
      notes: matrixNotes(get, phone, additionalEmails),
    });
  }

  return { contacts, skipped };
};
