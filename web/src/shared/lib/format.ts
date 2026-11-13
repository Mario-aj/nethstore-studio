import { formatThousands } from './stamp';

export const PRICE_MAX = 9_999_999;

/**
 * Parses what the user typed in the price field. Keeps digits only, drops
 * leading zeros and caps at 7 digits. Returns null for an empty field.
 */
export function parsePriceInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '').slice(0, 7);
  if (digits === '') return null;
  return Math.min(Number(digits), PRICE_MAX);
}

/** Value shown in the price field: "10.000", or "" when there is no price. */
export function formatPriceInput(price: number | null): string {
  return price === null ? '' : formatThousands(price);
}

/** 299 -> "4:59". */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

/** Date -> "13 NOV" in the device time zone. */
export function formatShortDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''}`;
}

/** [4, 7, 12] -> "4, 7 e 12". */
export function joinNumbers(values: readonly number[]): string {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} e ${values[values.length - 1]}`;
}
