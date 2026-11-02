// A FORCED TILE OVERRIDES THE LADDER'S CHOICE, NOT ITS MEMORY TEST.
//
// `?tile=N` exists to run the configuration the planner would decline, and the forced branch says so
// in its own words: "neither gate may refuse it... Overriding a refusal is a choice; not knowing the
// outcome is not." It measured the bloom on that principle and did not measure the one thing that
// scales with the PICTURE rather than the tile.
//
// WHAT THAT COST, 2026-11-02. A forced 2048 at 1,048,576 on a slab with a specular coat: bleed is a
// fraction of the picture, so it came to 6,296 px and the pass canvas to 14,640 px - 857 MB, of which
// 86% is margin. poolWidthFor saw room = floor(12885 / 857) = 15, allowed the full eight, and eight
// 857 MB canvases went live at once: 6,856 MB, against a ladder whose own half-ceiling test would
// have refused anything over 6,442. The third render tile came back with a backing that never
// allocated, tilePainted caught it, the main-thread retry caught it again, and the export refused the
// master - correctly, and with no way to find out why, because that throw is the one failure that
// writes no file and the plan trail is only ever read out of a finished one.
//
// The same forced tile is 20 MB at 16,384, where the pool is right to run eight. Nothing about the
// tile size was wrong; the arithmetic simply was not done.
//
//   node tools/check-forced-peak.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const APP = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'stone-author.html'), 'utf8');
let bad = 0;
const fail = (m) => { console.log('  FAIL  ' + m); bad++; };
const ok = (m) => console.log('  ok    ' + m);

// THE FORCED BRANCH, in isolation. Everything below asks about the text between `if (forcedTile()) {`
// and the `} else {` that opens the ladder, so a test living in the ladder cannot satisfy these.
const iF = APP.indexOf('if (forcedTile()) {');
const iE = APP.indexOf('} else {', iF);
if (iF < 0 || iE < 0) { console.log('  FAIL  cannot find the forced branch'); process.exit(1); }
const FORCED = APP.slice(iF, iE);

// 1. IT ASKS. Against MEM_EASY, which is the ladder's own threshold and not a second opinion.
if (!/peak > MEM_EASY \* budgetMB/.test(FORCED))
  fail('the forced branch does not compare a peak against MEM_EASY - it overrides the ladder\'s only memory test');
else ok('the forced branch measures its peak against MEM_EASY');
if (!/peak = wide \* tmb/.test(FORCED) || !/wide = widthOf\(ts\)/.test(FORCED))
  fail('the peak is not width x tile - it must be what is LIVE AT ONCE, not one canvas');
else ok('the peak is the pool width times the tile, not one canvas');

// 2. AND IT STILL MAY NOT REFUSE. The force is the whole point; a throw here would delete the feature
// that found the bloom limit. Narrowing the POOL is permitted because the width was never forced.
if (/\bthrow\b/.test(FORCED))
  fail('the forced branch throws - the force stays a force, only the pool may give way');
else ok('the forced branch never refuses');
if (!/poolMax = Math\.floor\(MEM_EASY \* budgetMB/.test(FORCED))
  fail('nothing narrows the pool, so the measurement changes nothing');
else ok('an over-ceiling peak narrows the pool');
if (/\bts = /.test(FORCED.slice(FORCED.indexOf('bloom'))))
  fail('the forced tile is reassigned after the probe - the tile must stay exactly as forced');
else ok('the forced tile is never moved');

// 3. A FORCED WIDTH IS A FORCE TOO. `?pool=N` carries the same authority as `?tile=N`.
if (!/poolForced\(\)/.test(FORCED))
  fail('the narrowing ignores poolForced() - it would override an explicit ?pool=N');
else ok('an explicit ?pool=N is left alone');

// 4. THE PLAN CARRIES IT AND THE POOL READS IT. A cap computed and never consulted is the defect this
// whole gate is about, one layer along.
if (!/tileMB: tileMBof\(ts\), poolMax \}/.test(APP)) fail('the plan does not carry poolMax');
else ok('the plan carries poolMax');
if (!/p\.poolMax != null && want > p\.poolMax/.test(APP))
  fail('tilePool does not honour p.poolMax - the planner narrows and the pool ignores it');
else ok('tilePool honours p.poolMax');
// AND A CAP OF ONE IS SEQUENTIAL, NOT A POOL OF ONE. poolWidthFor says one worker is slower than no
// worker; a capped path that forgets it stands up a single worker AND passes the `if (!n)` guard.
if (!/const n = capped < 2 \? 0 : capped;/.test(APP))
  fail('a cap below 2 does not fall through to sequential - one worker is slower than no worker');
else ok('a cap below 2 means sequential');

// 5. THE FAILURE THAT WRITES NO MASTER EXPLAINS ITSELF.
if (!/exp\.err\.blank[\s\S]{0,220}p\.trail\.join/.test(APP))
  fail('the blank-tile throw does not carry p.trail - the only record of the plan dies with it');
else ok('the blank-tile throw carries the plan trail');

// 6. THE ARITHMETIC, over the constants THE APP DECLARES rather than a copy of them. If MEM_EASY or
// POOL_MAX move, these cases are re-judged against the new values - which is the point: a table of
// numbers that cannot notice the constant it depends on is a table of numbers.
const grab = (re, what) => { const m = APP.match(re); if (!m) { fail('cannot read ' + what); return null; } return +m[1]; };
const MEM_EASY = grab(/const MEM_EASY = ([\d.]+);/, 'MEM_EASY');
const POOL_MAX = grab(/const POOL_MAX = (\d+);/, 'POOL_MAX');
if (MEM_EASY !== null && POOL_MAX !== null) {
  ok(`read MEM_EASY ${MEM_EASY} and POOL_MAX ${POOL_MAX} from the app`);
  // His box, measured: 12 cores, a 12,885 MB budget. The three tiles are the three real masters -
  // two that rendered eight-wide and must stay eight-wide, one that did not and must narrow.
  const BUDGET = 12885, CORES = 12;
  const width = (tileMB) => {
    const n = Math.max(1, Math.min(CORES, POOL_MAX, Math.floor(BUDGET / Math.max(1, tileMB))));
    return n < 2 ? 0 : n;
  };
  const narrowed = (tileMB) => {
    const w = width(tileMB), peak = w * tileMB;
    if (!(w > 1) || !(peak > MEM_EASY * BUDGET)) return w;      // unchanged: the ladder is content
    const cap = Math.floor(MEM_EASY * BUDGET / Math.max(1, tileMB));
    return cap < 2 ? 0 : cap;
  };
  // tileMB, what it is, and the width that must come out.
  const CASES = [
    [17,  'storm treeline at 1,048,576, which rendered twice',          8],
    [20,  'Stone-Color-Lens-Subsurface at 16,384, which renders in 6.4s', 8],
    [857, 'the same forced 2048 at 1,048,576, which died at tile 3',    7],
  ];
  for (const [tmb, what, want] of CASES) {
    const got = narrowed(tmb);
    if (got !== want) fail(`${tmb} MB a tile (${what}) gives width ${got}, expected ${want}`);
    else ok(`${tmb} MB a tile -> ${got} wide (${what})`);
  }
  // AND IT MUST ACTUALLY BITE on the one that failed: equal to the unnarrowed width is a no-op.
  if (narrowed(857) >= width(857))
    fail(`narrowing does nothing at 857 MB a tile: ${width(857)} -> ${narrowed(857)}`);
  else ok(`narrowing bites at 857 MB a tile: ${width(857)} -> ${narrowed(857)}, ` +
          `${width(857) * 857} MB -> ${narrowed(857) * 857} MB`);
}

console.log(bad ? `\nforced-peak: ${bad} FAILURE(S)` : '\nforced-peak: OK');
process.exit(bad ? 1 : 0);
