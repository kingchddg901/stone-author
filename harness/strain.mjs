// Strain glow: a warped stretch takes on its own emission colour, and the three settings that govern it
// resolve artifact → layer → bucket like every other adjustment.
//
// The effect is the easy half to check. The half worth gating is the LADDER — that a layer beats a bucket
// and an artifact beats a layer — because that is what makes the feature usable and it is invisible in any
// screenshot. And the default: strain is 0 everywhere, so a slab that never asks for it must render exactly
// as it did before this existed.
//
//   node harness/inject.mjs && node harness/strain.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const hooked = pathToFileURL(join(here, 'dist', 'stone-author.hooked.html')).href;
const slab = JSON.parse(readFileSync(join(root, 'gallery', 'slabs', 'before.json'), 'utf8'));

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(hooked);
await page.waitForFunction(() => !!window.__sa, null, { timeout: 15000 });

const res = await page.evaluate(async ({ slab }) => {
  const sa = window.__sa;
  const CYAN = '#35c8ff', MAGENTA = '#ff36c0';
  // One render, described by what it contains: strongly blue pixels, strongly warm ones, and a hash.
  const shot = (setup) => {
    sa.deserialize(slab); sa.setSpectrum(0);
    sa.G.warp = 1.2;                                  // the global current, so every vein carries some strain
    sa.OVR_uv['lay:major'] = [{ v: -1, c: CYAN }, { v: -2, c: MAGENTA }];
    setup(sa);
    sa.render();
    const c = sa.renderFull(768);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    c.width = 1; c.height = 1;
    let cyan = 0, magenta = 0, warm = 0, h = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (b > 120 && b > r + 40) cyan++;
      else if (r > 140 && b > 100 && r > g + 40) magenta++;
      else if (r > 110 && r > b + 40) warm++;
      h = (h * 31 + r + g * 3 + b * 7) >>> 0;
    }
    return { cyan, magenta, warm, h };
  };
  return {
    off:      shot(() => {}),                                                        // the default: nothing asked for
    bucket:   shot(s => { s.OVR['major:strain'] = 1; }),                             // set on the bucket
    layerOff: shot(s => { s.OVR['major:strain'] = 1; s.OVR['lay:major:strain'] = 0; }),   // layer refuses
    spxTwo:   shot(s => { s.OVR['major:strain'] = 1; s.OVR['major:strainSpx'] = -2; }),   // reveal the other stop
    spxMid:   shot(s => { s.OVR['major:strain'] = 1; s.OVR['major:strainSpx'] = -1.5; }), // between the stops
  };
}, { slab });
await browser.close();

const fail = [];
const { off, bucket, layerOff, spxTwo, spxMid } = res;
if (off.cyan !== 0) fail.push(`strain defaults to 0, so an untouched slab must show no emission: got ${off.cyan} lit pixels`);
if (!(bucket.cyan > 500)) fail.push(`strain 1 on the bucket must light the warped stretches: got ${bucket.cyan}`);
if (!(bucket.warm < off.warm)) fail.push('lighting stretches must take them out of the daylight colour');
if (layerOff.h !== off.h) fail.push('a LAYER set to 0 must beat the bucket exactly, pixel for pixel');
if (!(spxTwo.magenta > 500)) fail.push(`strainSpx -2 must reveal the other stop: got ${spxTwo.magenta} magenta pixels`);
if (spxMid.h === bucket.h || spxMid.h === spxTwo.h) fail.push('a spectrum between two stops must differ from both');

for (const f of fail) console.error('  ' + f);
console.log(fail.length ? `Strain: ${fail.length} failure(s).`
  : `Strain: PASS — default silent (${off.cyan} lit), bucket lights ${bucket.cyan}, layer override beats it exactly, `
    + `spectrum -2 gives ${spxTwo.magenta} magenta, and -1.5 differs from both stops.`);
process.exit(fail.length ? 1 : 0);
