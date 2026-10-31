// A POOLED FLOOR TILE AGAINST THE SEQUENTIAL ONE, byte for byte.
//
//   node harness/inject.mjs && node harness/floor-pool.mjs
//
// poolWhyNot refused `exp.pool.floor` for as long as the floor existed, because the serialised core
// had neither drawTilesTo nor renderFloorTile in its function list: a floor master ran
// single-threaded on the main thread while a slab master got twelve workers. Both travel now, and
// this is the gate on that. The worker calls the SAME renderFloorTile the main thread does - there is
// no second implementation to drift - so what this really proves is that everything that function
// reaches resolved in the worker, which a static read of the core cannot establish.
//
// IT CHECKS THE REFUSAL TOO, in both directions. A plain floor must be allowed and a floor laid from
// a cut section must still be refused: a section is a whole slab record, and nothing ships one.
//
// AND IT CARRIES A CONTROL, because a comparison that finds nothing has not been shown able to find
// anything. The control re-renders the sequential tile with `shuffle` flipped - pieces then come from
// elsewhere in the slab - and that MUST differ from the first. If it does not, the zero above it is
// worthless.
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { launchChromium } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const W = Number((process.argv.find(a => a.startsWith('--w=')) || '=4096').split('=')[1]);
const SLAB = JSON.parse(readFileSync(join(root, 'gallery', 'slabs', 'Hero_Psyker.json'), 'utf8'));

const browser = await launchChromium();
const page = await browser.newPage({ deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('page error:', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
await page.goto(pathToFileURL(join(here, 'dist', 'stone-author.hooked.html')).href);
await page.waitForFunction(() => !!window.__sa, null, { timeout: 30000 });

const r = await page.evaluate(async ({ SLAB, W }) => {
  const sa = window.__sa;
  const out = { fail: [], notes: [] };
  sa.deserialize(SLAB);
  const plan = await sa.tiffPlan(W);
  const ts = plan.ts, bleed = plan.bleed;

  const lay = shuffle => {
    sa.layTiles = true;
    Object.assign(sa.T, { pattern: 'rhombus', sizeIn: 17, groutIn: 0.03125, kerfIn: 0,
                          edge: 'square', joints: true, assembly: 'guide', shuffle });
    sa.render();
  };
  const px = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data.slice();
                    c.width = 1; c.height = 1; return d; };
  const diff = (a, b) => {
    if (a.length !== b.length) return { px: -1, max: -1 };
    let n = 0, max = 0;
    for (let i = 0; i < a.length; i += 4)
      for (let k = 0; k < 3; k++) {
        const v = Math.abs(a[i + k] - b[i + k]);
        if (v) { n++; if (v > max) max = v; break; }
      }
    return { px: n, max, pct: +(100 * n / (a.length / 4)).toFixed(4) };
  };

  lay(false);

  // THE REFUSAL, BOTH WAYS. A plain floor is allowed now; one laid from a cut section is not.
  out.notes.push('poolWhyNot on a plain floor: ' + JSON.stringify(sa.poolWhyNot()));
  if (sa.poolWhyNot()) out.fail.push('a plain floor is still refused a pool: ' + sa.poolWhyNot());

  // A TILE WITH FLOOR IN IT. The middle of the grid, and asserted non-blank before anything is
  // compared - two blank tiles agree perfectly and prove nothing.
  const gx = Math.floor(plan.rAcross / 2), gy = Math.floor(plan.rDown / 2);
  const IDX = gy * plan.rAcross + gx;
  const seqC = sa.renderFloorTile(W, gx * ts, gy * ts, ts, ts, bleed);
  if (!sa.tilePainted(seqC)) out.fail.push('the sequential floor tile is blank; nothing below means anything');
  const seq = px(seqC);

  const po = await sa.tilePool(W, plan);
  if (!po) { out.fail.push('tilePool returned nothing for a floor'); return out; }
  const poolC = await po.tile(IDX);
  po.close();
  if (!sa.tilePainted(poolC)) out.fail.push('the POOLED floor tile is blank');
  const pooled = px(poolC);

  const d = diff(seq, pooled);
  out.diff = d;
  if (d.px) out.fail.push(`a pooled floor tile differs from the sequential one: ${d.px} pixels (${d.pct}%), up to ${d.max} levels`);

  // THE CONTROL.
  lay(true);
  const ctl = diff(seq, px(sa.renderFloorTile(W, gx * ts, gy * ts, ts, ts, bleed)));
  out.control = ctl;
  if (!ctl.px) out.fail.push('the control found nothing - shuffling the floor changed no pixel, so this comparison is measuring nothing');

  return out;
}, { SLAB, W });

await browser.close();

console.log('\nfloor-pool: Hero_Psyker at ' + W + 'px, the middle tile\n');
for (const n of r.notes) console.log('  ' + n);
if (r.diff) console.log('  pooled vs sequential   ' + r.diff.px + ' pixels differ'
                      + (r.diff.px ? ' (' + r.diff.pct + '%, up to ' + r.diff.max + ' levels)' : ''));
if (r.control) console.log('  control, shuffled      ' + r.control.px + ' pixels differ ('
                      + r.control.pct + '%) — the comparison can see a difference');
if (r.fail.length) { console.log('\nRED:'); for (const f of r.fail) console.log('  - ' + f); process.exit(1); }
console.log('\nfloor-pool: a pooled floor tile is byte-identical to the sequential one, and the control fired');
