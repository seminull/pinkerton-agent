export const normalizePhone = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
};

export const displayPhone = (value: string): string => {
  const normalized = normalizePhone(value);
  if (normalized.length !== 10) return value;
  return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`;
};
