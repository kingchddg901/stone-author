/**
 * What a "slot" is, drawn, for the two rosette patterns.
 *
 * The selector assigns a section per slot and the rule is that no slot inside one motif may repeat.
 * That makes the slot vocabulary the whole design, and it is not the same for both patterns:
 *
 *   OCTAGON  cell = one octagon + one square at its corner, square lattice. The four squares around
 *            any octagon sit at cells (m,n), (m-1,n), (m,n-1), (m-1,n-1) - all four parities - so
 *            "centre plus four corners" falls straight out of (m mod 2, n mod 2). Five, exactly.
 *
 *   RHOMBUS  cell = three rhombi forming a hexagon. Three orientations and no centre, so five
 *            positions cannot come from the cell alone. Two candidates are drawn here:
 *              by orientation      3 slots, the cell as it is
 *              by orientation+cell 3 slots stepping per cell, so N sections cycle over N cells
 *
 * Colours here are slot identities, not glass. Flat and ugly on purpose: the question is which
 * tiles share an identity, and anything prettier would hide it.
 *
 *   node tools/probe-rosette.mjs [out.png]
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'app', 'stone-author.html'), 'utf8');
function lift(n) {
  const at = SRC.indexOf('function ' + n + '(');
  let d = 0;
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') d++; else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(at, j + 1); }
  }
}
const i0 = SRC.indexOf('const PATTERNS'), j0 = SRC.indexOf('\n  };', i0) + 5;
// cairo needs its CAIRO8 table and cairoCell; versailles is dropped because it is not a rosette
// and its table is long.
const CAIRO = (SRC.match(/const CAIRO8 = [\s\S]*?\n {2}\];/) || [''])[0];
const PATTERNS = new Function(CAIRO + '\n' + lift('circlePoly') + '\n' + lift('cairoCell') + '\n' +
  SRC.slice(i0, j0).replace(/versailles:[\s\S]*?\},\n/, '') +
  '\nreturn PATTERNS;')();

const W = 760, Hh = 300, U = 46;
const INK = [[196, 48, 43], [46, 139, 87], [47, 111, 143], [217, 131, 36], [122, 59, 142],
             [120, 120, 128], [200, 200, 70], [70, 200, 200]];

function inside(poly, x, y) {           // even-odd, which is all a flat fill needs
  let c = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xi, yi] = poly[a], [xj, yj] = poly[b];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// Paint one panel: for every lattice cell near the viewport, draw its polys in their slot colour.
function panel(buf, ox, oy, name, slotOf) {
  const cell = PATTERNS[name](U);
  const { polys, ax, ay } = cell;
  for (let n = -6; n <= 10; n++) for (let m = -6; m <= 22; m++) {
    const tx = m * ax[0] + n * ay[0], ty = m * ax[1] + n * ay[1];
    polys.forEach((p, pi) => {
      const pts = p.map(q => [q[0] + tx + 40, q[1] + ty + Hh / 2]);
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
      const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(Hh - 1, Math.ceil(Math.max(...ys)));
      // A POSITIVE modulo. JavaScript's % keeps the sign of the dividend, so a cell at a
      // negative index indexed straight into the palette and came back undefined.
      const si = slotOf(pi, m, n), c = INK[((si % INK.length) + INK.length) % INK.length];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (!inside(pts, x + 0.5, y + 0.5)) continue;
        const o = ((oy + y) * W + ox + x) * 3;
        buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
      }
    });
  }
}

// THE RULE, for both rosette patterns: a slot is a shape TYPE times a cell PARITY, and the centre
// shape takes one slot of its own. The four around a centre then differ because the cells that
// contribute them differ in parity - which is a fact about the lattice, checked below, not a hope.
const even = v => ((v % 2) + 2) % 2;
const OCT_SLOT = (pi, m, n) => pi === 0 ? 0 : 1 + even(m) * 2 + even(n);
const RHOMBUS_SLOT = (pi, m, n) => pi === 1 ? 0 : 1 + (pi === 0 ? 0 : 1) * 2 + even(m);

const PANELS = [
  ['octagon', 'octagon: centre + four corners by cell parity = FIVE',
   OCT_SLOT],
  ['rhombus', 'rhombus: centre STANDING + four LAID by cell parity = FIVE',
   RHOMBUS_SLOT],
  ['cairo', 'cairo: by pentagon ORIENTATION = FOUR (the cell holds two copies of the motif)',
   (pi) => [0, 1, 2, 3, 2, 3, 0, 1][pi]],
];
const PAD = 26, HT = (Hh + PAD) * PANELS.length;
const buf = Buffer.alloc(W * HT * 3, 24);
PANELS.forEach(([pat, , slotOf], k) => panel(buf, 0, k * (Hh + PAD) + PAD, pat, slotOf));

const raw = Buffer.alloc((W * 3 + 1) * HT);
for (let y = 0; y < HT; y++) { raw[y * (W * 3 + 1)] = 0; buf.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
let TBL = null;
function crc32(b) {
  if (!TBL) { TBL = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TBL[n] = c; } }
  let c = -1; for (let i = 0; i < b.length; i++) c = TBL[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
const ck = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const b = Buffer.concat([Buffer.from(t, 'ascii'), d]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(b) >>> 0); return Buffer.concat([l, b, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(HT, 4); ih[8] = 8; ih[9] = 2;
const out = process.argv[2] || path.join(HERE, '..', 'rosette.png');
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  ck('IHDR', ih), ck('IDAT', zlib.deflateSync(raw)), ck('IEND', Buffer.alloc(0))]));
console.log('wrote', out, W + 'x' + HT);
PANELS.forEach(([, label], k) => console.log('  panel ' + (k + 1) + ': ' + label));

// ===== THE CONSTRAINT, BY ADJACENCY =================================================================
// Not "the cells I think contribute", which is the assumption worth avoiding: build the tiling,
// find who really shares an edge, and count the rosettes that repeat a slot. A wrong rule shows up
// as broken rosettes; a wrong idea of the motif shows up in the neighbour count instead.
const R = (v) => Math.round(v * 1000) / 1000;
function census(name, slotOf, centreIs) {
  const { polys, ax, ay } = PATTERNS[name](U);
  const tiles = [];
  for (let n = -5; n <= 5; n++) for (let m = -5; m <= 5; m++)
    polys.forEach((poly, pi) => tiles.push({ pi, m, n, slot: slotOf(pi, m, n),
      pts: poly.map(q => [R(q[0] + m * ax[0] + n * ay[0]), R(q[1] + m * ax[1] + n * ay[1])]) }));
  // share an EDGE = share two vertices
  const vkey = q => q[0] + ',' + q[1];
  const at = new Map();
  tiles.forEach((t, i) => t.pts.forEach(q => { const k = vkey(q); (at.get(k) || at.set(k, []).get(k)).push(i); }));
  const nbr = tiles.map(() => new Map());
  for (const ids of at.values()) for (const a of ids) for (const b of ids) if (a !== b)
    nbr[a].set(b, (nbr[a].get(b) || 0) + 1);
  let rosettes = 0, broken = 0, counts = {};
  tiles.forEach((t, i) => {
    if (!centreIs(t.pi)) return;
    if (Math.abs(t.m) > 3 || Math.abs(t.n) > 3) return;             // interior only: edges lack neighbours
    // THE ROSETTE IS CENTRE + THE OTHER SHAPE, not centre + everything that touches it. An octagon
    // shares an edge with four squares AND four octagons; counting all eight made the motif nine
    // tiles and of course five slots could not cover it. The centre's own kind is a neighbouring
    // rosette's centre, not part of this one.
    const around = [...nbr[i].entries()].filter(([, c]) => c >= 2)
      .map(([j]) => tiles[j]).filter(q => !centreIs(q.pi));
    counts[around.length] = (counts[around.length] || 0) + 1;
    rosettes++;
    const slots = [t.slot, ...around.map(q => q.slot)];
    if (new Set(slots).size !== slots.length) broken++;
  });
  console.log('  ' + name.padEnd(8) + ' rosettes ' + String(rosettes).padStart(3) +
    '   neighbours per centre ' + JSON.stringify(counts) +
    '   with a repeated slot: ' + broken + (broken ? '   <-- CONSTRAINT BROKEN' : '   (none)'));
  return broken;
}
console.log('\n  NO SLOT MAY REPEAT INSIDE A ROSETTE, checked on who actually touches whom:');
let bad = 0;
bad += census('octagon', OCT_SLOT, pi => pi === 0);
bad += census('rhombus', RHOMBUS_SLOT, pi => pi === 1);

// ===== AND THE SELECTOR ON TOP OF IT ================================================================
// The app's own sectionOf, lifted, so the probe cannot drift from what the floor actually does.
const T = { pattern: null };
const APP_ROSETTE = (SRC.match(/const ROSETTE = \{[\s\S]*?\n {2}\};/) || [''])[0];
// The app's own table, evaluated, so the slot counts here are not a second copy to keep in step.
const PATTERNS_ROSETTE = new Function(
  'const ev = v => ((v % 2) + 2) % 2;\n' + APP_ROSETTE + '\nreturn ROSETTE;')();
const sectionOf = new Function('T', 'PATTERNS',
  'const ev = v => ((v % 2) + 2) % 2;\n' + APP_ROSETTE +
  '\nconst rosetteOf = () => ROSETTE[T.pattern] || null;\n' +
  lift('sectionOf') + '\nreturn sectionOf;')(T, PATTERNS);

console.log('\n  EVERY SECTION REACHABLE, and no rosette repeating one:');
for (const [name, centreIs] of [['octagon', pi => pi === 0], ['rhombus', pi => pi === 1], ['cairo', null]]) {
  T.pattern = name;
  const { polys, ax, ay } = PATTERNS[name](U);
  for (const N of [4, 5, 6, 7, 8]) {
    const used = new Set();
    const tiles = [];
    for (let n = -7; n <= 7; n++) for (let m = -7; m <= 7; m++) polys.forEach((poly, pi) => {
      const sec = sectionOf({ pi, m, n }, N);
      used.add(sec);
      tiles.push({ pi, m, n, sec, pts: poly.map(q => [R(q[0] + m * ax[0] + n * ay[0]), R(q[1] + m * ax[1] + n * ay[1])]) });
    });
    let dup = 0, rose = 0;
    if (centreIs) {
      const at = new Map(), vkey = q => q[0] + ',' + q[1];
      tiles.forEach((t2, i) => t2.pts.forEach(q => { const k2 = vkey(q); (at.get(k2) || at.set(k2, []).get(k2)).push(i); }));
      const nbr = tiles.map(() => new Map());
      for (const ids of at.values()) for (const a of ids) for (const b of ids) if (a !== b) nbr[a].set(b, (nbr[a].get(b) || 0) + 1);
      tiles.forEach((t2, i) => {
        if (!centreIs(t2.pi) || Math.abs(t2.m) > 5 || Math.abs(t2.n) > 5) return;
        const around = [...nbr[i].entries()].filter(([, c]) => c >= 2).map(([j]) => tiles[j]).filter(q => !centreIs(q.pi));
        const secs = [t2.sec, ...around.map(q => q.sec)];
        rose++; if (new Set(secs).size !== secs.length) dup++;
      });
    }
    // BELOW THE SLOT COUNT THE RULE IS UNSATISFIABLE - five slots cannot hold four sections without
    // doubling one - so repeats there are the declared fall-back, not a defect. Expecting them is
    // the difference between a probe that tests the rule and one that tests the easy half of it.
    const slots = (PATTERNS_ROSETTE[name] || {}).slots || 1;
    const shouldHold = N >= slots;
    const allUsed = used.size === N;
    if (!allUsed) bad++;
    if (shouldHold && dup) bad++;
    console.log('    ' + name.padEnd(8) + ' N=' + N + '  reached ' + used.size + '/' + N +
      (allUsed ? '' : '  <-- SECTIONS UNREACHABLE') +
      (centreIs ? '   rosettes ' + rose + ', repeating ' + dup +
        (dup ? (shouldHold ? '  <-- RULE BROKEN' : '   (expected: ' + N + ' < ' + slots + ' slots)') : '') : ''));
  }
}
process.exit(bad ? 1 : 0);
