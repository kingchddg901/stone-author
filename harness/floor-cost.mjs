// WHAT A TILED FLOOR COSTS, AND HOW MUCH OF THAT IS THE PAINTER.
//
//   node tools/make-probe-builds.mjs --only=ablate && node harness/floor-cost.mjs [--w=8192]
//
// THE ONE QUESTION IT ANSWERS: of the time a floor tile takes, what share is paintContent — the step
// `exp.gpu.floor` refuses to put on a shader. It does NOT answer what a port would buy, and that is
// not modesty. tools/make-probe-builds.mjs was validated against a known shader wall on wood and
// MISSED IT BY 2x (target 12.5 s, ablation said 23.1), so the conversion from share to speedup is the
// one thing this instrument is known to get wrong. Its own comment says it: ask what painting costs.
//
// WHY A FLOOR IS THE INTERESTING CASE. exportTiff reaches the floor through renderFloorTile, which
// calls paintContent ONCE PER PIECE inside drawTilesTo's callback, each time with its own translate
// sliding the slab under the piece. Two consequences the app already states in its own comments:
// `exportTiff nulls the pool whenever tiles are laid` and the serialised worker core has no floor
// path at all, so a floor master runs SINGLE-THREADED on the main thread; and gpuWhyNot returns
// `exp.gpu.floor`, so it has no shader either. The slab arm below is the same picture with the floor
// off - the path that gets both - which is what makes the floor number mean anything.
//
// HOW THE ABLATION BEHAVES HERE, stated because it is not how it behaves on the slab path. The blit
// cache is keyed on canvas size, ident, angleView, uvMode and material - NOT on the per-piece
// transform - and every piece in a tile shares one scratch canvas of one size. So in the floor arm
// the first piece paints for real and every piece after it blits that cache: per-piece painting goes,
// one real paint and N blits stay. That is the intended shape of this ablation and it is also why the
// ablated floor's PIXELS are wrong by design, every piece wearing the first one's material. Timing
// only. harness/floor.mjs is the gate that the real path does not do that.
//
// EACH CELL GETS A FRESH PAGE. The cache is closure-local and keyed on a canvas size both arms share,
// so running them in one page would serve the slab arm the floor arm's pixels.
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { launchChromium } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const argOf = (n, d) => Number((args.find(a => a.startsWith('--' + n + '=')) || ('=' + d)).split('=')[1]);
const W = argOf('w', 8192);
const REPS = argOf('reps', 5), DROP = 2;   // the first tile is 215% of its own average on desktop
                                           // Chrome (docs/devices.md), and rep 1 is also what fills
                                           // the ablation's cache, so two go in the bin.
const SLAB = JSON.parse(readFileSync(join(root, 'gallery', 'slabs', 'Hero_Psyker.json'), 'utf8'));
const BUILDS = [['full painter', 'stone-author.hooked.html'],
                ['painter ablated', 'stone-author.paint-ablated.html']];
const FLOOR = { pattern: 'rhombus', sizeIn: 17, groutIn: 0.03125, kerfIn: 0,
                edge: 'square', joints: true, assembly: 'guide', shuffle: false };

const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const f2 = n => (Math.round(n * 100) / 100).toFixed(2);

const browser = await launchChromium();
const cells = {};

for (const [buildName, file] of BUILDS) {
  for (const arm of ['floor', 'slab']) {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    page.on('pageerror', e => console.error('page error:', e.message));
    await page.goto(pathToFileURL(join(here, 'dist', file)).href);
    await page.waitForFunction(() => !!window.__sa, null, { timeout: 30000 });

    const r = await page.evaluate(async ({ SLAB, FLOOR, W, REPS, arm }) => {
      const sa = window.__sa;
      sa.deserialize(SLAB);
      const plan = await sa.tiffPlan(W);
      const ts = plan.ts, bleed = plan.bleed;
      let pieces = 0, inTile = 0;
      if (arm === 'floor') {
        sa.layTiles = true;
        Object.assign(sa.T, FLOOR);
      } else {
        sa.layTiles = false;
      }
      sa.render();

      // A TILE WITH THE PICTURE IN IT, not an edge tile that is mostly nothing: the middle of the
      // grid. Both arms measure the same rectangle of the same slab.
      const gx = Math.floor(plan.rAcross / 2), gy = Math.floor(plan.rDown / 2);
      const x0 = gx * ts, y0 = gy * ts;

      if (arm === 'floor') {
        const inst = sa.tileInstances();
        pieces = inst.length;
        // frame units: x spans 0..1 over W, y spans 0..H
        const fx0 = x0 / W, fx1 = (x0 + ts) / W, fy0 = y0 / W, fy1 = (y0 + ts) / W;
        for (const t of inst) {
          let lo0 = 1e9, hi0 = -1e9, lo1 = 1e9, hi1 = -1e9;
          for (const q of t.poly) {
            if (q[0] < lo0) lo0 = q[0]; if (q[0] > hi0) hi0 = q[0];
            if (q[1] < lo1) lo1 = q[1]; if (q[1] > hi1) hi1 = q[1];
          }
          if (hi0 >= fx0 && lo0 <= fx1 && hi1 >= fy0 && lo1 <= fy1) inTile++;
        }
      }

      const ms = [];
      let blank = 0;
      for (let i = 0; i < REPS; i++) {
        const t = performance.now();
        const c = arm === 'floor' ? sa.renderFloorTile(W, x0, y0, ts, ts, bleed)
                                  : sa.renderOneTile(W, x0, y0, ts, ts, bleed);
        ms.push(performance.now() - t);
        if (!sa.tilePainted || !sa.tilePainted(c)) blank++;
        c.width = 1; c.height = 1;                    // hand the allocation back
      }
      return { ms, ts, bleed, pieces, inTile, blank, gx, gy,
               rAcross: plan.rAcross, rDown: plan.rDown };
    }, { SLAB, FLOOR, W, REPS, arm });

    await page.close();
    const kept = r.ms.slice(DROP);
    cells[buildName + '|' + arm] = { ...r, kept, med: med(kept) };
  }
}
await browser.close();

const any = Object.values(cells)[0];
console.log(`\nfloor-cost: Hero_Psyker at ${W}px, tile ${any.ts} + ${any.bleed} bleed, `
          + `grid ${any.rAcross}x${any.rDown}, measuring tile (${any.gx},${any.gy})`);
console.log(`            ${REPS} renders a cell, first ${DROP} discarded, median of the rest\n`);

const fl = cells['full painter|floor'], fs = cells['full painter|slab'];
const al = cells['painter ablated|floor'], as = cells['painter ablated|slab'];
console.log(`pieces in the whole floor   ${fl.pieces}`);
console.log(`pieces crossing THIS tile   ${fl.inTile}   <- paintContent calls in one renderFloorTile\n`);

console.log('arm'.padEnd(8) + 'full painter'.padStart(14) + 'ablated'.padStart(12)
          + 'painting share'.padStart(17) + '    kept renders (ms)');
for (const [name, full, abl] of [['floor', fl, al], ['slab', fs, as]]) {
  const share = 100 * (1 - abl.med / full.med);
  console.log(name.padEnd(8) + (f2(full.med) + ' ms').padStart(14) + (f2(abl.med) + ' ms').padStart(12)
            + (f2(share) + '%').padStart(17) + '    ' + full.kept.map(v => f2(v)).join('  '));
}
console.log(`\nfloor / slab, full painter  ${f2(fl.med / fs.med)}x   `
          + `(the same rectangle of the same slab, floor on vs off)`);
const blanks = Object.entries(cells).filter(([, c]) => c.blank).map(([k, c]) => k + ':' + c.blank);
console.log(blanks.length ? `\nBLANK TILES, the numbers above are not trustworthy: ${blanks.join(', ')}`
                          : `\nno blank tiles in any cell`);
const spread = Object.entries(cells).map(([k, c]) =>
  k + ' ' + f2(100 * (Math.max(...c.kept) - Math.min(...c.kept)) / c.med) + '%');
console.log('run-to-run spread over the kept renders: ' + spread.join(' · '));
console.log('\nThis is a PAINTING SHARE. It is not a predicted speedup - the same instrument missed a');
console.log('known shader wall by 2x on wood. See the header and tools/make-probe-builds.mjs.');
