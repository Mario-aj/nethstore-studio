import { describe, expect, it } from 'vitest';
import { formatCountdown, formatPriceInput, formatShortDate, joinNumbers, parsePriceInput } from './format';

describe('price input', () => {
  it('keeps digits only and stores an integer', () => {
    expect(parsePriceInput('10.000')).toBe(10000);
    expect(parsePriceInput('10.0005')).toBe(100005);
    expect(parsePriceInput('1a2b3')).toBe(123);
    expect(parsePriceInput('')).toBeNull();
    expect(parsePriceInput('kz')).toBeNull();
  });

  it('drops leading zeros and caps at 9.999.999', () => {
    expect(parsePriceInput('000')).toBeNull();
    expect(parsePriceInput('0050')).toBe(50);
    expect(parsePriceInput('123456789')).toBe(1234567);
    expect(parsePriceInput('9999999')).toBe(9999999);
  });

  it('formats with dots while typing', () => {
    const typed = ['1', '10', '100', '1000', '10000'];
    let value: number | null = null;
    const shown = typed.map((raw) => {
      value = parsePriceInput(raw);
      return formatPriceInput(value);
    });
    expect(shown).toEqual(['1', '10', '100', '1.000', '10.000']);
    expect(formatPriceInput(null)).toBe('');
  });
});

describe('formatCountdown', () => {
  it('shows m:ss', () => {
    expect(formatCountdown(299)).toBe('4:59');
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(5.2)).toBe('0:06');
    expect(formatCountdown(-3)).toBe('0:00');
    expect(formatCountdown(900)).toBe('15:00');
  });
});

describe('formatShortDate', () => {
  it('uses Portuguese month abbreviations', () => {
    expect(formatShortDate(new Date(2026, 10, 13))).toBe('13 NOV');
    expect(formatShortDate(new Date(2026, 1, 3))).toBe('3 FEV');
  });
});

describe('joinNumbers', () => {
  it('joins positions', () => {
    expect(joinNumbers([12])).toBe('12');
    expect(joinNumbers([4, 12])).toBe('4 e 12');
    expect(joinNumbers([4, 7, 12])).toBe('4, 7 e 12');
  });
});
