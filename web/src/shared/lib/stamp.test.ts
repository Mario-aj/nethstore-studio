import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalSizes,
  descriptionProblem,
  formatKz,
  joinSizes,
  normalizeDescription,
  stampLines,
} from './stamp';

interface Vector {
  priceKz: number;
  sizes: string[];
  description: string | null;
  line1: string;
  line2: string;
}

// Shared with the Go implementation (api/internal/stamp/text.go), SPEC appendix A.
// Tests run from web/, so the repository root is one level up.
const vectors = JSON.parse(
  readFileSync(resolve(process.cwd(), '../testdata/stamp-text.json'), 'utf8'),
) as Vector[];

describe('stampLines', () => {
  it.each(vectors)('$priceKz $sizes $description -> "$line1" / "$line2"', (vector) => {
    expect(stampLines(vector)).toEqual({ line1: vector.line1, line2: vector.line2 });
  });

  it('loads every shared vector', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(6);
  });
});

describe('sizes', () => {
  it('sorts in canonical order and drops duplicates', () => {
    expect(canonicalSizes(['2XL', 'M', 'XS', 'M', 'nope'])).toEqual(['XS', 'M', '2XL']);
  });

  it('joins with commas and "e"', () => {
    expect(joinSizes([])).toBe('');
    expect(joinSizes(['M'])).toBe('M');
    expect(joinSizes(['L', 'M'])).toBe('M e L');
    expect(joinSizes(['L', 'S', 'M'])).toBe('S, M e L');
  });
});

describe('description', () => {
  it('normalizes NFC, trims and collapses spaces', () => {
    expect(normalizeDescription('  Saia   longa ')).toBe('Saia longa');
    expect(normalizeDescription('Camiséta')).toBe('Camiséta');
    expect(normalizeDescription('   ')).toBeNull();
    expect(normalizeDescription(null)).toBeNull();
  });

  it("accepts letters, numbers, spaces and . , ' ( ) & +", () => {
    expect(descriptionProblem("Saia (2) & top+'P',3.5")).toBeNull();
    expect(descriptionProblem('Vestido Ção')).toBeNull();
  });

  it('rejects the slash, control and other characters', () => {
    expect(descriptionProblem('Veste/Saia')).toBe('invalid_chars');
    expect(descriptionProblem('Veste\u0007')).toBe('invalid_chars');
    expect(descriptionProblem('Veste!')).toBe('invalid_chars');
  });

  it('limits to 24 characters after normalizing', () => {
    expect(descriptionProblem('a'.repeat(24))).toBeNull();
    expect(descriptionProblem(`  ${'a'.repeat(24)}  `)).toBeNull();
    expect(descriptionProblem('a'.repeat(25))).toBe('too_long');
  });
});

describe('formatKz', () => {
  it('uses dots as thousands separators and lowercase kz', () => {
    expect(formatKz(999)).toBe('999 kz');
    expect(formatKz(10000)).toBe('10.000 kz');
    expect(formatKz(1250000)).toBe('1.250.000 kz');
    expect(formatKz(9999999)).toBe('9.999.999 kz');
  });
});
