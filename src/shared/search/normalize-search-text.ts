export const normalizeSearchText = (value: string | null) =>
  (value ?? '').normalize('NFC').toLowerCase();
