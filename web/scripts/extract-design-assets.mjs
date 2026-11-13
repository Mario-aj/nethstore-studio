// Extracts the store photos embedded in the design exports (docs/design/*.html)
// and writes optimized WebP variants to src/assets/photos plus the Open Graph
// image to public/og-image.jpg. Run with `pnpm assets`. The outputs are committed,
// so this only needs to run again if the design exports change.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const designDir = resolve(webRoot, '../docs/design');
const outDir = resolve(webRoot, 'src/assets/photos');

// Content hash (first 8 hex chars of SHA-1 of the original JPEG) -> asset name.
const NAMES = {
  '03496ec6': 'polka-dress',
  '19ef01bc': 'blue-set',
  '25729dce': 'beige-dress',
  '4aed2450': 'magenta-blouse',
  ce0762ac: 'orange-set',
};
const WIDTHS = [480, 800, 1200];

function decode(entry) {
  const raw = Buffer.from(entry.data, 'base64');
  const compressed =
    String(entry.compressed).toLowerCase() === 'true' || (raw[0] === 0x1f && raw[1] === 0x8b);
  return compressed ? gunzipSync(raw) : raw;
}

function manifestOf(html) {
  const match = html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('bundle manifest not found');
  return JSON.parse(match[1]);
}

async function collectPhotos() {
  const photos = new Map();
  for (const file of ['landing-page.html', 'NethStore Estúdio.html', 'component-tokens.html']) {
    const outer = manifestOf(await readFile(resolve(designDir, file), 'utf8'));
    for (const page of Object.values(outer)) {
      if (page.mime !== 'text/html') continue;
      const inner = manifestOf(decode(page).toString('utf8'));
      for (const asset of Object.values(inner)) {
        if (asset.mime !== 'image/jpeg') continue;
        const jpeg = decode(asset);
        const hash = createHash('sha1').update(jpeg).digest('hex').slice(0, 8);
        if (NAMES[hash]) photos.set(NAMES[hash], jpeg);
      }
    }
  }
  return photos;
}

const photos = await collectPhotos();
const missing = Object.values(NAMES).filter((name) => !photos.has(name));
if (missing.length > 0) throw new Error(`photos not found in design exports: ${missing.join(', ')}`);

await mkdir(outDir, { recursive: true });
for (const [name, jpeg] of photos) {
  for (const width of WIDTHS) {
    const out = resolve(outDir, `${name}-${width}.webp`);
    await sharp(jpeg)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 76, effort: 6 })
      .toFile(out);
  }
  console.log(`wrote ${name} (${WIDTHS.join(', ')})`);
}

// Open Graph image: 1200x630, the hero dress on the dark brand background.
const hero = await sharp(photos.get('polka-dress')).rotate().resize({ height: 630 }).toBuffer();
const heroMeta = await sharp(hero).metadata();
await writeFile(
  resolve(webRoot, 'public/og-image.jpg'),
  await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#0E0D0C' } })
    .composite([
      { input: hero, left: 1200 - (heroMeta.width ?? 473), top: 0 },
      {
        input: Buffer.from(
          `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
            <text x="72" y="120" font-family="Work Sans, Arial, sans-serif" font-size="22" font-weight="500" letter-spacing="5" fill="#F3EEE6">NETHSTORE · ESTÚDIO</text>
            <text x="72" y="300" font-family="Work Sans, Arial, sans-serif" font-size="76" font-weight="300" fill="#F3EEE6">Do fardo à</text>
            <text x="72" y="390" font-family="Work Sans, Arial, sans-serif" font-size="76" font-weight="300" font-style="italic" fill="#D8B77A">montra</text>
            <text x="72" y="480" font-family="Work Sans, Arial, sans-serif" font-size="76" font-weight="300" fill="#F3EEE6">em minutos.</text>
          </svg>`,
        ),
        left: 0,
        top: 0,
      },
    ])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer(),
);
console.log('wrote public/og-image.jpg');
