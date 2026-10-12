// DOES THE CHEVRON COVER, AT A REAL BOARD'S PROPORTIONS?
//
// Herringbone's two-plank module has no translation lattice at the ratios a floor is actually laid in:
// searched, it tiles at 2:1 through 6:1 and nothing was found at 8:1, 10:1 or the 9.6:1 of a 48 x 5
// plank. That is a property of the pattern, which is why parquet herringbone is sold in fixed ratios.
// Chevron has no such constraint because the ends are mitred, and this is the claim that says so.
//
// THE DETERMINANT IS NOT THE TEST. |det(ax, ay)| = 2Lw holds for EVERY angle and every board here, by
// construction - a*h = L*cos(th) * w/cos(th) = L*w exactly. It proves the cell holds two planks' worth
// of AREA and says nothing about whether they land without gaps. The first version of this check
// argued from the determinant and would have shipped on it.
//
// THE WINDOW IS PART OF THE TEST. A fixed +/-9 lattice window reported gaps for 5x48 at 45 degrees,
// for 5x48 at 30, and for 2x96 - every module whose cell is short against the span being sampled. The
// geometry was right and the probe was wrong, in the direction that rejects correct code. The failures
// all had min 0 and max 1: gaps and never an overlap, which is the signature of a window that does not
// reach rather than of a lattice that does not tile. The window is derived from the module now.
//
//   node tools/probe-chevron.mjs
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');

// LIFT, DO NOT COPY: an edit to the module in the app has to be seen here.
const at = SRC.indexOf('chevron: () => {');
if (at < 0) throw new Error('cannot find the chevron module - probe is stale');
let i = SRC.indexOf('{', SRC.indexOf('=>', at)), d = 0, end = i;
for (;; end++) { if (SRC[end] === '{') d++; else if (SRC[end] === '}' && --d === 0) break; }
const BODY = SRC.slice(i, end + 1);
const build = (w, L, deg) => new Function('plankWidthIn', 'plankLenIn', 'T',
  '"use strict"; return (() => ' + BODY + ')();')(() => w, () => L, { chevAngle: deg });

const inside = (p, x, y) => {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

function cover(m, N = 45) {
  const span = Math.max(Math.hypot(m.ax[0], m.ax[1]), Math.hypot(m.ay[0], m.ay[1])) * 1.4;
  const P = Math.ceil(span / Math.max(1e-9, Math.hypot(m.ax[0], m.ax[1]))) + 2;
  const Q = Math.ceil(span / Math.max(1e-9, Math.hypot(m.ay[0], m.ay[1]))) + 2;
  let bad = 0, min = Infinity, max = 0;
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    const x = -span / 2 + span * (a + 0.3183) / N, y = -span / 2 + span * (b + 0.2718) / N;
    let n = 0;
    for (let p = -P; p <= P; p++) for (let q = -Q; q <= Q; q++) {
      const dx = p * m.ax[0] + q * m.ay[0], dy = p * m.ax[1] + q * m.ay[1];
      for (const poly of m.polys) if (inside(poly, x - dx, y - dy)) n++;
    }
    if (n < min) min = n; if (n > max) max = n; if (n !== 1) bad++;
  }
  return { bad, of: N * N, min, max };
}

let fails = 0;
const claim = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${extra}`);
};

// 5 x 48 is a real plank. 2 x 96 is past anything a floor uses, and is here because the first probe
// failed hardest there and the geometry was fine.
const CASES = [[5, 48, 45], [5, 36, 45], [5, 48, 30], [5, 48, 60], [5, 48, 15], [5, 48, 75],
               [3, 8, 45], [1, 2, 45], [6, 6, 45], [2, 96, 45]];

console.log('\ncoverage: every sample must be inside exactly one plank');
for (const [w, L, deg] of CASES) {
  const m = build(w, L, deg), c = cover(m);
  claim(`${w} x ${L} at ${deg}°  (${(L / w).toFixed(1)}:1)`,
        c.bad === 0, c.bad ? `  — ${c.bad}/${c.of} wrong, min ${c.min}, max ${c.max}` : '');
}

console.log('\nthe cell holds exactly two planks, at every angle');
for (const [w, L, deg] of CASES) {
  const m = build(w, L, deg);
  const det = Math.abs(m.ax[0] * m.ay[1] - m.ax[1] * m.ay[0]);
  claim(`${w} x ${L} at ${deg}°`, Math.abs(det - 2 * L * w) < 1e-6);
}

console.log('\nthe angle is clamped, so a slider cannot produce a degenerate plank');
// undefined is in here because it is the case that actually happened: a T without chevAngle made
// every vertex NaN, the cull rejected all of them, and the floor came back EMPTY with no error.
// The numbers below were already tested and none of them could have caught it.
for (const deg of [-90, 0, 5, 90, 180, undefined, null, NaN]) {
  const m = build(5, 48, deg);
  const det = Math.abs(m.ax[0] * m.ay[1] - m.ax[1] * m.ay[0]);
  claim(`${deg}° still yields a real cell`, det > 1 && isFinite(det));
}

// ABLATION: break the mitre so the two planks no longer share an edge, and require the coverage claim
// to notice. A check that passes on a module that cannot tile is testing nothing.
// It has to be shifted ACROSS the lattice, not along it. The first attempt moved the mirrored plank
// vertically, and ay is purely vertical - so translating the moved plank by every multiple of ay
// covers exactly the set it covered before. The ablation was a no-op by construction and passed while
// proving nothing, which is the failure it exists to catch in the check above it.
console.log('\nablation: the mirrored plank shifted ACROSS the lattice');
{
  const m = build(5, 48, 45);
  const off = m.ax[0] * 0.3;                             // not a multiple of either vector
  m.polys[1] = m.polys[1].map(([x, y]) => [x + off, y]);
  const c = cover(m);
  claim('coverage goes red', c.bad > 0, `  — ${c.bad}/${c.of} wrong, min ${c.min}, max ${c.max}`);
}

console.log(fails ? `\n${fails} FAILED\n` : '\nall claims hold\n');
process.exit(fails ? 1 : 0);
