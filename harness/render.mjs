// Render every gallery hero headlessly from its slab + recipe in gallery/reference.json.
//
// Two checks, by design:
//   1. SELF-DETERMINISM (hard gate): each hero is rendered twice, from a fresh deserialize each time; the two
//      raw-pixel hashes MUST be identical. This proves the render is a pure function of the slab in THIS
//      environment — the property the whole "slab is the master" claim rests on. It also exercises the
//      deserialize hard-reset fix.
//   2. REFERENCE MATCH (reported): the hash is compared to the committed pixelSHA256. Those were generated in a
//      different browser build, and canvas anti-aliasing is not guaranteed identical across Chromium builds, so a
//      cross-build DIFF here is expected-and-informative, not a bug. Pass --strict to make a reference DIFF fail
//      the run (use once the reference has been blessed from THIS environment).
//
//   node harness/inject.mjs && node harness/render.mjs            # self-determinism gate + reference report
//   node harness/inject.mjs && node harness/render.mjs --write     # + regenerate gallery/img/*.png
//   node harness/inject.mjs && node harness/render.mjs --strict    # reference DIFF also fails
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const WRITE = process.argv.includes('--write');
const STRICT = process.argv.includes('--strict');
const ref = JSON.parse(readFileSync(join(root, 'gallery', 'reference.json'), 'utf8'));
const hooked = pathToFileURL(join(here, 'dist', 'stone-author.hooked.html')).href;

// One hero → { hash, png }. Deserializes fresh every call, so calling it twice tests self-determinism.
async function renderHero(page, hero) {
  const slab = JSON.parse(readFileSync(join(root, 'gallery', hero.slab), 'utf8'));
  return page.evaluate(async ({ slab, h, ref }) => {
    const sa = window.__sa, W = ref.width, s = W / 1000;
    sa.deserialize(slab);
    sa.G.warpMask = [];
    if (h.moonStrength != null) { const m = sa.marks.find(x => x.kind === 'moon'); if (m) m.p.moonStrength = h.moonStrength; }
    if (h.mask) sa.marks.push({ id: 990000, kind: 'mask', at: h.mask.at, r: h.mask.r, p: { maskFeather: h.mask.feather, maskWin: h.mask.window ? 1 : 0 }, fam: 'granite' });
    if (h.palette === 'psyker') { const p = ref.psykerPalette.OVR_uv; for (const k in p) sa.OVR_uv[k] = [{ v: -1, c: p[k] }]; delete sa.OVR_uv['lay:minor']; }
    sa.setSpectrum(h.spectrum || 0);
    sa.render();
    const oc = sa.renderFull(W);
    if (h.burn) {
      const cx = oc.getContext('2d'); cx.setTransform(1, 0, 0, 1, 0, 0);
      const b = ref.burn, bx = b.center[0] * W, by = b.center[1] * W;
      cx.globalCompositeOperation = 'multiply';
      let g = cx.createRadialGradient(bx, by, 0, bx, by, b.multiply.r * s); for (const [o, c] of b.multiply.stops) g.addColorStop(o, c); cx.fillStyle = g; cx.fillRect(0, 0, oc.width, oc.height);
      cx.globalCompositeOperation = 'lighter';
      let hg = cx.createRadialGradient(bx, by, b.lighter.r0 * s, bx, by, b.lighter.r1 * s); for (const [o, c] of b.lighter.stops) hg.addColorStop(o, c); cx.fillStyle = hg; cx.fillRect(0, 0, oc.width, oc.height);
      cx.globalCompositeOperation = 'source-over';
    }
    const d = oc.getContext('2d').getImageData(0, 0, oc.width, oc.height).data;
    const buf = await crypto.subtle.digest('SHA-256', d);
    return { hash: [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join(''), png: oc.toDataURL('image/png') };
  }, { slab, h: hero, ref });
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(hooked);
await page.waitForFunction(() => !!window.__sa, null, { timeout: 15000 });

let selfFail = 0, refDiff = 0;
console.log('hero       self   ref    hash');
for (const hero of ref.heroes) {
  const a = await renderHero(page, hero);
  const b = await renderHero(page, hero);
  const self = a.hash === b.hash;
  const refOk = a.hash === hero.pixelSHA256;
  if (!self) selfFail++;
  if (!refOk) refDiff++;
  console.log(`${hero.name.padEnd(9)}  ${self ? 'PASS' : 'FAIL'}   ${refOk ? 'match' : 'DIFF '}  ${a.hash}`);
  if (!refOk) console.log(`           reference ${hero.pixelSHA256}`);
  if (WRITE) writeFileSync(join(root, 'gallery', hero.image), Buffer.from(a.png.split(',')[1], 'base64'));
}
await browser.close();

console.log('');
console.log(selfFail ? `SELF-DETERMINISM FAILED for ${selfFail} hero(es) — the render is not a pure function of the slab here.`
                     : `Self-determinism: PASS — every hero renders byte-identical twice from a fresh load.`);
console.log(refDiff ? `Reference: ${refDiff}/${ref.heroes.length} differ from the committed hashes (cross-build canvas AA; re-bless from this env if this is canonical).`
                    : `Reference: all ${ref.heroes.length} match the committed hashes — byte-identical across environments.`);

const fail = selfFail > 0 || (STRICT && refDiff > 0);
process.exit(fail ? 1 : 0);
