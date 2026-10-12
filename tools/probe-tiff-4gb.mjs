// DOES THE LAYOUT SURVIVE PAST 4 GB?
//
// BigTIFF was chosen over classic TIFF precisely so this file has no 4 GB ceiling — the comment above
// tiffLayout says so. The alignment helper then put the ceiling back:
//
//     pad8 = n => (n + 7) & ~7
//
// `&` coerces its operands to int32. For tile data ending past 2^32 the sum wraps, pad8 returns a value
// about 4.29 billion BELOW where the data actually ends, and `gap = ifdAt - end` goes hugely negative.
// The first use of it is `new Uint8Array(gap)`, so the render dies with
//
//     Invalid typed array length: -4294967295
//
// at the very last step. Measured: 262144 x 163840 failed that way after 95 minutes. It could not have
// been found earlier — 65535 wrote 0.41 GB and 131072 wrote 1.35 GB, and this is the first output size
// whose tile data crosses 2^32 at all.
//
// THE INPUT THAT MAKES THIS RED is case B: offsets whose last tile ends past 4 GB. The ablation below
// restores the bitwise form and requires B to throw again, so the case is testing pad8 and not the
// surrounding structure.
//
//   node tools/probe-tiff-4gb.mjs
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

console.log('\nA  a 131072 master: 1.35 GB of tile data, comfortably inside 32 bits');
check('A', 131072, 81920, 1348000003, layout);

console.log('\nB  a 262144 master: tile data past 4 GB — the size that actually failed');
check('B', 262144, 163840, 4831838211, layout);          // ~4.5 GB, just as projected

console.log('\nC  far past it, because nothing here should care where 2^32 was');
check('C', 524288, 327680, 19327352835, layout);         // ~18 GB

console.log('\nablation: pad8 back to the bitwise form');
{
  const old = LAYOUT.replace('pad8 = n => Math.ceil(n / 8) * 8', 'pad8 = n => (n + 7) & ~7');
  if (old === LAYOUT) { console.log('  FAIL  could not find pad8 to ablate - probe is stale'); fails++; }
  else {
    const bad = build(old);
    const { offs, cnts } = grid(64, 40, 4831838211);
    let threw = null;
    try { bad(262144, 163840, 4096, 4096, offs, cnts, 'probe'); } catch (e) { threw = String(e.message); }
    claim('case B throws again, so case B was testing pad8', /Invalid typed array length|negative|Invalid array/i.test(threw || ''), true);
    console.log(`          it says: ${threw}`);
    // and case A must still pass under the old code, or the ablation proves nothing about the ceiling
    let fine = true;
    try { bad(131072, 81920, 4096, 4096, ...Object.values(grid(32, 20, 1348000003)).slice(0, 2), 'probe'); } catch (_) { fine = false; }
    claim('while case A is unaffected by it - the defect is the 4 GB boundary, not the maths', fine, true);
  }
}

console.log(fails ? `\n${fails} FAILED\n` : '\nall claims hold\n');
process.exit(fails ? 1 : 0);
