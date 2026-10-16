// DOES THE LAYOUT SURVIVE PAST 2 GB?
//
// BigTIFF was chosen over classic TIFF precisely so this file has no 4 GB ceiling — the comment above
// tiffLayout says so. The alignment helper then put back a ceiling at HALF that:
//
//     pad8 = n => (n + 7) & ~7
//
// `&` coerces its operands to int32, which is SIGNED. The wrap therefore begins at 2^31, not 2^32:
// ToInt32 maps [2^31, 2^32) onto the negatives, so the moment tile data passes 2,147,483,648 bytes
// pad8 returns a position BELOW where the data ends and `gap = ifdAt - end` goes hugely negative. The
// first use of it is `new Uint8Array(gap)`, so the render dies with
//
//     Invalid typed array length: -4294967295
//
// at the very last step. Measured in the field: 262144 x 163840, tile data ending at 4,264,729,215
// bytes — which is BELOW 2^32, so the byte count itself looks harmless — failed exactly that way after
// 95 minutes with all 2560 tiles already written.
//
// The first version of this probe put the boundary at 2^32 and tested 1.35 GB against 4.83 GB, which
// SKIPS the band the real failure landed in. Case B below is the actual boundary; case C is the file
// that died. A rewrite safe past 2^32 but not past 2^31 would have passed the old probe.
//
// THE INPUT THAT MAKES THIS RED is any of B, C or D. The ablation restores the bitwise form and
// requires A to keep passing while all three throw, so what is under test is the boundary itself.
//
//   node tools/probe-tiff-offsets.mjs
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');

function liftFn(name) {
  const needle = 'function ' + name + '(';
  const hits = [];
  for (let k = SRC.indexOf(needle); k >= 0; k = SRC.indexOf(needle, k + 1)) hits.push(k);
  if (!hits.length) throw new Error('cannot find function ' + name + ' - probe is stale');
  if (hits.length > 1) throw new Error(name + ' is defined ' + hits.length + ' times - lift is ambiguous');
  let i = SRC.indexOf('{', hits[0]), d = 0;
  for (;; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}' && --d === 0) break; }
  return SRC.slice(hits[0], i + 1);
}
const LAYOUT = liftFn('tiffLayout');
const build = src => new Function(src + '; return tiffLayout;')();

// A grid whose tile data ends at `end`: every tile but the last is `each` bytes, the last is sized to
// land the total exactly where we want it. Offsets are real byte positions, as the sink produces them.
function grid(across, down, end) {
  const N = across * down, each = Math.floor((end - 16) / N);
  const offs = [], cnts = [];
  let at = 16;
  for (let i = 0; i < N; i++) { offs.push(at); cnts.push(i === N - 1 ? end - at : each); at += cnts[i]; }
  return { offs, cnts, N };
}
const u64at = (u8, p) => {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return dv.getUint32(p, true) + dv.getUint32(p + 4, true) * 4294967296;
};

let fails = 0;
const claim = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`}`);
};

// `end` is where the tile data stops. Deliberately not a multiple of 8, so the pad is exercised.
function check(label, W, H, end, layout) {
  const { offs, cnts } = grid(Math.ceil(W / 4096), Math.ceil(H / 4096), end);
  const { head, tail } = layout(W, H, 4096, 4096, offs, cnts, 'probe');
  const ifdAt = u64at(head, 8);
  const gapLen = tail[0].length === ifdAt - end ? tail[0].length : -1;
  console.log(`  ${label}: data ends ${end}, IFD at ${ifdAt}, pad ${ifdAt - end}`);
  claim('the directory lands AFTER the tile data', ifdAt >= end, true);
  claim('and is 8-byte aligned', ifdAt % 8, 0);
  claim('the pad is a real gap, 0-7 bytes', ifdAt - end >= 0 && ifdAt - end < 8, true);
  claim('the leading pad block matches it', gapLen, ifdAt - end);
  return ifdAt;
}

const layout = build(LAYOUT);

console.log('\nA  the 131072 master that shipped: 1.35 GB, under 2^31 — this always worked');
check('A', 131072, 81920, 1348000003, layout);           // and it was 63% of the way to the edge

console.log('\nB  just past 2^31: THE REAL BOUNDARY, where the signed wrap begins');
check('B', 262144, 163840, 2147483651, layout);          // 2^31 + 3

console.log('\nC  4,264,729,215 — the exact end of the master that died in the field');
check('C', 262144, 163840, 4264729215, layout);

console.log('\nD  far past 2^32, because nothing here should care where either line was');
check('D', 524288, 327680, 19327352835, layout);         // ~18 GB

console.log('\nablation: pad8 back to the bitwise form');
{
  const old = LAYOUT.replace('pad8 = n => Math.ceil(n / 8) * 8', 'pad8 = n => (n + 7) & ~7');
  if (old === LAYOUT) { console.log('  FAIL  could not find pad8 to ablate - probe is stale'); fails++; }
  else {
    const bad = build(old);
    const throwsAt = end => {
      const { offs, cnts } = grid(64, 40, end);
      try { bad(262144, 163840, 4096, 4096, offs, cnts, 'probe'); return null; } catch (e) { return String(e.message); }
    };
    for (const [name, end] of [['B  2^31 + 3', 2147483651], ['C  the field failure', 4264729215], ['D  18 GB', 19327352835]]) {
      const msg = throwsAt(end);
      claim(`${name} throws under the old pad8`, /Invalid typed array length|negative|Invalid array/i.test(msg || ''), true);
      console.log(`          ${msg}`);
    }
    // C must reproduce the field error EXACTLY, or this probe is testing a different defect than the
    // one that cost 95 minutes.
    claim('and C reproduces the reported error to the byte',
          throwsAt(4264729215), 'Invalid typed array length: -4294967295');
    // A must still pass under the old code, or the ablation says nothing about where the line is.
    const a = grid(32, 20, 1348000003);
    let fine = true;
    try { bad(131072, 81920, 4096, 4096, a.offs, a.cnts, 'probe'); } catch (_) { fine = false; }
    claim('while A is unaffected - the defect is the 2^31 boundary, not the arithmetic', fine, true);
  }
}

// ---- E, F: WRITE ORDER IS NOT INDEX ORDER ---------------------------------------------------------
//
// Offsets are handed out in WRITE order by a sink addressed by INDEX. `resumeState` says so in as many
// words and refuses to assume the order; tiffLayout assumed it anyway, taking the end of the file from
// `offs[N - 1] + cnts[N - 1]`. That holds only while the highest-INDEX tile is also the LAST WRITTEN -
// an accident of today's export loop, not a property of the sink.
//
// THE INPUT THAT MAKES THIS RED is E: the same tiles, the same lengths, handed over in an order that
// ends somewhere other than N-1. Under the old line the directory is placed BELOW the end of the tile
// data, so the master overwrites its own last tile - with every byte already on disk, at the last step.

// The same grid written back-to-front: tile N-1 goes down FIRST and tile 0 LAST. Every tile present,
// every length unchanged; only the order they reached the sink differs.
function reversed(across, down, end) {
  const N = across * down, each = Math.floor((end - 16) / N);
  const offs = new Array(N), cnts = new Array(N);
  let at = 16;
  for (let w = 0; w < N; w++) {                  // w is WRITE order, i is the tile's INDEX
    const i = N - 1 - w;
    cnts[i] = w === N - 1 ? end - at : each;
    offs[i] = at; at += cnts[i];
  }
  return { offs, cnts, N };
}

console.log('');
console.log('E  the same tiles written back-to-front: the data ends at index 0, not index N-1');
{
  const W = 262144, H = 163840, end = 4264729215;
  const { offs, cnts, N } = reversed(Math.ceil(W / 4096), Math.ceil(H / 4096), end);
  claim('the fixture really does end somewhere other than N-1',
        offs[N - 1] + cnts[N - 1] < end && offs[0] + cnts[0] === end, true);
  const ifdAt = u64at(layout(W, H, 4096, 4096, offs, cnts, 'probe').head, 8);
  console.log('  E: data really ends ' + end + ', IFD at ' + ifdAt);
  claim('the directory still lands after ALL the tile data', ifdAt >= end, true);
  claim('and is 8-byte aligned', ifdAt % 8, 0);

  // THE ABLATION. Put the index assumption back: E must go red while A - a grid written in index
  // order - keeps passing, or what is under test is not the ordering.
  const CUT = 'let end = 16;', TAIL = String.fromCharCode(10) + '    }';
  const c0 = LAYOUT.indexOf(CUT), c1 = LAYOUT.indexOf(TAIL, c0);
  const old = c0 < 0 || c1 < 0 ? LAYOUT
    : LAYOUT.slice(0, c0) + 'let end = N ? offs[N - 1] + cnts[N - 1] : 16;' + LAYOUT.slice(c1 + TAIL.length);
  if (old === LAYOUT) { console.log('  FAIL  could not find the end loop to ablate - probe is stale'); fails++; }
  else {
    const bad = build(old);
    const badIfd = u64at(bad(W, H, 4096, 4096, offs, cnts, 'probe').head, 8);
    claim('ABLATION the index assumption puts the directory INSIDE the tile data', badIfd < end, true);
    console.log('          IFD at ' + badIfd + ', which is ' + (end - badIfd) + ' bytes BEFORE the data ends');
    const a = grid(32, 20, 1348000003);
    claim('while a grid written in INDEX order is unaffected - the defect is the ORDER',
          u64at(bad(131072, 81920, 4096, 4096, a.offs, a.cnts, 'probe').head, 8) >= 1348000003, true);
  }
}

console.log('');
console.log('F  a tile that was never written');
{
  const { offs, cnts } = grid(8, 5, 100000);
  delete offs[17];                               // a hole in the MIDDLE, where nothing used to look
  let msg = null;
  try { layout(32768, 20480, 4096, 4096, offs, cnts, 'probe'); } catch (e) { msg = String(e.message); }
  claim('a hole anywhere is refused, not carried into the header', /never written/.test(msg || ''), true);
  console.log('          ' + msg);
}

console.log(fails ? `\n${fails} FAILED\n` : '\nall claims hold\n');
process.exit(fails ? 1 : 0);
