/**
 * A TILE, TAKEN AS A SECTION: the geometry, pinned.
 *
 * Snagging a tile keeps a WINDOW on the slab - where that one piece was cut from - so that every
 * tile later laid from it shows the same piece, painted from its own coordinates at about nine
 * times the detail rather than cropped out of a shared band.
 *
 * Three functions carry that, and each one has a way to be quietly wrong:
 *
 *   cutBoxFromInstance   the box must be the SLAB position, not the floor position (poly - shift),
 *                        and it must lie inside the slab - a window render cannot wrap, and outside
 *                        the slab rectangle the painter has nothing to say, so an unclamped box
 *                        comes back as bare background.
 *   cutScale             the painted box must FIT the band it is given, however long and thin.
 *   coverSrc             a cut can land on a tile of another shape, so it must crop, never stretch,
 *                        and never sample outside the box it has.
 *
 * Every claim here is run against its own ablation: the check is re-run with the fix removed, and
 * a claim whose ablation still passes is reported as decoration rather than a test. A guard that
 * cannot be made to fail is not evidence that anything is guarded.
 *
 *   node tools/probe-cut-section.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'app', 'stone-author.html'), 'utf8');

function lift(n) {
  const at = SRC.indexOf('function ' + n + '(');
  if (at < 0) throw new Error('probe cannot find function ' + n + ' - has it been renamed?');
  let d = 0;
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') d++; else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(at, j + 1); }
  }
  throw new Error('probe cannot read the body of ' + n);
}
// A multi-line `const name = (...) => { ... };` — liftConst only reaches to the end of a line.
const liftArrow = name => {
  const at = SRC.indexOf('const ' + name + ' = ');
  if (at < 0) throw new Error('probe cannot find ' + name + ' - has it been renamed?');
  let d = 0;
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') d++;
    else if (SRC[j] === '}' && !--d) return SRC.slice(at, SRC.indexOf(';', j) + 1);
  }
  throw new Error('probe cannot read the body of ' + name);
};
const liftConst = re => {
  const m = SRC.match(re);
  if (!m) throw new Error('probe cannot find ' + re);
  return m[0];
};

// The app's own geometry, lifted whole, so the probe cannot drift from what the floor does.
const CAIRO = (SRC.match(/const CAIRO8 = [\s\S]*?\n {2}\];/) || [''])[0];
const i0 = SRC.indexOf('const PATTERNS'), j0 = SRC.indexOf('\n  };', i0) + 5;
// versailles delegates to a module defined elsewhere in the file; it is dropped rather than lifted
// because it is not a lattice of its own and the claims below do not turn on it.
const PAT_SRC = SRC.slice(i0, j0).replace(/\n\s*versailles: [^\n]*\n/, '\n');
if (/versailles/.test(PAT_SRC)) throw new Error('probe: the versailles entry is still in - has its shape changed?');

// cutBoxFromInstance / cutScale / coverSrc, and tileInstances to feed them. ABLATE lets one claim
// be re-run with a single piece of the real thing swapped out.
function build(ablate) {
  const body = [
    'const H = 0.625, IN = 8 * 12, inFr = v => v / IN;',
    "const T = { pattern: 'square', sizeIn: 12, groutIn: 0.125, kerfIn: 0.0625, chevAngle: 45 };",
    liftConst(/const polyCentroid = [^\n]*/),
    CAIRO, lift('circlePoly'), lift('cairoCell'), PAT_SRC,
    'const plankInstances = () => [];',
    lift('tileInstances'),
    ablate === 'no-shift'
      ? lift('cutBoxFromInstance').replace('x0 -= t.shift[0]; x1 -= t.shift[0]; y0 -= t.shift[1]; y1 -= t.shift[1];', '')
      : ablate === 'no-clamp'
        ? lift('cutBoxFromInstance').replace('Math.min(wrap(x0, 1), 1 - w), Math.min(wrap(y0, H), H - h)', 'wrap(x0, 1), wrap(y0, H)')
        : lift('cutBoxFromInstance'),
    ablate === 'scale-max' ? liftConst(/const cutScale = [^\n]*/).replace('Math.min', 'Math.max')
                           : liftConst(/const cutScale = [^\n]*/),
    ablate === 'cover-max' ? lift('coverSrc').replace('Math.min(sw / dw, sh / dh)', 'Math.max(sw / dw, sh / dh)')
                           : lift('coverSrc'),
    // floorPitch decides how far apart the floor lays what the slab gave it, and tileInstances asks it.
    // LIFTED, not restated: the pitch is the whole relationship between kerf, grout and where a piece
    // lands, and a probe carrying its own copy would agree with itself while the floor moved.
    liftArrow('floorPitch'),
    // The board-driven patterns ask the floor for its plank, which the app computes from WOOD. The
    // probe is about CUT GEOMETRY, not about wood, so a fixed plank is enough - and leaving them out
    // is how chevron went in and left this file throwing a ReferenceError instead of making a claim.
    'const plankWidthIn = () => 7.5, plankLenIn = () => 36;',
    'return { H, T, PATTERNS, tileInstances, cutBoxFromInstance, cutScale, coverSrc };',
  ].join('\n');
  return new Function(body)();
}

const A = build(null);
const PATS = Object.keys(A.PATTERNS).filter(k => k !== 'plank');
const SIZES = [6, 12, 14, 24, 36];
const bbox = poly => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of poly) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
  return [x0, y0, x1, y1];
};
const sweep = (E, fn) => {                                // every pattern, every size, every tile
  for (const p of PATS) for (const s of SIZES) {
    E.T.pattern = p; E.T.sizeIn = s;
    for (const t of E.tileInstances()) fn(t, p, s, E);
  }
};

let bad = 0;
const rows = [];
// Run one claim on the real build and on its ablation. The ablation MUST fail; if it passes, the
// claim is reported as decoration, because nothing about it is being held in place.
function claim(title, ablation, run) {
  const real = run(A), abl = run(build(ablation));
  const ok = real.n === 0, bites = abl.n > 0;
  if (!ok || !bites) bad++;
  rows.push('  ' + (ok ? (bites ? 'ok  ' : 'DECO') : 'FAIL') + '  ' + title.padEnd(52) +
    (ok ? 'clean of ' + real.of : real.n + ' of ' + real.of + ' BAD  e.g. ' + real.eg) +
    '   | ablated(' + ablation + '): ' + (bites ? abl.n + ' caught' : 'STILL CLEAN - the check cannot fail'));
}

console.log('A TILE, TAKEN AS A SECTION - ' + PATS.length + ' patterns x ' + SIZES.length + ' sizes\n');

claim('the box is the SLAB position, not the floor position', 'no-shift', E => {
  let n = 0, of = 0, eg = '';
  sweep(E, (t, p, s) => {
    const b = bbox(t.poly), want = [b[0] - t.shift[0], b[1] - t.shift[1]];
    // only where the tile's own window already sits inside the slab, so no wrap or clamp applies
    if (want[0] < 0 || want[1] < 0 || want[0] + (b[2] - b[0]) > 1 || want[1] + (b[3] - b[1]) > E.H) return;
    of++;
    const box = E.cutBoxFromInstance(t);
    if (Math.abs(box[0] - want[0]) > 1e-12 || Math.abs(box[1] - want[1]) > 1e-12) {
      n++; if (!eg) eg = p + '@' + s + '" got ' + box[0].toFixed(4) + ',' + box[1].toFixed(4) + ' want ' + want[0].toFixed(4) + ',' + want[1].toFixed(4);
    }
  });
  return { n, of, eg };
});

claim('every box lies inside the slab', 'no-clamp', E => {
  let n = 0, of = 0, eg = '';
  sweep(E, (t, p, s) => {
    of++;
    const [x, y, w, h] = E.cutBoxFromInstance(t);
    if (x < -1e-12 || y < -1e-12 || x + w > 1 + 1e-12 || y + h > E.H + 1e-12) {
      n++; if (!eg) eg = p + '@' + s + '" box ' + [x, y, w, h].map(v => v.toFixed(4)).join(',');
    }
  });
  return { n, of, eg };
});

claim('the painted box fits its band', 'scale-max', E => {
  let n = 0, of = 0, eg = '';
  const cw = 700, bandPx = cw * E.H;
  sweep(E, (t, p, s) => {
    of++;
    const box = E.cutBoxFromInstance(t), kz = E.cutScale(cw, bandPx, box);
    if (box[2] * kz > cw + 1e-9 || box[3] * kz > bandPx + 1e-9) {
      n++; if (!eg) eg = p + '@' + s + '" painted ' + (box[2] * kz).toFixed(1) + 'x' + (box[3] * kz).toFixed(1) + ' into ' + cw + 'x' + bandPx.toFixed(0);
    }
  });
  return { n, of, eg };
});

claim('cover crops, never samples outside the cut', 'cover-max', E => {
  let n = 0, of = 0, eg = '';
  const cw = 700, bandPx = cw * E.H;
  // every cut box against every DESTINATION tile shape, including the mismatched ones
  const dests = [];
  for (const p of PATS) { E.T.pattern = p; E.T.sizeIn = 14;
    for (const t of E.tileInstances().slice(0, 40)) { const b = bbox(t.poly); dests.push([b[2] - b[0], b[3] - b[1]]); } }
  sweep(E, (t) => {
    const box = E.cutBoxFromInstance(t), kz = E.cutScale(cw, bandPx, box);
    const sw = box[2] * kz, sh = box[3] * kz;
    for (const [dw, dh] of dests) {
      of++;
      const [ox, oy, w, h] = E.coverSrc(sw, sh, dw, dh);
      if (ox < -1e-9 || oy < -1e-9 || w > sw + 1e-9 || h > sh + 1e-9) {
        n++; if (!eg) eg = 'src ' + sw.toFixed(1) + 'x' + sh.toFixed(1) + ' -> ' + w.toFixed(1) + 'x' + h.toFixed(1) + ' at ' + ox.toFixed(1) + ',' + oy.toFixed(1);
      }
      if (Math.abs(w / h - dw / dh) > 1e-9) { n++; if (!eg) eg = 'aspect drifted: ' + (w / h).toFixed(6) + ' vs ' + (dw / dh).toFixed(6); }
    }
  });
  return { n, of, eg };
});

// WHAT THE CUT IS FOR. Laid on its own shape it must use the WHOLE box with no offset - any crop
// there would be losing part of the piece that was pointed at. The ablation nudges the destination
// aspect by one part in a hundred, which must start a crop.
claim('laid on its own shape, the whole cut is used', 'nudge-dest', E => {
  let n = 0, of = 0, eg = '';
  const cw = 700, bandPx = cw * E.H, nudge = E === A ? 1 : 1.01;
  sweep(E, (t, p, s) => {
    const box = E.cutBoxFromInstance(t), kz = E.cutScale(cw, bandPx, box);
    const sw = box[2] * kz, sh = box[3] * kz;
    of++;
    const [ox, oy, w, h] = E.coverSrc(sw, sh, box[2], box[3] * nudge);
    if (ox > 1e-9 || oy > 1e-9 || Math.abs(w - sw) > 1e-9 || Math.abs(h - sh) > 1e-9) {
      n++; if (!eg) eg = p + '@' + s + '" offset ' + ox.toFixed(3) + ',' + oy.toFixed(3);
    }
  });
  return { n, of, eg };
});
// `nudge-dest` is not a build swap, so `build()` returns the real thing and the nudge is applied
// above by identity: E === A is the real run, anything else the ablated one.

// THE PROPERTY THE WHOLE FEATURE IS, stated on geometry rather than pixels: for one tile shape, a
// cut's source rectangle is the SAME for every lattice position, which is what makes every tile
// show the same piece - while the ordinary path's shift is different for every one of them, which
// is what makes the floor walk across the slab. No ablation: the second half IS the contrast.
// The ablation is the ORDINARY path: fold the tile's own shift into the source offset, which is
// exactly what makes an uncut floor walk across the slab, and the check must catch every pattern.
// Tolerance is 1e-6 of a ~700 px source rectangle, because two tiles of the same shape differ in
// their widths at float noise and a stricter comparison measures that instead of the claim.
{
  const cw = 700, bandPx = cw * A.H, TOL = 1e-6;
  for (const p of PATS) {
    A.T.pattern = p; A.T.sizeIn = 14;
    const inst = A.tileInstances();
    // A pattern that lays NO tile is a finding, not a stack trace. This file crashed on it rather than
    // naming it, which is how a broken pattern would reach a user as a TypeError in the console.
    if (!inst.length) { console.log(`  FAIL  ${p}: lays no tile at all`); fails++; continue; }
    const cut = A.cutBoxFromInstance(inst[(inst.length / 2) | 0]);
    const kz = A.cutScale(cw, bandPx, cut), sw = cut[2] * kz, sh = cut[3] * kz;
    const run = withShift => {
      const byShape = new Map(); let varies = 0;
      for (const t of inst) {
        const b = bbox(t.poly), dw = b[2] - b[0], dh = b[3] - b[1];
        const key = Math.round(dw * 1e6) + 'x' + Math.round(dh * 1e6);
        const src = A.coverSrc(sw, sh, dw, dh);
        if (withShift) { src[0] += t.shift[0] * kz; src[1] += t.shift[1] * kz; }
        if (!byShape.has(key)) byShape.set(key, src);
        else if (byShape.get(key).some((v, i) => Math.abs(v - src[i]) > TOL)) varies++;
      }
      return { shapes: byShape.size, varies };
    };
    const real = run(false), abl = run(true);
    // WHERE THE ABLATION CANNOT APPLY, AND WHY. An overlapping pattern is never pushed apart
    // (noSpread), so its shift is identically zero and every tile ALREADY samples one position -
    // there is nothing to fold back in. That is a property of the pattern, so it is asserted
    // rather than waved through: all-zero shifts in a pattern that DOES spread would be the
    // interesting failure, and it still fails here.
    const flat = inst.every(t => t.shift[0] === 0 && t.shift[1] === 0);
    const na = flat && !!A.PATTERNS[p](14).overlap;
    const ok = real.varies === 0, bites = abl.varies > 0 || na;
    if (!ok || !bites) bad++;
    rows.push('  ' + (ok ? (bites ? (na ? 'n/a ' : 'ok  ') : 'DECO') : 'FAIL') + '  ' + ('one piece, every position: ' + p).padEnd(52) +
      (ok ? real.shapes + ' tile shape(s) -> ' + real.shapes + ' source rect(s), position-free'
          : real.varies + ' tiles took a different piece') +
      '   | ' + (na ? 'overlapping pattern: shift is already zero everywhere, so it cannot be ablated'
                   : 'ablated(fold the shift back in): ' + (bites ? abl.varies + ' caught' : 'STILL CLEAN')));
  }
}

console.log(rows.join('\n'));
console.log('\n' + (bad ? bad + ' PROBLEM(S)' : 'all claims hold, and every ablation broke them'));
process.exit(bad ? 1 : 0);
