import { describe, expect, it } from 'vitest';
import { addPhotos, batchFormView, MAX_PHOTOS } from './createBatchForm';

const file = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

describe('addPhotos', () => {
  it('appends files with preview URLs', () => {
    const { photos, leftOut } = addPhotos([], [file('a'), file('b')], (f) => `blob:${f.name}`);
    expect(photos.map((p) => p.url)).toEqual(['blob:a', 'blob:b']);
    expect(leftOut).toBe(0);
  });

  it('stops at 50 photos and reports the rest', () => {
    const first = addPhotos(
      [],
      Array.from({ length: 48 }, (_, i) => file(String(i))),
      () => 'u',
    );
    const second = addPhotos(first.photos, [file('x'), file('y'), file('z'), file('w')], () => 'u');
    expect(second.photos).toHaveLength(MAX_PHOTOS);
    expect(second.leftOut).toBe(2);
  });
});

describe('batchFormView', () => {
  const ready = { photos: 12, price: 10000, sizes: ['M', 'L'] as const, description: 'Veste' };

  it('can process with photos, price and sizes', () => {
    const view = batchFormView({ ...ready, sizes: [...ready.sizes] });
    expect(view.canProcess).toBe(true);
    expect(view.stamp).toEqual({
      empty: false,
      descriptionPrefix: 'Veste/ ',
      sizes: 'M e L',
      price: '10.000 kz',
    });
    expect(view.request()).toEqual({
      priceKz: 10000,
      sizes: ['M', 'L'],
      description: 'Veste',
      photoCount: 12,
    });
  });

  it('empty: nothing to stamp yet', () => {
    const view = batchFormView({ photos: 0, price: null, sizes: [], description: '' });
    expect(view.canProcess).toBe(false);
    expect(view.priceMissing).toBe(false);
    expect(view.stamp.empty).toBe(true);
    expect(view.sizesText).toBe('Escolher');
  });

  it('price missing: flagged once there are photos', () => {
    const view = batchFormView({ ...ready, sizes: [...ready.sizes], price: null });
    expect(view.canProcess).toBe(false);
    expect(view.priceMissing).toBe(true);
    expect(view.stamp.price).toBeNull();
  });

  it('sizes are required', () => {
    const view = batchFormView({ ...ready, sizes: [] });
    expect(view.canProcess).toBe(false);
    expect(view.stamp.sizes).toBeNull();
  });

  it('description is optional and normalized', () => {
    expect(batchFormView({ ...ready, sizes: ['M'], description: '   ' }).request().description).toBeNull();
    expect(
      batchFormView({ ...ready, sizes: ['M'], description: ' Saia   longa ' }).request().description,
    ).toBe('Saia longa');
  });

  it('blocks a description with forbidden characters', () => {
    const view = batchFormView({ ...ready, sizes: ['M'], description: 'Veste/Saia' });
    expect(view.canProcess).toBe(false);
    expect(view.descriptionError).toBe("Usa só letras, números e . , ' ( ) & +");
  });
});
