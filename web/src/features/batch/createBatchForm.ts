// Pure logic of the "Fotos e preço" form: photo list limits, validation and the
// stamp preview in the sticky footer.

import { t } from '../../shared/i18n/pt-AO';
import {
  formatKz,
  joinSizes,
  normalizeDescription,
  descriptionProblem,
  canonicalSizes,
  type Size,
} from '../../shared/lib/stamp';

export const MAX_PHOTOS = 50;

export interface LocalPhoto {
  key: string;
  file: File;
  url: string;
}

let counter = 0;

/** Appends files up to 50 photos; reports how many were left out. */
export function addPhotos(
  current: readonly LocalPhoto[],
  files: readonly File[],
  toUrl: (file: File) => string,
): { photos: LocalPhoto[]; leftOut: number } {
  const room = Math.max(0, MAX_PHOTOS - current.length);
  const accepted = files.slice(0, room);
  return {
    photos: [...current, ...accepted.map((file) => ({ key: `p${++counter}`, file, url: toUrl(file) }))],
    leftOut: files.length - accepted.length,
  };
}

interface FormInput {
  photos: number;
  price: number | null;
  sizes: readonly Size[];
  description: string;
}

export interface FormView {
  canProcess: boolean;
  priceMissing: boolean;
  sizesText: string;
  descriptionLength: number;
  descriptionError: string | null;
  stamp: {
    empty: boolean;
    /** "Veste/ " when there is a description, else "". */
    descriptionPrefix: string;
    sizes: string | null;
    price: string | null;
  };
  request(): { priceKz: number; sizes: Size[]; description: string | null; photoCount: number };
}

export function batchFormView({ photos, price, sizes, description }: FormInput): FormView {
  const problem = descriptionProblem(description);
  const normalized = normalizeDescription(description);
  const hasPhotos = photos > 0;
  return {
    canProcess: hasPhotos && price !== null && price > 0 && sizes.length > 0 && problem === null,
    priceMissing: hasPhotos && price === null,
    sizesText: sizes.length > 0 ? joinSizes(sizes) : t.create.sizesChoose,
    descriptionLength: [...description].length,
    descriptionError:
      problem === 'too_long'
        ? t.create.descriptionTooLong
        : problem === 'invalid_chars'
          ? t.create.descriptionInvalid
          : null,
    stamp: {
      empty: !hasPhotos,
      descriptionPrefix: normalized && problem === null ? `${normalized}/ ` : '',
      sizes: sizes.length > 0 ? joinSizes(sizes) : null,
      price: price !== null ? formatKz(price) : null,
    },
    request: () => ({
      priceKz: price ?? 0,
      sizes: canonicalSizes(sizes),
      description: normalized,
      photoCount: photos,
    }),
  };
}
