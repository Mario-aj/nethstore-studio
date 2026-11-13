import beige480 from '../../assets/photos/beige-dress-480.webp';
import beige800 from '../../assets/photos/beige-dress-800.webp';
import beige1200 from '../../assets/photos/beige-dress-1200.webp';
import blue480 from '../../assets/photos/blue-set-480.webp';
import blue800 from '../../assets/photos/blue-set-800.webp';
import blue1200 from '../../assets/photos/blue-set-1200.webp';
import magenta480 from '../../assets/photos/magenta-blouse-480.webp';
import magenta800 from '../../assets/photos/magenta-blouse-800.webp';
import magenta1200 from '../../assets/photos/magenta-blouse-1200.webp';
import orange480 from '../../assets/photos/orange-set-480.webp';
import orange800 from '../../assets/photos/orange-set-800.webp';
import orange1200 from '../../assets/photos/orange-set-1200.webp';
import polka480 from '../../assets/photos/polka-dress-480.webp';
import polka800 from '../../assets/photos/polka-dress-800.webp';
import polka1200 from '../../assets/photos/polka-dress-1200.webp';

export interface Photo {
  src: string;
  srcSet: string;
  alt: string;
}

const set = (a: string, b: string, c: string) => `${a} 480w, ${b} 800w, ${c} 1200w`;

export const photos = {
  polka: {
    src: polka800,
    srcSet: set(polka480, polka800, polka1200),
    alt: 'Vestido preto de bolinhas na manequim',
  },
  orange: {
    src: orange800,
    srcSet: set(orange480, orange800, orange1200),
    alt: 'Conjunto laranja na manequim',
  },
  blue: { src: blue800, srcSet: set(blue480, blue800, blue1200), alt: 'Conjunto branco com estampa azul' },
  beige: {
    src: beige800,
    srcSet: set(beige480, beige800, beige1200),
    alt: 'Vestido bege drapeado na manequim',
  },
  magenta: {
    src: magenta800,
    srcSet: set(magenta480, magenta800, magenta1200),
    alt: 'Blusa magenta acetinada',
  },
} satisfies Record<string, Photo>;

/** "Como funciona" strip. The design's lilac blouse is not in the export, so the orange set repeats. */
export const stripPhotos: Photo[] = [
  photos.orange,
  photos.beige,
  photos.blue,
  photos.polka,
  photos.magenta,
  { ...photos.orange, alt: 'Conjunto laranja, outra peça do lote' },
];
