// Generates the PWA icons, the Apple touch icon and the favicon from one SVG,
// so no external tool or download is needed. Run with `pnpm assets`.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '../public');

const BG = '#0E0D0C';
const ACCENT = '#D8B77A';
const TEXT = '#F3EEE6';

// A champagne progress ring (the app's signature element) around a thin "N".
// `scale` shrinks the mark for maskable icons, whose safe zone is the inner 80%.
function iconSvg({ size, scale, rounded }) {
  const c = size / 2;
  const r = size * 0.34 * scale;
  const stroke = size * 0.035 * scale;
  const circumference = 2 * Math.PI * r;
  const arc = circumference * 0.72;
  const n = size * 0.15 * scale;
  const nStroke = size * 0.032 * scale;
  const radius = rounded ? size * 0.22 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#2C2925" stroke-width="${stroke}"/>
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${ACCENT}" stroke-width="${stroke}" stroke-linecap="round"
    stroke-dasharray="${arc} ${circumference}" transform="rotate(-90 ${c} ${c})"/>
  <path d="M${c - n * 0.7} ${c + n}V${c - n}L${c + n * 0.7} ${c + n}V${c - n}" fill="none" stroke="${TEXT}"
    stroke-width="${nStroke}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

await mkdir(resolve(publicDir, 'icons'), { recursive: true });

const targets = [
  { file: 'icons/icon-192.png', size: 192, scale: 1, rounded: false },
  { file: 'icons/icon-512.png', size: 512, scale: 1, rounded: false },
  { file: 'icons/maskable-192.png', size: 192, scale: 0.78, rounded: false },
  { file: 'icons/maskable-512.png', size: 512, scale: 0.78, rounded: false },
  { file: 'icons/apple-touch-icon.png', size: 180, scale: 0.9, rounded: false },
];
for (const t of targets) {
  await sharp(Buffer.from(iconSvg(t)))
    .png({ compressionLevel: 9 })
    .toFile(resolve(publicDir, t.file));
  console.log(`wrote ${t.file}`);
}
await writeFile(resolve(publicDir, 'favicon.svg'), iconSvg({ size: 64, scale: 1.05, rounded: true }));
console.log('wrote favicon.svg');
