// DOES THE WINDOWED FLOOR PAINT THE SAME PICTURE? A cross-build pixel differential.
//
//   node tools/make-probe-builds.mjs --only=ab && node harness/floor-window.mjs [--w=8192]
//
// renderFloorTile used to paint the WHOLE tile canvas once per piece and let the clip discard all but
// that piece's polygon. It now paints only the piece's own box, padded by the tile's bleed. The
// transform is untouched - same scale, same origin, same shift - so slab coordinates are kept, which
// is the condition under which the repo measured a windowed paint PIXEL-IDENTICAL to cropping one out
// of a full render. This is the gate on that claim, run against the build before the change.
//
// IT COMPARES HASHES FIRST AND PIXELS ONLY ON A MISMATCH. Identity is a hash question; magnitude only
// matters once something differs, and pulling 16 MB of tile out of a page for every cell to be told
// "0" is 20 round trips for no information.
//
// IT CARRIES ITS OWN POSITIVE CONTROL, because a differential that cannot find anything has not been
// shown able to find anything. The control re-hashes one tile with `shuffle` flipped - pieces then
// come from elsewhere in the slab - and that hash MUST move. If it does not, the comparison is
// measuring nothing and every zero above it is worthless.
//
// THE MATRIX IS THE PATTERNS, because the change is geometric. An irregular pentagon, a hexagon and a
// rhombus bound differently from a rectangle, and `cairo` is in there for exactly that reason.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { launchChromium } from './browser.mjs';
import { compare } from './compare.mjs';
import { encodePNG } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const argOf = (n, d) => Number((args.find(a => a.startsWith('--' + n + '=')) || ('=' + d)).split('=')[1]);
const W = argOf('w', 8192);
const DUMP = args.includes('--dump');
const ONLY = (args.find(a => a.startsWith('--pattern=')) || '=').split('=')[1];
// THE DRAWN GLOW, ON OR OFF. coatRadius states, measured 2026-10-19, that bleed is margin for a
// BLUR and the drawn glow gets NONE: a shape OUTSIDE the canvas still casts its shadow into it, so
// the same region differs between a 2048 and a 4096 tile (1.699% of pixels at bleed 4), and the
// correct bleed - blurReach(glowPx), 786 px at 16,384 - is unallocatable at scale, so the project
// took the trade. A windowed piece is a far smaller canvas, so it meets that same trade harder.
// ?bloom=blur moves the halo into applyCoat, which runs once on the WHOLE tile afterwards, and is
// therefore the control that says whether the drawn glow is what this differential is seeing.
const BLOOM = (args.find(a => a.startsWith('--bloom=')) || '=').split('=')[1];
const SLAB = JSON.parse(readFileSync(join(root, 'gallery', 'slabs', 'Hero_Psyker.json'), 'utf8'));

const CELLS = [];
for (const pattern of ['rhombus', 'hex', 'cairo', 'herringbone', 'subway'])
  for (const shuffle of [false, true])
    if (!ONLY || ONLY === pattern)
      CELLS.push({ pattern, shuffle, name: pattern + (shuffle ? ' shuffled' : ' in order') });

const unb64 = s => Buffer.from(s, 'base64');

// One page, one build, one cell. Returns the interior tile's hash, and its pixels on request.
async function cell(page, c, wantPixels) {
  return page.evaluate(async ({ SLAB, W, c, wantPixels }) => {
    const sa = window.__sa;
    sa.deserialize(SLAB);
    const plan = await sa.tiffPlan(W);
    const ts = plan.ts, bleed = plan.bleed;
    sa.layTiles = true;
    Object.assign(sa.T, { pattern: c.pattern, sizeIn: 17, groutIn: 0.03125, kerfIn: 0,
                          edge: 'square', joints: true, assembly: 'guide', shuffle: c.shuffle });
    sa.render();
    const gx = Math.floor(plan.rAcross / 2), gy = Math.floor(plan.rDown / 2);
    const cv = sa.renderFloorTile(W, gx * ts, gy * ts, ts, ts, bleed);
    // THE INTERIOR ONLY. The export crops the bleed off, so a difference inside it is not in the
    // file - and a difference the COAT pulls out of the bleed lands in the interior and is caught here.
    const d = cv.getContext('2d').getImageData(bleed, bleed, ts, ts).data;
    cv.width = 1; cv.height = 1;
    const buf = await crypto.subtle.digest('SHA-256', d);
    let px = null;
    if (wantPixels) {                                      // chunked: fromCharCode(...d) blows the stack
      let s = ''; const CH = 0x8000;
      for (let i = 0; i < d.length; i += CH) s += String.fromCharCode.apply(null, d.subarray(i, i + CH));
      px = btoa(s);
    }
    return { hash: [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join(''),
             ts, bleed, px, rAcross: plan.rAcross, rDown: plan.rDown };
  }, { SLAB, W, c, wantPixels });
}

const browser = await launchChromium();
const FILES = { before: 'stone-author.before.html', after: 'stone-author.hooked.html' };

// A FRESH PAGE PER CELL, AND THIS IS NOT TIDINESS. The first version of this file opened one page
// per build and ran every cell through it, so each cell inherited whatever the one before had left
// in the module's state. Measured on the same comparison: a reused page read mean 0.95 over 12.4% of
// pixels, a fresh one read 2.05 over 48.7%. The contaminated number was the FLATTERING one, which is
// how it survived being read - a differential that under-reports looks like good news.
async function freshCell(which, c, wantPixels) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error(which + ' page error:', e.message));
  await page.goto(pathToFileURL(join(here, 'dist', FILES[which])).href + (BLOOM ? '?bloom=' + BLOOM : ''));
  await page.waitForFunction(() => !!window.__sa, null, { timeout: 30000 });
  try { return await cell(page, c, wantPixels); } finally { await page.close(); }
}

console.log('\nfloor-window: Hero_Psyker at ' + W + 'px, the middle tile, interior only'
          + (BLOOM ? ', ?bloom=' + BLOOM : ', drawn bloom as shipped') + '\n');
const bad = [];
let geom = null;
for (const c of CELLS) {
  const b = await freshCell('before', c, false);
  const a = await freshCell('after', c, false);
  geom = geom || b;
  const same = b.hash === a.hash;
  console.log('  ' + c.name.padEnd(22) + (same ? 'IDENTICAL' : 'DIFFERS') + '   ' + b.hash.slice(0, 16));
  if (!same) bad.push(c);
}

// Magnitude AND WHERE, only for what differed. The 8x8 map is the point: differences clustered at
// piece boundaries mean primitives clipped out of the box, differences spread evenly over the tile
// mean the paint depends on where in the device it lands and no amount of padding will fix it.
for (const c of bad) {
  const b = await freshCell('before', c, true);
  const a = await freshCell('after', c, true);
  const r = compare(unb64(b.px), unb64(a.px), b.ts, b.ts);
  console.log('\n  ' + c.name + ': mean ' + r.mean + '  max ' + r.max
            + '  over 1 level ' + r.pctOver1 + '%  sd ' + r.sd);
  for (const row of r.map) console.log('      ' + row);
  if (DUMP) {
    const out = join(here, 'dist', 'floor-window-' + c.pattern + (c.shuffle ? '-shuf' : '') + '.png');
    writeFileSync(out, encodePNG(b.ts, b.ts, r.vis));
    console.log('      difference image (amplified 8x) -> ' + out);
  }
}

// THE CONTROL. Same build, same tile, shuffle flipped: the hash has to move, or nothing above means
// anything. Run on the AFTER build, which is the one the zeros are being claimed for.
const g1 = await freshCell('after', { pattern: 'rhombus', shuffle: false }, false);
const g2 = await freshCell('after', { pattern: 'rhombus', shuffle: true }, false);
const moved = g1.hash !== g2.hash;
console.log('\n  control: rhombus in order vs shuffled, same build  ->  '
          + (moved ? 'hashes MOVE, the comparison can see a difference'
                   : 'hashes IDENTICAL - THE COMPARISON IS MEASURING NOTHING'));

await browser.close();
console.log('\ngrid was ' + geom.rAcross + 'x' + geom.rDown + ', tile ' + geom.ts + ' + ' + geom.bleed + ' bleed');
if (!moved) { console.log('\nVERDICT INCONCLUSIVE - the control did not fire'); process.exit(2); }
if (bad.length) { console.log('\nVERDICT DIFFERS in ' + bad.length + ' of ' + CELLS.length + ' cells'); process.exit(1); }
console.log('\nVERDICT IDENTICAL in all ' + CELLS.length + ' cells, and the control fired');
