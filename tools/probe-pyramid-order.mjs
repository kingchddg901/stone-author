// DOES BUILDING PYRAMID TILES IN PARALLEL STILL PUT THEM WHERE THEY BELONG?
//
// add-overviews decides a tile's offset at the moment it writes it, so TileOffsets is a record of
// write order rather than a plan. Hand the writer tile 7 before tile 6 and the file still holds every
// byte, in the wrong place, under a directory that says otherwise - a valid BigTIFF whose overview is
// quietly shuffled, inside a 44 GB master that was appended to in place. Nothing else in the 49 gates
// would see it: the TIFF checks pass, the reducer is unchanged, and only an eye on the picture would
// catch it. That is the whole reason this file exists.
//
// WHAT IT HAS TO PROVE:
//   1  the pool emits 0,1,2,... even when the results arrive backwards
//   2  it never runs more than its job count at once, and runs that many
//   3  every index comes out exactly once
//   4  a failing tile fails the run, by name, rather than hanging it
//   5  the quadrant mapping is the one the serial tool used - four colours, read back by corner
//   6  a quadrant past the grid edge stays at zero, and that is not the same tile as four real ones
//   7  three channels in, three channels out, at both sample counts
//   8  --jobs 1 and --jobs 7 produce the SAME BYTE STREAM through the real tile builder
//
// EACH ONE IS ABLATED where an ablation can exist: claim 1 against a pool that emits on arrival,
// claim 5 against a transposed quadrant mapping. A test that cannot go red is a preference.
//
//   node tools/probe-pyramid-order.mjs
import { deflateSync, inflateSync } from 'zlib';
import { loadReducer } from './lib/pyramid.mjs';
import { runPool } from './lib/pyramid-pool.mjs';
import { tileFromQuads, widen, narrow } from './lib/pyramid-tile.mjs';

const reduce2 = loadReducer();
let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('  ok    ' + name); return; }
  fails++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// A SCHEDULE THAT ARRIVES BACKWARDS. Task i takes (n - i) ticks, so with a job slot for every task the
// last one finishes first. Nothing here is a race: the delays are ordered and the gaps are wide.
const backwards = n => i => sleep((n - i) * 12).then(() => i);

// ---- 1, 2, 3: order, concurrency, completeness ---------------------------------------------------
{
  const n = 8, got = [];
  const { peak } = await runPool({ n, jobs: n, build: backwards(n), emit: (i, v) => { got.push([i, v]); } });
  ok('emits in index order when the results arrive backwards',
     got.every(([i], k) => i === k), got.map(([i]) => i).join(','));
  ok('and hands emit the value that task built', got.every(([i, v]) => i === v));
  ok('every index exactly once', got.length === n && new Set(got.map(([i]) => i)).size === n);
  ok('runs its whole job count when there is work for it', peak === n, 'peak ' + peak);
}
{
  const n = 20;
  const { peak } = await runPool({ n, jobs: 3, build: async i => i, emit: () => {} });
  ok('never exceeds the job count', peak === 3, 'peak ' + peak);
  const one = await runPool({ n, jobs: 1, build: async i => i, emit: () => {} });
  ok('and one job means one at a time', one.peak === 1, 'peak ' + one.peak);
}

// ---- the ABLATION for claim 1: a pool that emits on arrival ---------------------------------------
// If the backwards schedule cannot tell an ordered pool from an unordered one, claim 1 is decoration.
{
  const n = 8, got = [];
  await Promise.all(Array.from({ length: n }, (_, i) => backwards(n)(i).then(v => got.push(v))));
  ok('ABLATION emitting on arrival comes out in a different order',
     !got.every((v, k) => v === k), got.join(','));
}

// ---- 4: a failing tile fails the run ---------------------------------------------------------------
{
  let emitted = 0, caught = null;
  try {
    await runPool({ n: 6, jobs: 3, emit: () => { emitted++; },
      build: async i => { if (i === 4) throw new Error('the deflate fell over'); return i; } });
  } catch (e) { caught = e; }
  ok('a failing task rejects the run', caught !== null);
  ok('and names the task that did it', caught && caught.task === 4 && /the deflate fell over/.test(caught.message),
     caught && caught.message);
  ok('and does not hang waiting for it', true);   // reaching here at all is the claim
  ok('tiles before the failure were still emitted', emitted >= 1, String(emitted));
}

// ---- 5: the quadrant mapping, read back by corner --------------------------------------------------
// Four source tiles of four flat colours. reduce2 turns each into one quadrant, so the four corners of
// the output name which quad went where. A transposed mapping passes every length and checksum test
// there is and puts the picture's quarters in the wrong places.
const TW = 8, HALF = TW >> 1;
const flat = (v, spp) => {
  const px = new Uint8Array(TW * TW * spp);
  for (let i = 0; i < px.length; i += spp) { px[i] = v; px[i + 1] = v; px[i + 2] = v; if (spp === 4) px[i + 3] = 255; }
  return deflateSync(Buffer.from(px.buffer, 0, px.length));
};
for (const spp of [3, 4]) {
  const quads = [flat(10, spp), flat(20, spp), flat(30, spp), flat(40, spp)];
  const got = inflateSync(tileFromQuads(quads, TW, spp, reduce2));
  const at = (x, y) => got[(y * TW + x) * spp];
  ok('spp ' + spp + ': quad 0 is top-left', at(0, 0) === 10, 'got ' + at(0, 0));
  ok('spp ' + spp + ': quad 1 is top-RIGHT', at(HALF, 0) === 20, 'got ' + at(HALF, 0));
  ok('spp ' + spp + ': quad 2 is bottom-LEFT', at(0, HALF) === 30, 'got ' + at(0, HALF));
  ok('spp ' + spp + ': quad 3 is bottom-right', at(HALF, HALF) === 40, 'got ' + at(HALF, HALF));
  ok('spp ' + spp + ': ' + spp + ' channels in, ' + spp + ' channels out',
     got.length === TW * TW * spp, got.length + ' bytes');
}

// ---- the ABLATION for claim 5: transpose the two shifts --------------------------------------------
{
  const spp = 3, quads = [flat(10, spp), flat(20, spp), flat(30, spp), flat(40, spp)];
  // the same function with (q & 1) and (q >> 1) swapped - a plausible slip, and a valid file
  const bad = (qs) => {
    const out = new Uint8Array(TW * TW * 4);
    for (let q = 0; q < 4; q++) {
      if (!qs[q]) continue;
      const small = reduce2(widen(inflateSync(qs[q]), spp), TW, TW);
      const ox = (q >> 1) * HALF, oy = (q & 1) * HALF;          // <- transposed
      for (let y = 0; y < HALF; y++)
        out.set(small.subarray(y * HALF * 4, (y + 1) * HALF * 4), ((oy + y) * TW + ox) * 4);
    }
    const w8 = narrow(out, spp);
    return deflateSync(Buffer.from(w8.buffer, w8.byteOffset, w8.byteLength), { level: 6 });
  };
  const good = inflateSync(tileFromQuads(quads, TW, spp, reduce2));
  const wrong = inflateSync(bad(quads));
  ok('ABLATION a transposed quadrant mapping puts quad 1 bottom-left',
     wrong[(HALF * TW + 0) * spp] === 20 && good[(HALF * TW + 0) * spp] === 30,
     'transposed ' + wrong[(HALF * TW) * spp] + ', real ' + good[(HALF * TW) * spp]);
}

// ---- 6: padding, and that padding is visible -------------------------------------------------------
{
  const spp = 3, four = [flat(10, spp), flat(20, spp), flat(30, spp), flat(40, spp)];
  const one = [flat(10, spp), null, null, null];
  const got = inflateSync(tileFromQuads(one, TW, spp, reduce2));
  let zeros = true;
  for (let y = 0; y < TW; y++)
    for (let x = 0; x < TW; x++)
      if ((x >= HALF || y >= HALF) && got[(y * TW + x) * spp] !== 0) zeros = false;
  ok('a quadrant past the grid edge stays at zero', zeros);
  ok('and its top-left quadrant is still the tile it was given', got[0] === 10, 'got ' + got[0]);
  ok('ABLATION a padded tile is NOT the same bytes as a full one',
     !same(tileFromQuads(one, TW, spp, reduce2), tileFromQuads(four, TW, spp, reduce2)));
}

// ---- 7: the same input twice ------------------------------------------------------------------------
{
  const spp = 3, quads = [flat(11, spp), flat(22, spp), flat(33, spp), flat(44, spp)];
  ok('the same quads twice give the same bytes',
     same(tileFromQuads(quads, TW, spp, reduce2), tileFromQuads(quads, TW, spp, reduce2)));
}

// ---- 8: THE CLAIM THE TOOL MAKES - the job count does not change the bytes -------------------------
// The real tile builder, driven through the real pool, with results arriving in whatever order the
// delays give. 23 tiles so the last batch is partial, and every tile distinct so a swap shows.
{
  const spp = 3, n = 23;
  const src = Array.from({ length: n * 4 }, (_, k) => flat((k * 7 + 3) & 0xff, spp));
  const buildAt = i => {
    const quads = [0, 1, 2, 3].map(q => (i === 5 && q === 3 ? null : src[i * 4 + q]));
    return tileFromQuads(quads, TW, spp, reduce2);
  };
  const run = async jobs => {
    const parts = [];
    await runPool({ n, jobs,
      build: async i => { await sleep(((i * 37) % 11)); return buildAt(i); },
      emit: (i, z) => { parts.push(z); } });
    return { bytes: Buffer.concat(parts), lens: parts.map(p => p.length) };
  };
  const a = await run(1), b = await run(7), c = await run(23);
  ok('--jobs 1 and --jobs 7 give the same byte stream', same(a.bytes, b.bytes),
     a.bytes.length + ' vs ' + b.bytes.length + ' bytes');
  ok('and so does a job for every tile', same(a.bytes, c.bytes));
  ok('with the same tile boundaries, so the offsets would match too',
     a.lens.join(',') === b.lens.join(','));
  ok('and the stream is not trivially empty', a.bytes.length > n * 20, a.bytes.length + ' bytes');
  // ABLATION: one tile out of order has to change the stream, or claim 8 proves nothing
  const swapped = Buffer.concat((() => { const p = []; for (let i = 0; i < n; i++) p.push(buildAt(i)); const t = p[6]; p[6] = p[7]; p[7] = t; return p; })());
  ok('ABLATION swapping two tiles changes the stream', !same(a.bytes, swapped));
}

console.log('');
if (fails) { console.error('probe-pyramid-order: ' + fails + ' FAILED'); process.exit(1); }
console.log('probe-pyramid-order: tiles built in parallel are written in index order, the quadrant');
console.log('                     mapping is the serial one, and the job count does not touch a byte.');
