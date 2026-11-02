// DOES THE RADIAL TABLE SAY WHAT THE TRIG SAID?
//
// fresnel's refraction field is the one lens profile that cannot precompute a row and a column, so
// until 2026-11-01 it ran a sin, a cos and two divides in every pixel: 67 ns/px against reeded's and
// water's 16, which is 181 ms of a 318 ms coat at 2048 and 1.6 hours at 1,048,576. It is radial, and
// radial is one dimension, so `lensTable` tabulates amp*sin(kr)/r and 1 + amp*k*cos(kr) against r and
// the pixel loop reads two entries and interpolates between them.
//
// THAT IS AN APPROXIMATION, AND AN APPROXIMATION IS A CLAIM. Linear interpolation of a sinusoid is
// wrong by at most amp*(k*dr)^2/8, so the app sizes its step from the error it is allowed to make -
// LENS_TAB_ERR, in pixels of displacement. This gate measures what the error ACTUALLY is, against the
// trig the table replaced, at the radii where linear interpolation is worst: the midpoint of a cell,
// and the radii where |sin(kr)| is 1. If the bound were wrong the picture would move in a way no other
// gate here can see, because check-lens-tile compares the table against ITSELF - whole against tiled -
// and a table that is uniformly wrong passes that comparison perfectly.
//
// IT ALSO CHECKS THE FOUR STRUCTURAL CLAIMS, each of which is a defect that would not show up as a
// visible artifact in one render:
//
//   THE STEP IS A FUNCTION OF THE PICTURE and the LENGTH is a function of the caller. Two tiles ask
//   for different lengths because a corner tile reads further from the centre than a middle one; if
//   the step came from the extent instead, each tile would get its own table and the gather would
//   drift at every seam - the quiet half of the defect check-lens-tile was written for.
//
//   THE TABLE IS LONG ENOUGH BY CONSTRUCTION, which is why there is no clamp in the pixel loop. An
//   index past the end reads undefined out of a Float64Array; that is NaN, and NaN into a
//   Uint8ClampedArray is zero, so an overrun is a BLACK pixel rather than an error.
//
//   THE FARTHEST PIXEL IS AT A CORNER, which is what lets applyLens size the length from four
//   hypots instead of the loop. Proved here by enumerating every pixel of a tile, not by restating
//   the formula.
//
//   A VANISHING LENS STILL GETS A FINITE STEP. The overflow is in the budget OVER the amplitude
//   rather than in the amplitude, so it takes a denormal strength to reach - 1e-300 does not do it
//   and 1e-317 does, which is why the first version of this check passed an ablation that had
//   removed the floor entirely.
//
// IT RUNS THE APP'S OWN TEXT, lifted by brace matching, so it cannot pass against a copy of the code.
//
//   node tools/check-lens-table.mjs
//   node tools/check-lens-table.mjs --ablate   four substitutions, each of which must be caught
//
// EACH ABLATION RUNS ALONE, against the whole battery. Applied together they hid each other: a step
// taken from the caller changes the step the bounds check then measures with, so an allocation with
// no guard entries came back inside a table it had made too short to overrun.
//
// THE BUDGET IT GATES WAS WRONG WHEN THIS WAS WRITTEN, which is the only reason to trust it now.
// The step was first sized from the textbook bound for a sinusoid, amp*(k*dr)^2/8; this gate came
// back at 0.00403 px against a 0.004 budget, because what is tabulated is sin(kr)/r rather than
// sin(kr) and the quotient's second derivative carries two more terms. The app now carries the
// 1.01 those terms are worth. A gate that had been written to the measurement would have agreed
// with the code and proved nothing.
import { readFileSync } from 'fs';

const APP = readFileSync('app/stone-author.html', 'utf8');
const ABLATE = process.argv.includes('--ablate');

function bodyOf(name) {
  const at = APP.indexOf('\n  function ' + name + '(');
  if (at < 0) return null;
  let d = 0, i = APP.indexOf('{', at);
  const start = at + 1;
  for (; i < APP.length; i++) {
    if (APP[i] === '{') d++;
    else if (APP[i] === '}') { d--; if (!d) return APP.slice(start, i + 1); }
  }
  return null;
}
const parts = {};
for (const n of ['lensField', 'lensTable']) {
  parts[n] = bodyOf(n);
  if (!parts[n]) { console.error('`' + n + '` is not in the app - the lens no longer has the shape this gate checks'); process.exit(1); }
}
const num = (re, what) => {
  const m = APP.match(re);
  if (!m) { console.error('cannot read ' + what + ' from the app'); process.exit(1); }
  return Number(m[1]);
};
const LENS_TAB_ERR = num(/const LENS_TAB_ERR = ([\d.]+);/, 'LENS_TAB_ERR');
const H = num(/const H = ([\d.]+);\s*\/\/ frame height/, 'the frame aspect H');

// ---- the four ablations, each naming the defect it stands for ----------------------------------
const ABL = [
  // A step sized from a looser budget than the bound is read from. dr goes as sqrt(E), so 4096x the
  // budget is 64x the step and 4096x the error.
  { what: 'a coarser step than the budget allows',
    from: 'Math.sqrt((8 / 1.01) * LENS_TAB_ERR / amp)',
    to: 'Math.sqrt((8 / 1.01) * 4096 * LENS_TAB_ERR / amp)' },
  // The floor that keeps a vanishing lens from asking for an infinite step.
  { what: 'no floor under the step',
    from: 'const dr = Math.min(fw, Math.sqrt(', to: 'const dr = (Math.sqrt(' },
  // The step taken from the caller's extent rather than from the picture - one table per tile.
  { what: 'a step that comes from the caller',
    pre: ['const dr = Math.min', 'let dr = Math.min'],
    from: 'const n = Math.max(8, Math.ceil(rNeed / dr) + 2);',
    to: 'const n = Math.max(8, Math.ceil(rNeed / dr) + 2); dr = rNeed / 512;' },
  // An allocation with no room for the guard entries the lerp reads past the last real one.
  { what: 'a table with no guard entries',
    from: 'const t = new Float64Array((n + 3) * 2);', to: 'const t = new Float64Array((n + 1) * 2);' },
];

const SIZES = [2048, 16384, 65535, 262144, 1048576];
const LENSES = [0.01, 0.22, 0.45, 1];
const PITCHES = [2, 9, 27, 40];

// ---- the whole battery, against one version of the table ---------------------------------------
function runChecks(srcTable, loud) {
  const mk = (G) => new Function('G', 'LENS_TAB_ERR',
    parts.lensField + srcTable + '\nreturn { lensField, lensTable };')(G, LENS_TAB_ERR);
  let bad = 0;
  const say = (m) => { if (loud) console.error('  ' + m); bad++; };
  const log = (m) => { if (loud) console.log('  ' + m); };

  // 1. THE TABLE AGAINST THE TRIG IT REPLACED, sampled where linear interpolation is worst rather
  // than at random. The error over one cell is g''(x)*dr^2/8 for some x inside it, so the midpoint is
  // the worst point of a cell and the worst CELL is the one holding a radius where |sin(kr)| is 1.
  // Both are sampled; a stride across the whole table catches what the derivation did not predict.
  let worstD = 0, worstJ = 0, worstAt = '';
  for (const fw of SIZES) {
    const fh = Math.round(fw * H);
    let sizeD = 0;
    for (const lens of LENSES) for (const pitch of PITCHES) {
      const api = mk({ lens, lensPitch: pitch, lensType: 'fresnel' });
      const L = api.lensField(fw, fh), k = L.k, amp = L.amp;
      const rMax = Math.hypot(L.cx, L.cy) + amp + 2;
      const T = api.lensTable(fw, fh, rMax);
      const look = (r) => {                                // the pixel loop's own two lines
        const fi = r * T.inv, ti = (fi | 0) << 1, fr = fi - (fi | 0), s0 = T.t[ti], j0 = T.t[ti + 1];
        return [s0 + (T.t[ti + 2] - s0) * fr, j0 + (T.t[ti + 3] - j0) * fr];
      };
      const rs = [];
      const stride = Math.max(1, Math.floor(T.n / 3000));
      for (let i = 0; i < T.n; i += stride) rs.push((i + 0.5) * T.dr);
      for (let m = 0; (Math.PI / 2 + m * Math.PI) / k <= rMax && m < 4000; m++) {
        const r = (Math.PI / 2 + m * Math.PI) / k, i = (r * T.inv) | 0;
        rs.push((i + 0.5) * T.dr, r);
      }
      for (const r of rs) {
        if (!(r > 0)) continue;
        const [sr, jac] = look(r);
        // THE DISPLACEMENT, not the tabulated ratio: dx is sr*rx and |rx| <= r, so r*|dsr| is the
        // largest an error in a displacement can be at this radius. That is the number the budget is
        // written in, and the number a gather truncates.
        const dErr = r * Math.abs(sr - amp * Math.sin(r * k) / r);
        const jErr = Math.abs(jac - (1 + amp * k * Math.cos(r * k)));
        if (dErr > sizeD) sizeD = dErr;
        if (dErr > worstD) { worstD = dErr; worstAt = `${fw}px lens ${lens} pitch ${pitch} r ${r.toFixed(1)}`; }
        // amp*k is pi*lens whatever the pitch, so the Jacobian's budget falls out of the same step:
        // pi*lens*(k*dr)^2/8 is k*LENS_TAB_ERR.
        if (jErr / k > worstJ) worstJ = jErr / k;
      }
    }
    log(`${String(fw).padStart(7)}px  worst displacement error ${sizeD.toFixed(5)} px  (budget ${LENS_TAB_ERR})`);
  }
  if (!(worstD <= LENS_TAB_ERR)) say(`the table is out by ${worstD.toFixed(5)} px of displacement, over the ${LENS_TAB_ERR} px budget - at ${worstAt}`);
  else log(`worst over every size, strength and pitch: ${worstD.toFixed(5)} px at ${worstAt}`);
  if (!(worstJ <= LENS_TAB_ERR)) say(`the Jacobian is out by ${worstJ.toFixed(6)}*k, over the ${LENS_TAB_ERR}*k the same step allows`);

  // 2. THE STEP IS THE PICTURE'S, THE LENGTH IS THE CALLER'S.
  {
    const api = mk({ lens: 0.45, lensPitch: 9, lensType: 'fresnel' });
    const fw = 65535, fh = Math.round(fw * H);
    const a = api.lensTable(fw, fh, 4000);
    const aN = a.n, aDr = a.dr, aT = Float64Array.from(a.t);
    api.lensTable.cache = null;
    const b = api.lensTable(fw, fh, 40000);
    if (!(b.n > aN)) say(`a tenfold extent asked for ${b.n} entries against ${aN} - the length is not following the caller`);
    if (b.dr !== aDr) say(`the step moved with the extent: ${aDr} then ${b.dr} - two tiles of one picture would hold different tables`);
    else {
      let off = 0;
      for (let i = 0; i < (aN + 3) * 2; i++) if (b.t[i] !== aT[i]) off++;
      if (off) say(`${off} of ${(aN + 3) * 2} shared entries differ between a short table and a long one`);
      else log(`step ${aDr.toFixed(4)} px held across a 10x extent; ${(aN + 3) * 2} shared entries bit-identical`);
    }
  }

  // 3. LONG ENOUGH BY CONSTRUCTION, so the pixel loop needs no clamp.
  {
    const api = mk({ lens: 1, lensPitch: 2, lensType: 'fresnel' });
    for (const fw of [2048, 65535, 1048576]) {
      api.lensTable.cache = null;
      const rNeed = Math.hypot(fw, Math.round(fw * H));
      const T = api.lensTable(fw, Math.round(fw * H), rNeed);
      const hi = ((rNeed * T.inv) | 0) << 1;               // the highest pair a lookup at rNeed reads
      if (!(hi + 3 < T.t.length)) say(`${fw}px: a lookup at the far corner reads t[${hi + 3}] of ${T.t.length} - undefined, which is a black pixel`);
      else log(`${fw}px: the farthest lookup reads t[${hi + 3}] of ${T.t.length}`);
    }
  }

  // 4. THE FARTHEST PIXEL OF A TILE IS AT ONE OF ITS CORNERS - enumerated, not restated. applyLens
  // sizes the table from four hypots; this walks every pixel of a tile at several placements and asks
  // whether any of them beats all four corners. Distance from a point is convex and a tile is a
  // rectangle, so it cannot - but the formula is four terms written by hand, and a missing one is a
  // table too short only for the tiles in one quadrant. No ablation: the comparison is against an
  // exhaustive enumeration rather than against itself, so there is nothing here to starve.
  {
    const api = mk({ lens: 0.45, lensPitch: 9, lensType: 'fresnel' });
    const L = api.lensField(1024, Math.round(1024 * H)), cx = L.cx, cy = L.cy;
    let worst = 0, over = 0;
    for (const [vx, vy, w, h] of [[0, 0, 97, 61], [500, 300, 97, 61], [-13, -13, 140, 140],
                                  [980, 600, 60, 60], [480, 290, 64, 64], [-50, 300, 120, 50]]) {
      const corner = Math.max(Math.hypot(vx - cx, vy - cy), Math.hypot(vx + w - 1 - cx, vy - cy),
                              Math.hypot(vx - cx, vy + h - 1 - cy), Math.hypot(vx + w - 1 - cx, vy + h - 1 - cy));
      let brute = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const r = Math.hypot(x + vx - cx, y + vy - cy);
        if (r > brute) brute = r;
      }
      if (brute - corner > worst) worst = brute - corner;
      if (brute > corner) { say(`a tile at ${vx},${vy} has a pixel at r ${brute.toFixed(3)}, past the ${corner.toFixed(3)} its corners claim`); over++; }
    }
    if (!over) log(`six tile placements: no pixel beats its own corners (worst overshoot ${worst.toFixed(6)} px)`);
  }

  // 5. A VANISHING LENS STILL GETS A STEP EVERY TILE AGREES ON. An unfloored step is Infinity,
  // sin(Infinity) is NaN, and a NaN channel lands in a Uint8ClampedArray as zero: a black slab from a
  // lens nobody can see. TWO STRENGTHS, because the first choice here did not reach the defect at
  // all. 0 is the obvious one and applyCoat filters it, reaching applyLens only when G.lens > 0 - so
  // it stands for a direct caller rather than a render, and lensTable is a core function now. 1e-317
  // is the one a FILE can carry: the overflow is in the budget divided by the amplitude, not in the
  // amplitude, so 1e-300 is still comfortably finite and a denormal is not.
  for (const lens of [0, 1e-317]) {
    const api = mk({ lens, lensPitch: 27, lensType: 'fresnel' });
    const T = api.lensTable(4096, Math.round(4096 * H), 2600);
    let nan = 0;
    for (let i = 0; i < T.t.length; i++) if (!Number.isFinite(T.t[i])) nan++;
    if (!Number.isFinite(T.dr)) say(`a lens of ${lens} asks for a step of ${T.dr}`);
    else if (nan) say(`a lens of ${lens} puts ${nan} non-finite entries in the table - every one a black pixel`);
    else log(`a lens of ${lens}: step ${T.dr} px, ${T.t.length} finite entries`);
  }
  return bad;
}

// ---- and the app's own call site, which no ablation of the table can speak for ------------------
let bad = 0;
const say = (m) => { console.error('  ' + m); bad++; };
if (!/const rNeed = type === 'fresnel' \? Math\.max\(Math\.hypot/.test(APP))
  say('applyLens no longer sizes the table from Math.max of four hypots - check 4 is then proving a formula the app does not use');
if (!/const LT = type === 'fresnel' \? lensTable\(fw, fh, rNeed\)/.test(APP))
  say('applyLens no longer calls lensTable(fw, fh, rNeed) - this gate would be measuring code nothing runs');
if (!/const sr = s0 \+ \(T\[ti \+ 2\] - s0\) \* fr;/.test(APP))
  say('the fresnel branch no longer interpolates between two table entries - the error this gate bounds is not the error the picture takes');

// ---- the brightness cap, which lensTable's note calls unreachable from the UI --------------------
//
// b = 1 + caus * max(0, 1/max(0.3,|jac|) - 1), capped at 2. The cap needs caus > 3/7, which is
// lens > 1.2245, and the slider stops at 1 - so the clause cannot fire from the UI and only a loaded
// file reaches it, exactly like the step's own floor. That is a claim in a comment, and a claim in a
// comment is what fails, so it is pinned: walk the slider's OWN declared range and evaluate b at the
// extreme of jac. Raise the slider's max past 1.2245 and this goes red, which is the point - the cap
// would then be live and the note beside it stale.
{
  const m = APP.match(/\{ key: 'lens',\s+min: ([\d.]+),\s+max: ([\d.]+),\s+step: ([\d.]+)/);
  if (!m) say('cannot read the lens slider range from the app, so the cap claim cannot be pinned');
  else {
    const lo = Number(m[1]), hi = Number(m[2]), st = Number(m[3]);
    const field = new Function('G', 'LENS_TAB_ERR', parts.lensField + '\nreturn lensField;');
    let worst = 0, at = '';
    for (let lens = lo; lens <= hi + 1e-9; lens += st) {
      const L = field({ lens, lensPitch: 9, lensType: 'fresnel' }, LENS_TAB_ERR)(2048, Math.round(2048 * H));
      const A = L.amp * L.k;                        // pi*lens; jac spans 1-A .. 1+A
      // the smallest |jac| the field reaches, then the clamp's own floor under it
      const jmin = Math.max(0.3, A >= 1 ? 0 : 1 - A);
      const b = 1 + L.caus * Math.max(0, 1 / jmin - 1);
      if (b > worst) { worst = b; at = 'lens ' + lens.toFixed(2); }
    }
    if (!(worst <= 2)) say(`the brightness cap FIRES at ${at}, where b reaches ${worst.toFixed(3)} - it is no longer unreachable from the slider, so lensTable's note beside it is now wrong`);
    else console.log(`  the brightness cap stays unreachable across the slider's ${lo}..${hi}: b peaks at ${worst.toFixed(3)} at ${at}`);
  }
}

// ---- the verdict --------------------------------------------------------------------------------
if (!ABLATE) {
  bad += runChecks(parts.lensTable, true);
  if (bad) { console.error(`check-lens-table: ${bad} problem(s)`); process.exit(1); }
  console.log('check-lens-table: OK');
} else {
  if (runChecks(parts.lensTable, false)) { console.error('check-lens-table: the code fails before anything is ablated - fix that first'); process.exit(1); }
  const missed = [];
  for (const a of ABL) {
    let s = parts.lensTable;
    if (a.pre) s = s.replace(a.pre[0], a.pre[1]);
    if (!s.includes(a.from)) { console.error('ablation target gone: ' + a.what + '\n  ' + a.from); process.exit(1); }
    const n = runChecks(s.replace(a.from, a.to), false);
    if (n) console.log(`  caught (${n} red): ${a.what}`);
    else missed.push(a.what);
  }
  if (missed.length || bad) { for (const m of missed) console.error('  NOT CAUGHT: ' + m); console.error('check-lens-table: an ablation went unnoticed'); process.exit(1); }
  console.log('check-lens-table: OK - every substitution was caught');
}
