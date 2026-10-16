// DOES EVERY TILE SIT WHERE IT SAYS IT DOES?
//
// A tile that moves takes its pixels with it and nothing in the picture objects. On 2026-10-16 a
// deliberately broken resume transposed two entries in a real master's tile directory, and the result
// survived a byte comparison of the stored region, every light figure, and the per-tile weight check.
// A transposition MOVES pixels without altering one of them, so nothing that reads the pixels as a set
// can tell. A master rendered with ?mark=1 carries each cell's own address in the blue low bit of its
// bottom row, and this reads them back.
//
// `markRead` is LIFTED OUT OF THE APP by text and run as itself - the same function that wrote the
// marks, not a second implementation of the format. A reader that agreed with a copy of the writer
// would prove the copy and nothing else.
//
//   node tools/check-placement.mjs <master.tif> [--all]
//
// Samples 40 tiles by default, which is seconds; --all reads every one, which on a 262,144 master is
// 163,840 inflations and some minutes. A sample is evidence and the whole file is proof, and the
// difference matters here: a transposition is TWO tiles out of thousands.
import { openSync, readSync, closeSync, readFileSync } from 'fs';
import { inflateSync } from 'zlib';

const APP = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');
function liftFn(name) {
  const needle = 'function ' + name + '(';
  const hits = [];
  for (let k = APP.indexOf(needle); k >= 0; k = APP.indexOf(needle, k + 1)) hits.push(k);
  if (!hits.length) throw new Error('cannot find ' + name + ' - this tool is stale');
  if (hits.length > 1) throw new Error(name + ' is defined ' + hits.length + ' times');
  let i = APP.indexOf('{', hits[0]), d = 0;
  for (;; i++) { if (APP[i] === '{') d++; else if (APP[i] === '}' && --d === 0) break; }
  return APP.slice(hits[0], i + 1);
}
// EVERY MARK_ constant, not just the first line. The magic word is on its own line and a lifter that
// took one produced a ReferenceError at the first stamp - the same shape as the declarator bug in
// check-worker-core, where reading one name off a line hid the rest.
const CONST = (APP.match(/^\s*const MARK_[^\n]*$/gm) || [])
  // NOT the URL flag. A line declaring MARK_ON opens an IIFE, so "every const MARK_ line" swept in an
  // unbalanced fragment and new Function died on end-of-input. Too broad, in the same way the
  // declarator scan in check-worker-core was too narrow - a pattern that nearly matches the right
  // thing is the one that costs an hour.
  .filter(l => l.indexOf("=>") < 0).join("\n");
if (!CONST) throw new Error("cannot find the MARK_ constants - this file is stale");
const { markRead, MARK_VER } = new Function(
  CONST + '\n' + ['markUnpack', 'markRead'].map(liftFn).join('\n') +
  '; return { markRead, MARK_VER };')();

const args = process.argv.slice(2);
const path = args.find(a => !a.startsWith('--'));
const ALL = args.includes('--all');
if (!path) { console.error('usage: node tools/check-placement.mjs <master.tif> [--all]'); process.exit(2); }

const fd = openSync(path, 'r');
const at = (o, l) => { const b = Buffer.alloc(l); readSync(fd, b, 0, l, o); return b; };
const u64 = (b, p) => b.readUInt32LE(p) + b.readUInt32LE(p + 4) * 4294967296;
const ifd = u64(at(0, 16), 8), n = u64(at(ifd, 8), 0), ent = at(ifd + 8, n * 20);
const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 16: 8, 17: 8, 18: 8 }, tags = {};
for (let i = 0; i < n; i++) {
  const e = i * 20, tag = ent.readUInt16LE(e), ty = ent.readUInt16LE(e + 2), c = u64(ent, e + 4);
  const by = (SZ[ty] || 0) * c;
  const raw = by <= 8 ? ent.subarray(e + 12, e + 12 + by) : at(u64(ent, e + 12), by);
  const v = [];
  for (let k = 0; k < c; k++)
    v.push(ty === 16 ? u64(raw, k * 8) : ty === 4 ? raw.readUInt32LE(k * 4)
         : ty === 3 ? raw.readUInt16LE(k * 2) : raw[k]);
  tags[tag] = v;
}
const W = tags[256][0], H = tags[257][0], TW = tags[322][0], spp = tags[277][0];
const offs = tags[324], cnts = tags[325], cols = Math.ceil(W / TW), rows = Math.ceil(H / TW);
console.log(`${W.toLocaleString()} x ${H.toLocaleString()}, tiled ${TW}, ${offs.length.toLocaleString()} tiles`);

const want = ALL ? offs.length : Math.min(40, offs.length);
const step = Math.max(1, Math.floor(offs.length / want));
let checked = 0, cells = 0, bad = [], unmarked = 0;
for (let i = 0; i < offs.length; i += step) {
  const px = inflateSync(at(offs[i], cnts[i]));
  const tx = i % cols, ty = (i / cols) | 0;
  const got = markRead(px, TW, tx, ty);
  checked++;
  for (const c of got) {
    cells++;
    if (c.ok) continue;
    // A cell whose version is not ours is not a WRONG address, it is no address: an unmarked master,
    // or one written by a scheme this build does not know. Said apart, because treating "no mark" as
    // "moved" would condemn every master rendered before marking existed.
    if (!c.present || c.got.ver !== MARK_VER) { unmarked++; continue; }
    if (bad.length < 8) bad.push({ at: c.want, says: { cx: c.got.cx, cy: c.got.cy }, sig: c.got.sig });
  }
}
closeSync(fd);

const moved = cells - unmarked - (cells - unmarked - bad.length) === 0 ? bad.length : bad.length;
console.log(`  checked ${checked.toLocaleString()} tile(s), ${cells.toLocaleString()} cell(s)` +
            (ALL ? '' : `   (a sample — --all reads every tile)`));
if (unmarked === cells) {
  console.log(`  no cell carries a mark this build understands: an unmarked master, or another scheme`);
  process.exit(0);
}
if (unmarked) console.log(`  ${unmarked.toLocaleString()} cell(s) carry no readable mark`);
if (!bad.length) {
  const sig = (() => { for (let i = 0; i < offs.length; i += step) {
    const g = markRead(inflateSync(at(offs[i], cnts[i])), TW, i % cols, (i / cols) | 0);
    for (const c of g) if (c.ok) return c.got.sig; } return null; })();
  console.log(`  every cell read sits where it says it does` + (sig ? `, and all of them say picture ${sig}` : ''));
  process.exit(0);
}
console.error(`  ${bad.length}${bad.length === 8 ? '+' : ''} cell(s) DO NOT SIT WHERE THEY SAY THEY DO:`);
for (const b of bad)
  console.error(`    cell (${b.at.cx}, ${b.at.cy}) holds a tile that says it is (${b.says.cx}, ${b.says.cy}) of picture ${b.sig}`);
console.error('  a tile has moved without its address moving with it: this is not the picture it claims');
process.exit(1);
