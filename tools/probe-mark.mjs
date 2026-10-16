// DOES A TILE SAY WHERE IT BELONGS, AND IS A MOVED ONE CAUGHT?
//
// On 2026-10-16 a deliberately broken resume transposed two entries in a real master's tile directory.
// The tile data was untouched - byte for byte, at the same offsets - and only the mapping from index to
// offset had changed. check-same-image called the result IDENTICAL, every light figure agreed to the
// digit, and the per-tile weight check cannot see it at all wherever a render tile is cut into several
// stored ones. A transposition MOVES pixels without altering one of them, so nothing that looks at the
// pixels as a set can tell.
//
// The answer is a tile that carries its own address. These four functions are lifted out of the app by
// text and run as themselves; what they cannot be tested on here is a browser, so everything decidable
// lives on this side.
//
// WHAT IT HAS TO PROVE:
//   1  a stamped cell reads back the address it was given
//   2  the change is at most ONE LEVEL, in blue only, and never above the original
//   3  a tile read at the WRONG place is caught - which is the whole point
//   4  majority survives one corrupted copy, and a three-way split is reported rather than guessed
//   5  the lattice is anchored to the PICTURE: a 512 tile and a 1024 tile carry identical marks at the
//      same absolute pixels, so cross-tiling byte-identity survives
//   6  an edge cell that is part padding is left alone
//
//   node tools/probe-mark.mjs
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');
function liftFn(name) {
  const needle = 'function ' + name + '(';
  const hits = [];
  for (let k = SRC.indexOf(needle); k >= 0; k = SRC.indexOf(needle, k + 1)) hits.push(k);
  if (!hits.length) throw new Error('cannot find ' + name + ' - probe is stale');
  if (hits.length > 1) throw new Error(name + ' is defined ' + hits.length + ' times');
  let i = SRC.indexOf('{', hits[0]), d = 0;
  for (;; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}' && --d === 0) break; }
  return SRC.slice(hits[0], i + 1);
}
// EVERY MARK_ constant, not just the first line. The magic word is on its own line and a lifter that
// took one produced a ReferenceError at the first stamp - the same shape as the declarator bug in
// check-worker-core, where reading one name off a line hid the rest.
const CONST = (SRC.match(/^\s*const MARK_[^\n]*$/gm) || [])
  // NOT the URL flag. A line declaring MARK_ON opens an IIFE, so "every const MARK_ line" swept in an
  // unbalanced fragment and new Function died on end-of-input. Too broad, in the same way the
  // declarator scan in check-worker-core was too narrow - a pattern that nearly matches the right
  // thing is the one that costs an hour.
  .filter(l => l.indexOf("=>") < 0).join("\n");
if (!CONST) throw new Error("cannot find the MARK_ constants - this file is stale");
const NAMES = ['markPack', 'markUnpack', 'markStamp', 'markRead'];
const APP = new Function(CONST + '\n' + NAMES.map(liftFn).join('\n') +
                         '; return {' + NAMES.join(',') + ', MARK_CELL, MARK_BITS, MARK_COPIES, MARK_VER};')();
const { markPack, markUnpack, markStamp, markRead, MARK_CELL, MARK_BITS, MARK_COPIES, MARK_VER } = APP;

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('  ok    ' + name); return; }
  fails++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

// A tile of plausible picture: varied, with some channels pinned at 255 so the ceiling is exercised.
const tile = (store, seed) => {
  const px = new Uint8Array(store * store * 4);
  for (let i = 0; i < px.length; i += 4) {
    const v = (i * 7 + seed) & 0xff;
    px[i] = v; px[i + 1] = (v * 3) & 0xff;
    px[i + 2] = (i % 997 === 0) ? 255 : v;          // a scattering of blown-out blue
    px[i + 3] = 255;
  }
  return px;
};

// ---- 1 and 2: it reads back, and it costs one level of blue ---------------------------------------
{
  const S = 512, before = tile(S, 11), after = before.slice();
  const n = markStamp(after, S, 3, 7, 32768, 20480, 0x8cef9303);
  ok('one 512 tile is one cell', n === 1, String(n));
  const got = markRead(after, S, 3, 7);
  ok('it reads back the address it was given', got.length === 1 && got[0].ok,
     JSON.stringify(got[0] && got[0].got));

  let touched = 0, worst = 0, nonBlue = 0, raised = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    touched++;
    const d = after[i] - before[i];
    if (Math.abs(d) > worst) worst = Math.abs(d);
    if (i % 4 !== 2) nonBlue++;
    if (d > 0 && before[i] === 255) raised++;
  }
  ok('nothing but blue is touched', nonBlue === 0, nonBlue + ' non-blue bytes changed');
  ok('no change is bigger than one level', worst <= 1, 'worst ' + worst);
  ok('nothing at 255 is pushed higher', raised === 0, String(raised));
  ok('the payload fits its pixel budget', touched <= MARK_BITS * MARK_COPIES,
     touched + ' of ' + (S * S) + ' pixels, budget ' + MARK_BITS * MARK_COPIES);
}

// ---- 3: a tile read at the wrong place --------------------------------------------------------------
// The one that matters. A transposed tile is a tile read at an address it does not hold.
{
  const S = 512, a = tile(S, 11), b = tile(S, 11);
  markStamp(a, S, 3, 7, 32768, 20480, 0x8cef9303);
  markStamp(b, S, 9, 2, 32768, 20480, 0x8cef9303);
  ok('each is right where it belongs', markRead(a, S, 3, 7)[0].ok && markRead(b, S, 9, 2)[0].ok);
  // now swap them, exactly as a transposed directory does
  ok('ABLATION a transposed tile is caught', !markRead(a, S, 9, 2)[0].ok && !markRead(b, S, 3, 7)[0].ok);
  const wrong = markRead(a, S, 9, 2)[0];
  ok('and it says WHERE the tile actually came from',
     wrong.got.cx === 3 && wrong.got.cy === 7,
     'reported ' + JSON.stringify(wrong.got));
  // an unmarked tile must not read as a valid address either
  ok('ABLATION an unmarked tile is not mistaken for a placed one', !markRead(tile(S, 11), S, 0, 0)[0].ok);
}

// ---- 4: majority ------------------------------------------------------------------------------------
{
  const S = 512, px = tile(S, 5);
  markStamp(px, S, 1, 1, 32768, 20480, 0x8cef9303);
  const row = MARK_CELL - 1, right = MARK_CELL - 1;
  for (let b = 0; b < MARK_BITS; b++) {            // wreck copy 0 entirely
    const o = (row * S + (right - b)) * 4 + 2;
    px[o] ^= 1;
  }
  ok('one wrecked copy is outvoted', markRead(px, S, 1, 1)[0].ok);
  for (let b = 0; b < MARK_BITS; b++) {            // and now a second, leaving no majority
    const o = (row * S + (right - (MARK_BITS + b))) * 4 + 2;
    px[o] ^= 1;
  }
  ok('ABLATION two wrecked copies are NOT silently accepted', !markRead(px, S, 1, 1)[0].ok);
}

// ---- 5: the lattice belongs to the picture, not the tile --------------------------------------------
// The claim this whole design is arranged around. A 1024 tile holds four cells; the cell at its top-left
// must carry the same address, in the same absolute pixels, as a 512 tile covering that same ground.
{
  const W = 32768, H = 20480;
  const small = tile(512, 3);
  markStamp(small, 512, 2, 4, W, H, 0x8cef9303);               // 512 tile at grid (2,4) == cell (2,4)
  const big = tile(1024, 3);
  const nb = markStamp(big, 1024, 1, 2, W, H, 0x8cef9303);     // 1024 tile at grid (1,2) == cells (2..3, 4..5)
  ok('a 1024 tile carries four cells', nb === 4, String(nb));
  const sRow = 511, bRow = 511;                    // cell (2,4) is the top-left quarter of that 1024
  let same = true;
  for (let b = 0; b < MARK_BITS * MARK_COPIES; b++) {
    const s = small[(sRow * 512 + (511 - b)) * 4 + 2] & 1;
    const l = big[(bRow * 1024 + (511 - b)) * 4 + 2] & 1;
    if (s !== l) { same = false; break; }
  }
  ok('the same cell carries the same bits at either tile size', same);
  ok('and the big tile knows all four addresses',
     markRead(big, 1024, 1, 2).every(c => c.ok), JSON.stringify(markRead(big, 1024, 1, 2).map(c => c.got)));
}

// ---- 6: padding is not the picture -------------------------------------------------------------------
{
  const S = 512;
  const px = tile(S, 2);
  // a picture 1000 wide: the cell at grid x=1 runs past the edge and is part padding
  const n = markStamp(px, S, 1, 0, 1000, 20480, 0x8cef9303);
  ok('an edge cell that is part padding is left unmarked', n === 0, String(n));
  const whole = markStamp(tile(S, 2), S, 0, 0, 1000, 20480, 0x8cef9303);
  ok('and a cell wholly inside the picture still is marked', whole === 1, String(whole));
}

// ---- 7: the key, which is what the extra word bought -----------------------------------------------
// A tile's address says WHERE it sits. The key says WHICH PICTURE it sits in - renderSig, the same value
// every master publishes as `inputs` and every sidecar tabulates - so a fragment with no file around it
// is still attributable. A lookup key, not a proof: renderSig is a 32-bit CRC and was seen on 2026-10-15
// to match across two masters that were not the same picture. The address beside it is the proof.
{
  const S = 512, px = tile(S, 13);
  markStamp(px, S, 5, 6, 32768, 20480, 0x8cef9303);
  const got = markRead(px, S, 5, 6)[0];
  ok('a tile carries the picture it belongs to', got.got.sig === '8cef9303', 'read ' + got.got.sig);
  ok('and its own version', got.got.ver === MARK_VER, String(got.got.ver));
  // ABLATION: a different picture writes a different key, at the same address.
  const other = tile(S, 13);
  markStamp(other, S, 5, 6, 32768, 20480, 0xd819c613);
  ok('ABLATION another picture carries another key',
     markRead(other, S, 5, 6)[0].got.sig === 'd819c613');
  ok('and the address alone cannot tell them apart - which is why both are written',
     markRead(other, S, 5, 6)[0].ok && got.ok);
}

console.log('');
if (fails) { console.error('probe-mark: ' + fails + ' FAILED'); process.exit(1); }
console.log('probe-mark: a tile carries its address, a moved one is caught, and the lattice');
console.log('            belongs to the picture — so a 512 and a 1024 render still agree.');
