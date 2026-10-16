// CAN A RENDER THAT DIED BE PICKED UP WHERE IT FELL, AND IS WHAT COMES OUT THE SAME FILE?
//
// A 262,144 master is six hours on the slowest device in the fleet, and an unplugged cable loses every
// byte of it: the tiles are written through createWritable, which commits at close(), and the directory
// that says where each tile went lives only in a JavaScript array. Nothing on disk survives.
//
// The record fixes the second half of that - it is the durable statement of what is done - and this file
// is the only place its logic can be tested. OPFS and the worker that will own it do not exist outside a
// browser, and Playwright cannot be spawned on the machine this was written on, so the rule was: keep
// everything decidable on THIS side of the boundary and prove it here. These four functions are lifted
// out of the app by text and run as themselves. Not reimplemented, not mocked - a mock would agree with
// the caller and tell us nothing about the callee.
//
// WHAT IT HAS TO PROVE, and the shape of each:
//   1  a row survives a round trip
//   2  a TORN row - the normal shape of a file whose tab died mid-write - stops the scan at the last
//      row that sealed, and reports exactly where that was
//   3  a crash at every row index, replayed, reproduces the uninterrupted run EXACTLY: the same offsets,
//      the same lengths, the same running position, and the same light and timing accumulators
//   4  the signature refuses a resume across anything that would change the layout
// and an ABLATION for each of 2 and 3, because a comparison that cannot go red has proved nothing. The
// first version of (3) passed while comparing an empty array to an empty array.
//
//   node tools/probe-resume.mjs
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');

function liftFn(name) {
  const needle = 'function ' + name + '(';
  const hits = [];
  for (let k = SRC.indexOf(needle); k >= 0; k = SRC.indexOf(needle, k + 1)) hits.push(k);
  if (!hits.length) throw new Error('cannot find ' + name + ' - probe is stale');
  if (hits.length > 1) throw new Error(name + ' is defined ' + hits.length + ' times - lift is ambiguous');
  let i = SRC.indexOf('{', hits[0]), d = 0;
  for (;; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}' && --d === 0) break; }
  return SRC.slice(hits[0], i + 1);
}
const NAMES = ['resumeSig', 'resumeRow', 'resumeScan', 'resumeState',
               'resumeCheckCount', 'resumeSample', 'resumeVerify'];
const BODY = NAMES.map(liftFn).join('\n');
const APP = new Function(BODY + '; return {' + NAMES.join(',') + '};')();
const { resumeSig, resumeRow, resumeScan, resumeState,
        resumeCheckCount, resumeSample, resumeVerify } = APP;

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('  ok    ' + name); return; }
  fails++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};
const J = v => JSON.stringify(v, (k, x) => (x instanceof Set ? [...x].sort((a, b) => a - b) : x));

// ---- a render, as the export loop actually drives it ----------------------------------------------
// One render tile at `ts` is cut into k x k stored tiles at scattered indices ty*across+tx, and the
// edge ones are skipped where the cut runs past the picture. That scatter is the reason the record
// carries pieces at all, so the fixture has to have it rather than a tidy 1:1.
const K = 2, ACROSS = 5, DOWN = 3, RENDERS = 6, RACROSS = 3;   // 3x2 render tiles -> 5x3 stored, edges clipped
const N = ACROSS * DOWN;
const BASE = 16;                                               // the placeholder header a master starts with

// Deterministic stand-ins for a tile's compressed length and its light, so a replay is comparable.
const lenOf = i => 100 + ((i * 37) % 23);
const msOf = n => 10 + n * 3;

function cutOf(n) {                                            // which stored tiles this render tile makes
  const gx = n % RACROSS, gy = (n / RACROSS) | 0, out = [];
  for (let sy = 0; sy < K; sy++) for (let sx = 0; sx < K; sx++) {
    const tx = gx * K + sx, ty = gy * K + sy;
    if (tx >= ACROSS || ty >= DOWN) continue;                  // past the picture entirely
    out.push({ i: ty * ACROSS + tx, len: lenOf(ty * ACROSS + tx) });
  }
  return out;
}
const rowFor = n => {
  const pieces = cutOf(n), bytes = pieces.reduce((a, q) => a + q.len, 0);
  return { n, ms: msOf(n), bytes, litSum: n * 1.5 + 0.25, litUp: n, litN: n * 4 + 1, pieces };
};
const encode = ns => {
  const parts = ns.map(n => { const r = rowFor(n); return resumeRow(r.n, r.ms, r.bytes, r.litSum, r.litUp, r.litN, r.pieces); });
  const total = parts.reduce((a, p) => a + p.length, 0), u8 = new Uint8Array(total);
  let o = 0; for (const p of parts) { u8.set(p, o); o += p.length; }
  return u8;
};
const ALL = [...Array(RENDERS).keys()];

// ---- 1. round trip ---------------------------------------------------------------------------------
{
  const u8 = encode(ALL), got = resumeScan(u8);
  ok('a record round-trips', got.bytes === u8.length && got.rows.length === RENDERS,
     got.rows.length + ' rows, ' + got.bytes + ' of ' + u8.length + ' bytes');
  ok('every field survives', J(got.rows) === J(ALL.map(rowFor)));
}

// ---- 2. a torn tail --------------------------------------------------------------------------------
// Cutting a record anywhere inside its last row must leave the rows BEFORE it intact and report their
// end, so the caller truncates to exactly the durable part. Checked at every possible cut, not one.
{
  const whole = encode(ALL), good = encode(ALL.slice(0, RENDERS - 1));
  let worst = null;
  for (let cut = good.length + 1; cut < whole.length; cut++) {
    const got = resumeScan(whole.slice(0, cut));
    if (got.rows.length !== RENDERS - 1 || got.bytes !== good.length) { worst = cut; break; }
  }
  ok('a torn row stops the scan at the last sealed one', worst === null,
     worst === null ? '' : 'first bad cut at ' + worst);

  // ABLATION: the whole record must NOT read as short, or the test above would pass on anything.
  const full = resumeScan(whole);
  ok('ABLATION an intact record is not treated as torn', full.rows.length === RENDERS && full.bytes === whole.length);

  // ABLATION: corrupt the seal of the last row and it must be dropped.
  const broken = whole.slice();
  broken[whole.length - 1] ^= 0xFF;
  const b = resumeScan(broken);
  ok('ABLATION a broken seal drops its row', b.rows.length === RENDERS - 1 && b.bytes === good.length,
     b.rows.length + ' rows');
}

// ---- 3. a crash at every row, replayed ---------------------------------------------------------------
// The claim this file exists for: resuming produces the SAME FILE. Same offsets, same lengths, same
// running position, same accumulators - not merely a valid master.
{
  const uninterrupted = resumeState(resumeScan(encode(ALL)).rows, N, BASE);
  let bad = null;
  for (let crashAfter = 0; crashAfter <= RENDERS; crashAfter++) {
    // what survived the crash, scanned off disk
    const kept = resumeScan(encode(ALL.slice(0, crashAfter)));
    const st = resumeState(kept.rows, N, BASE);
    // the loop restarts and does whatever the record does not list, in index order, exactly as the
    // export loop consumes render tiles
    const rest = ALL.filter(n => !st.done.has(n));
    const replayed = resumeState(resumeScan(encode(ALL.slice(0, crashAfter).concat(rest))).rows, N, BASE);
    if (J(replayed) !== J(uninterrupted)) { bad = crashAfter; break; }
  }
  ok('a crash at any row replays to a byte-identical layout', bad === null,
     bad === null ? '' : 'diverged when crashing after row ' + bad);

  // ABLATION ONE: the comparison must be able to see a missing tile. Drop a row from the replay and it
  // has to go red - the first version of this test compared two empty arrays and passed.
  const holed = resumeState(resumeScan(encode(ALL.filter(n => n !== 2))).rows, N, BASE);
  ok('ABLATION a dropped render tile is caught', J(holed) !== J(uninterrupted));

  // ABLATION TWO: and it must see a reordering, which is what changes the OFFSETS while leaving every
  // tile present. This is the one a count-based resume would miss.
  const swapped = [...ALL]; [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  const reordered = resumeState(resumeScan(encode(swapped)).rows, N, BASE);
  ok('ABLATION a reordered replay is caught', J(reordered) !== J(uninterrupted));

  // and the accumulators specifically, because they are the silent half: a master with every tile and
  // the wrong light mean looks perfectly fine.
  const expSum = ALL.reduce((a, n) => a + (n * 1.5 + 0.25), 0);
  ok('the light accumulators come back whole',
     Math.abs(uninterrupted.litSum - expSum) < 1e-9 &&
     uninterrupted.litN === ALL.reduce((a, n) => a + n * 4 + 1, 0),
     'litSum ' + uninterrupted.litSum + ' want ' + expSum);
  ok('the per-tile arrays come back whole and in order',
     J(uninterrupted.tileMs) === J(ALL.map(msOf)) && uninterrupted.tileBytes.length === RENDERS);
  ok('every stored tile has an offset and the end is where the bytes end',
     uninterrupted.offs.every(v => v !== undefined) &&
     uninterrupted.at === BASE + [...Array(N).keys()].reduce((a, i) => a + lenOf(i), 0));
}

// ---- 4. the signature ------------------------------------------------------------------------------
{
  const base = { inputs: '8cef8303', w: 262144, h: 163840, ts: 2048,
                 store: 2048, bleed: 4, across: 128, down: 80, renders: 10240 };
  const sig = resumeSig(base);
  let same = [];
  for (const k of Object.keys(base)) {
    const alt = { ...base, [k]: typeof base[k] === 'number' ? base[k] + 1 : base[k] + 'x' };
    if (resumeSig(alt) === sig) same.push(k);
  }
  ok('every field in the signature changes it', same.length === 0, 'ignored: ' + same.join(', '));
  ok('the same plan gives the same signature', resumeSig({ ...base }) === sig);
  // AND THE OTHER DIRECTION. The build was in here and was taken out on 2026-10-15, because including it
  // abandons every job in flight on every deploy and this repo shipped four builds that day. That is a
  // decision, so it is pinned from both sides: the loop above catches a field that stopped counting, and
  // this catches the build quietly coming back and killing resumes nobody would connect to a deploy.
  ok('the build does NOT take part in the signature',
     resumeSig({ ...base, build: '2026.01.01.1' }) === resumeSig({ ...base, build: '2099.12.31.9' }));
}

// ---- 5. do not resume on a hash alone --------------------------------------------------------------
// On 2026-10-15 two UV masters of one slab shared renderSig 95ef95fe and did not share a picture. The
// cause was never found and the state that produced the first is gone, so the signature cannot be
// repaired - what can be done is to stop trusting it alone. These three decide how much evidence a
// resume gathers, where it gathers it, and whether the evidence agrees.
{
  // HOW MANY. Asked of the per-tile timings the record already carries, so the master says what a
  // verification tile costs on the device that wrote it.
  const fast = new Array(200).fill(13);          // desktop at 512
  const slow = new Array(40).fill(623);          // desktop at 4096
  const grim = new Array(40).fill(4000);         // an A7 at 4096
  ok('a 10 s budget buys hundreds of cheap tiles', resumeCheckCount(fast, 10000, 100) === 100);
  ok('the same budget buys 16 expensive ones', resumeCheckCount(slow, 10000, 100) === 16,
     String(resumeCheckCount(slow, 10000, 100)));
  ok('and 2 on the slowest hardware', resumeCheckCount(grim, 10000, 100) === 2,
     String(resumeCheckCount(grim, 10000, 100)));
  // NEVER ZERO. A resume that gathers no evidence at all is the thing this exists to prevent, so even a
  // tile dearer than the whole budget is checked once.
  ok('never fewer than one, however dear the tile',
     resumeCheckCount(new Array(10).fill(99999), 1000, 100) === 1);
  ok('an empty record still asks for one', resumeCheckCount([], 10000, 100) === 1);

  // WHICH ONES. First and last always - the last is nearest whatever stopped the render, the first
  // catches a systematic placement error a middle sample sails past.
  const rows = ALL.map(rowFor);
  const three = resumeSample(rows, 3);
  ok('the sample holds the first and the last written',
     three.includes(rows[0].n) && three.includes(rows[rows.length - 1].n), JSON.stringify(three));
  ok('the sample is the size asked for', three.length === 3, String(three.length));
  ok('asking for more than exists returns all of them',
     resumeSample(rows, 99).length === rows.length);
  ok('an empty record samples nothing', resumeSample([], 5).length === 0);

  // THE VERDICT. Compared compressed, which is what the file stores and what a re-render already has.
  const B = (i, ...b) => ({ i, bytes: Uint8Array.from(b) });
  const storedPieces = [B(0, 1, 2, 3), B(1, 4, 5, 6)];
  ok('identical bytes pass', resumeVerify(storedPieces, [B(0, 1, 2, 3), B(1, 4, 5, 6)]).ok);
  // ABLATIONS, one per way this can be wrong. A verdict that cannot go red would make the whole check
  // theatre - and this one is the last thing standing between a resume and a master built from two
  // different pictures.
  ok('ABLATION one changed byte fails', !resumeVerify(storedPieces, [B(0, 1, 2, 9), B(1, 4, 5, 6)]).ok);
  ok('ABLATION a different length fails', !resumeVerify(storedPieces, [B(0, 1, 2), B(1, 4, 5, 6)]).ok);
  ok('ABLATION a different tile index fails', !resumeVerify(storedPieces, [B(7, 1, 2, 3), B(1, 4, 5, 6)]).ok);
  ok('ABLATION a missing piece fails', !resumeVerify(storedPieces, [B(0, 1, 2, 3)]).ok);
  // AND THE EMPTY CASE, which is the one a careless implementation passes: nothing compared against
  // nothing is not agreement, it is no evidence.
  ok('ABLATION nothing against nothing is NOT a pass', !resumeVerify([], []).ok);
}

console.log('');
if (fails) { console.error('probe-resume: ' + fails + ' FAILED'); process.exit(1); }
console.log('probe-resume: the record is sound — a crash at any row replays to the same file,');
console.log('              and a resume will not be taken on a signature alone.');
