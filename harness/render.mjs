// Render every gallery hero headlessly from its slab + recipe in gallery/reference.json, twice each from a fresh
// deserialize, and assert the two raw-pixel hashes are identical. This is the SELF-DETERMINISM gate: it proves
// the render is a pure function of the slab in this environment — the property the whole "slab is the master"
// claim rests on, and it exercises the deserialize hard-reset. (Byte-identity across different Chromium builds is
// deliberately not checked: sub-pixel anti-aliasing varies between builds, which is below what a shared image is
// for — the picture is identical either way.)
//
//   node harness/inject.mjs && node harness/render.mjs            # self-determinism gate
//   node harness/inject.mjs && node harness/render.mjs --write     # + regenerate gallery/img/*.png
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { renderHero } from './hero.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const WRITE = process.argv.includes('--write');
const ref = JSON.parse(readFileSync(join(root, 'gallery', 'reference.json'), 'utf8'));
const hooked = pathToFileURL(join(here, 'dist', 'stone-author.hooked.html')).href;

// The hero setup lives in harness/hero.mjs — shared with the engine gate, so neither can drift from it.
const hero1 = (page, hero) => renderHero(page, { root, hero, ref });

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(hooked);
await page.waitForFunction(() => !!window.__sa, null, { timeout: 15000 });

let selfFail = 0;
console.log('hero       self   hash');
for (const hero of ref.heroes) {
  const a = await hero1(page, hero);
  const b = await hero1(page, hero);
  const self = a.hash === b.hash;
  if (!self) selfFail++;
  console.log(`${hero.name.padEnd(9)}  ${self ? 'PASS' : 'FAIL'}   ${a.hash}`);
  if (WRITE) writeFileSync(join(root, 'gallery', hero.image), Buffer.from(a.png.split(',')[1], 'base64'));
}
await browser.close();

console.log('');
console.log(selfFail ? `Self-determinism FAILED for ${selfFail} hero(es) — the render is not a pure function of the slab here.`
                     : `Self-determinism: PASS — every hero renders byte-identical twice from a fresh load.`);
process.exit(selfFail ? 1 : 0);
