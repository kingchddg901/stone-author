// THE TILED FLOOR, which nothing ran until now.
//
// harness/tiff.mjs renders the tiled SLAB and gates its joins, and it was green through the whole life
// of a defect that put every output tile's material under a single piece: paintContent writes its
// raster with putImageData, which by specification ignores the clipping region, so each piece
// overwrote the whole band and the LAST one painted in a tile won. The floor path was simply never
// reached from here - the hook did not expose it.
//
// It survived for a second reason worth stating, because it decides what this file has to do. Under
// GUIDE every piece samples the same continuous field at the same place, so whoever wins paints the
// same pixels and the floor comes out right by accident. A gate that laid an ordinary floor would have
// passed. Only a floor whose pieces carry material from ELSEWHERE can see it, which is why this renders
// SHUFFLE and why the positive control below is not optional.
//
// Found on his machine instead, at 8,192 x 5,120, by auditing masters by hand - which is not a thing
// anyone will do for every render. That is the gap this closes.
//
//   node harness/inject.mjs && node harness/floor.mjs
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const hooked = pathToFileURL(join(here, 'dist', 'stone-author.hooked.html')).href;

const W = 1024, H = 640, TS = 256;      // small tiles, so a 1024 strip crosses several joins

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(hooked);
await page.waitForFunction(() => !!window.__sa, null, { timeout: 15000 });

const res = await page.evaluate(async ({ W, TS }) => {
  const sa = window.__sa;
  const plan = await sa.tiffPlan(W);
  const bleed = plan.bleed;
  const grab = (c, x, y, w, h) => c.getContext('2d').getImageData(x, y, w, h).data;
  const diff = (p, q) => {
    let sum = 0, max = 0, off = 0, n = 0;
    for (let i = 0; i < p.length; i += 4) {
      let d = 0;
      for (let k = 0; k < 3; k++) { const v = Math.abs(p[i + k] - q[i + k]); if (v > d) d = v; }
      sum += d; if (d > max) max = d; if (d) off++; n++;
    }
    return { mean: sum / n, max, pct: 100 * off / n };
  };

  // A FLOOR OF PIECES THAT CAME FROM SOMEWHERE ELSE. kerf 0 against a grout, so the lattice carries a
  // real shift as well - the two are independent and a gate that fixed both would be testing neither.
  sa.layTiles = true;
  Object.assign(sa.T, { pattern: 'rhombus', sizeIn: 17, groutIn: 0.03125, kerfIn: 0, edge: 'square',
                        joints: true, assembly: 'guide', shuffle: true });
  sa.render();
  const pieces = sa.tileInstances().length;

  // (a) THE JOIN. The same strip painted as ONE output tile, and as FOUR. Each quarter must match the
  // part of the single tile it stands for. Before the fix the single tile wore one piece's material and
  // each of the four wore its own, so this is the measurement that goes red.
  const one = sa.renderFloorTile(W, 0, 0, TS * 4, TS, bleed);
  const whole = [0, 1, 2, 3].map(k => grab(one, bleed + k * TS, bleed, TS, TS));
  one.width = 1; one.height = 1;
  const joins = [];
  for (let k = 0; k < 4; k++) {
    const t = sa.renderFloorTile(W, k * TS, 0, TS, TS, bleed);
    joins.push(diff(whole[k], grab(t, bleed, bleed, TS, TS)));
    t.width = 1; t.height = 1;
  }

  // (b) RECOVERY. A tile rendered again on its own must be the same tile, or losing one would change
  // the picture rather than cost one tile.
  const r1 = sa.renderFloorTile(W, TS, 0, TS, TS, bleed);
  const r2 = sa.renderFloorTile(W, TS, 0, TS, TS, bleed);
  const again = diff(grab(r1, bleed, bleed, TS, TS), grab(r2, bleed, bleed, TS, TS));
  r1.width = 1; r1.height = 1; r2.width = 1; r2.height = 1;

  // (c) THE POSITIVE CONTROL, and it is the whole reason this file can be believed. If the pieces
  // happen to carry the SAME material - a flat slab, or an assembly that moved nothing - then every
  // join above is perfect for a reason that has nothing to do with the renderer being right, and this
  // gate passes on an empty question. So: the shuffled floor must differ from the guide floor over the
  // same region. That difference is also the only evidence here that `diff` can return anything but 0.
  const shuf = grab(sa.renderFloorTile(W, 0, 0, TS * 2, TS, bleed), bleed, bleed, TS * 2, TS);
  sa.T.shuffle = false;
  sa.render();
  const guide = grab(sa.renderFloorTile(W, 0, 0, TS * 2, TS, bleed), bleed, bleed, TS * 2, TS);
  const moved = diff(shuf, guide);

  return { bleed, pieces, joins, again, moved };
}, { W, TS });

await browser.close();

const fail = [];
const f4 = v => v.toFixed(4);

// The positive control FIRST: everything below it is meaningless if the pieces all carry the same
// material, and reporting a green join on an empty question is the failure this ordering prevents.
if (!(res.moved.mean > 0.5))
  fail.push(`the shuffled floor is the same picture as the guide floor (mean ${f4(res.moved.mean)}) — ` +
            `the pieces carry no material of their own, so every join below is perfect for a reason ` +
            `that is not the renderer. This gate cannot bite on this slab.`);

// Measured on build .67 at mean 0: a tile of a floor is a pure function of where it is. The bar sits
// well above that so a rounding difference never goes red. Before 35f0d2c the same floor measured
// 350x to 415x its own control columns on an 8,192 master, and here it is a whole piece of material
// in the wrong place — nothing subtle to resolve.
res.joins.forEach((d, k) => {
  if (!(d.mean <= 0.05)) fail.push(`tile ${k}: rendered alone it differs from the same region of one big tile by mean ${f4(d.mean)}, max ${d.max} — the output-tile grid is in the picture`);
  if (!(d.pct <= 1)) fail.push(`tile ${k}: ${d.pct.toFixed(2)}% of pixels differ from the single-tile render`);
});

if (!(res.again.mean === 0 && res.again.max === 0))
  fail.push(`a floor tile re-rendered is not identical (mean ${f4(res.again.mean)}, max ${res.again.max}) — recovery would change the picture`);

console.log(`floor: ${res.pieces} pieces, ${TS}px tiles, bleed ${res.bleed}`);
console.log(`  joins      ${res.joins.map((d, k) => `t${k} ${f4(d.mean)}`).join('  ')}`);
console.log(`  re-render  mean ${f4(res.again.mean)}, max ${res.again.max}`);
console.log(`  shuffle vs guide  mean ${f4(res.moved.mean)}, ${res.moved.pct.toFixed(1)}% of pixels — the control that proves this gate has a question to answer`);

if (fail.length) { for (const m of fail) console.error(`  ${m}`); process.exit(1); }
console.log('floor: every output tile is the same material the whole picture would have put there');
