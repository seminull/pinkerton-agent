/**
 * Convert user/import input to canonical E.164 storage. Numbers without an
 * explicit country code are treated as US numbers, matching this CRM's North
 * Texas audience. Null means blank or not a valid phone number.
 */
export const normalizePhoneNumber = (value: string | null): string | null => {
  const input = value?.trim().replace(/^tel:/i, "");
  if (!input) return null;
  // Extensions cannot be represented in E.164; reject instead of silently
  // attaching their digits to the subscriber number.
  if (/[a-z]/i.test(input)) return null;
  const digits = input.replace(/\D/g, "");
  let normalized: string;
  if (input.startsWith("+")) normalized = `+${digits}`;
  else if (input.startsWith("00")) normalized = `+${digits.slice(2)}`;
  else if (digits.length === 10) normalized = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) normalized = `+${digits}`;
  else return null;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
};
