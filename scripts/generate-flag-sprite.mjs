import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { optimize } from 'svgo';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const FLAGS = {
  ar: 'ar',
  br: 'br',
  co: 'co',
  de: 'de',
  es: 'es',
  fr: 'fr',
  jp: 'jp',
  ma: 'ma',
  mx: 'mx',
  pt: 'pt',
  uy: 'uy',
  'gb-eng': 'gb-eng',
};

const FLAGS_DIR = join(root, 'node_modules/flag-icons/flags/4x3');

function svgoConfig(code) {
  return {
    multipass: true,
    floatPrecision: 0,
    plugins: [
      {
        name: 'preset-default',
        params: {
          overrides: {
            cleanupIds: false,
            convertPathData: { floatPrecision: 0 },
            cleanupNumericValues: { floatPrecision: 0 },
            convertTransform: { floatPrecision: 0 },
          },
        },
      },
      { name: 'prefixIds', params: { prefix: `f${code}`, delim: '-' } },
      'removeDimensions',
    ],
  };
}

function parseSvg(svg) {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 640 480';
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return { viewBox, inner: inner.trim() };
}

let totalBefore = 0;
let totalAfter = 0;
const symbols = [];

for (const [code, file] of Object.entries(FLAGS)) {
  const raw = await readFile(join(FLAGS_DIR, `${file}.svg`), 'utf8');
  totalBefore += raw.length;

  const { data } = optimize(raw, svgoConfig(code));
  totalAfter += data.length;

  const { viewBox, inner } = parseSvg(data);
  symbols.push(`  <symbol id="flag-${code}" viewBox="${viewBox}">${inner}</symbol>`);
}

const out = `---
---

<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">
${symbols.join('\n')}
</svg>
`;

await writeFile(join(root, 'src/components/FlagSprite.astro'), out, 'utf8');

const kb = (n) => (n / 1024).toFixed(1);
console.log(`Sprite generado: ${symbols.length} banderas`);
console.log(`SVGO: ${kb(totalBefore)}KB -> ${kb(totalAfter)}KB`);
