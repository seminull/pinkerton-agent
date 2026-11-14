import { isValidPhoneNumber, parsePhoneNumberFromString } from "libphonenumber-js";

/** E.164 remains the wire/export value; screens use a familiar readable form. */
export const formatContactPhone = (value: string | null): string => {
  if (!value) return "—";
  const phone = parsePhoneNumberFromString(value, "US");
  if (!phone?.isValid()) return value;
  return phone.country === "US" || phone.country === "CA"
    ? phone.formatNational()
    : phone.formatInternational();
};

export const isContactPhoneValid = (value: string): boolean =>
  !value || isValidPhoneNumber(value, "US");
