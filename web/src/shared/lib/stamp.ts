// Stamp text rules (SPEC 9.2). The Go side (api/internal/stamp/text.go) implements
// the same algorithm; both are checked against testdata/stamp-text.json.

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'] as const;
export type Size = (typeof SIZES)[number];

export const DESCRIPTION_MAX = 24;

/** Allowed description characters: letters, numbers, space and . , ' ( ) & + */
const DESCRIPTION_ALLOWED = /^[\p{L}\p{N} .,'()&+]*$/u;

export function isSize(value: string): value is Size {
  return (SIZES as readonly string[]).includes(value);
}

/** Sorts sizes in canonical order (XS, S, M, L, XL, 2XL) and drops duplicates. */
export function canonicalSizes(sizes: readonly string[]): Size[] {
  return SIZES.filter((size) => sizes.includes(size));
}

/** "M", "M e L", "S, M e L". */
export function joinSizes(sizes: readonly string[]): string {
  const ordered = canonicalSizes(sizes);
  if (ordered.length <= 1) return ordered.join('');
  return `${ordered.slice(0, -1).join(', ')} e ${ordered[ordered.length - 1]}`;
}

/** NFC, trimmed, inner whitespace collapsed. Empty becomes null. */
export function normalizeDescription(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  return normalized === '' ? null : normalized;
}

export type DescriptionProblem = 'too_long' | 'invalid_chars';

/** Mirrors the API validation so the form can explain the problem before sending. */
export function descriptionProblem(value: string): DescriptionProblem | null {
  const normalized = normalizeDescription(value);
  if (normalized === null) return null;
  if ([...normalized].length > DESCRIPTION_MAX) return 'too_long';
  if (!DESCRIPTION_ALLOWED.test(normalized)) return 'invalid_chars';
  return null;
}

/** 10000 -> "10.000" (dots as thousands separators). */
export function formatThousands(value: number): string {
  const digits = String(Math.trunc(Math.abs(value)));
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 10000 -> "10.000 kz". */
export function formatKz(value: number): string {
  return `${formatThousands(value)} kz`;
}

export interface StampInput {
  priceKz: number;
  sizes: readonly string[];
  description?: string | null;
}

export interface StampLines {
  line1: string;
  line2: string;
}

export function stampLines({ priceKz, sizes, description }: StampInput): StampLines {
  const joined = joinSizes(sizes);
  const desc = normalizeDescription(description);
  return {
    line1: desc ? `${desc}/ ${joined}` : joined,
    line2: formatKz(priceKz),
  };
}
