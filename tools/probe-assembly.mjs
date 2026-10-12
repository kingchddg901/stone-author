// WHICH PIECE FILLS WHICH SLOT.
//
// A floor is cut and then assembled, and those are two steps. Until the plan existed only the first
// did: a tile sampled the slab at its own position, so where a piece came from and where it ended up
// were the same number and there was nothing to permute. Shuffled faked variety by jittering the
// sample, which is noise rather than an assembly order.
//
// The painter draws the slab at -shift, so a slot at frame position f shows board content at f+shift,
// and the mapping is shift += pieceCentre - slotCentre. GUIDE returns the slot's own centre, so the
// delta is zero and that path is untouched - which is the claim this file exists to pin, because a
// refactor that quietly moves the default is worse than no refactor.
//
// THE GATE THAT MATTERS: when the floor is the size of the board, every piece is cut at the slot it
// fills, so stack order and guide order are the same floor. If that is ever not true, the mapping has
// an off-by-one and every other mode is built on it.
//
//   node tools/probe-assembly.mjs
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
const BODY = liftFn('assemblyPlan');
const IN = 96, H = 0.625;                                  // an 8 x 5 ft slab, as the app has it
const make = (body = BODY) => new Function('IN', 'H', 'inFr', body + '; return assemblyPlan;')(
  IN, H, v => v / IN);

// A grid of pieces in inches from the slab centre. cols x rows covers the board exactly when
// cols*w == IN and rows*h == IN*H.
// Each (pi, c, r) gets its OWN centre. The first version gave every pi the same one, so looking up
// "which piece was handed over" by position always found pi 0 and could not tell the shapes apart —
// the compatibility claim and its own ablation then returned the identical number, which is the tell
// that a test is measuring nothing.
function grid(cols, rows, nPi = 1, scale = 1) {
  const w = IN / cols, h = (IN * H) / rows, out = [];
  for (let r = 0; r < rows * scale; r++) for (let c = 0; c < cols * scale; c++) for (let p = 0; p < nPi; p++) {
    out.push({ key: `${p}:${c}:${r}`, pi: p,
               ctr: [-IN / 2 + (c + (p + 0.5) / nPi) * w, -(IN * H) / 2 + (r + 0.5) * h] });
  }
  return out;
}

let fails = 0;
const claim = (name, ok, extra = '') => { if (!ok) fails++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${extra}`); };

console.log('\nguide is the absent case, by construction');
claim('the plan is only built for stack', /T\.assembly === 'stack'\) \? assemblyPlan\(inst\) : null/.test(SRC));
claim('and only applied when it exists', /else if \(plan\) \{ const d = plan\.get\(t\.key\);/.test(SRC));

console.log('\na floor the size of the board: stack IS guide');
{
  const plan = make()(grid(8, 5));
  const deltas = [...plan.values()];
  claim(`every delta is zero (${deltas.length} slots)`,
        deltas.length === 40 && deltas.every(([x, y]) => Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12));
}

console.log('\na floor larger than the board: pieces repeat, in order');
{
  const slots = grid(8, 5, 1, 2);                          // 16 x 10 slots over an 8 x 5 board
  const plan = make()(slots);
  const moved = [...plan.values()].filter(([x, y]) => Math.abs(x) > 1e-12 || Math.abs(y) > 1e-12);
  claim(`most slots are fed from elsewhere`, moved.length > 0 && moved.length < plan.size,
        `  — ${moved.length} of ${plan.size} moved`);
  claim('every slot is assigned', plan.size === slots.length);
}

// The shapes must appear in UNEQUAL numbers or this proves nothing: with a symmetric interleaved
// grid, pooling them preserves the alternation and slot i still happens to meet its own kind. Here
// the second shape exists only in even columns, so a pooled order misaligns immediately.
// ...and ONE on-board piece is removed, because an even lopsidedness is still periodic: the shape
// pattern repeats every 3 entries and the on-board count was a multiple of 3, so a pooled order
// realigned exactly and the ablation came back clean on code that was genuinely pooling them.
const lopsided = (scale = 2) => grid(8, 5, 2, scale)
  .filter(s => s.pi === 0 || (+s.key.split(':')[1] % 2 === 0))
  .filter(s => s.key !== '1:2:1');

console.log('\ncompatibility: a shape is only ever handed its own kind');
{
  const slots = lopsided();
  const plan = make()(slots);
  const byKey = new Map(slots.map(s => [s.key, s]));
  // the piece a slot was given is the one whose centre is slotCentre + delta*IN
  let wrong = 0;
  for (const [k, d] of plan) {
    const s = byKey.get(k), px = s.ctr[0] + d[0] * IN, py = s.ctr[1] + d[1] * IN;
    const got = slots.find(t => Math.abs(t.ctr[0] - px) < 1e-6 && Math.abs(t.ctr[1] - py) < 1e-6);
    if (got && got.pi !== s.pi) wrong++;
  }
  claim('no slot received the other shape', wrong === 0, wrong ? `  — ${wrong} did` : '');
}

console.log('\na shape with nothing of its kind on the board is left alone');
{
  const slots = grid(8, 5).map(s => ({ ...s, pi: 1, ctr: [s.ctr[0] + IN * 3, s.ctr[1]] }));
  const plan = make()(slots);
  claim('no assignment invented', plan.size === 0);
}

// ABLATION: drop the per-shape grouping and require the compatibility claim to notice.
console.log('\nablation: shapes pooled together');
{
  const flat = BODY.replace('byPi.get(t.pi)', 'byPi.get(0)').replace('byPi.set(t.pi,', 'byPi.set(0,');
  if (flat === BODY) { claim('could not ablate the grouping - probe is stale', false); }
  else {
    const slots = lopsided();
    const plan = make(flat)(slots);
    const byKey = new Map(slots.map(s => [s.key, s]));
    let wrong = 0;
    for (const [k, d] of plan) {
      const s = byKey.get(k), px = s.ctr[0] + d[0] * IN, py = s.ctr[1] + d[1] * IN;
      const got = slots.find(t => Math.abs(t.ctr[0] - px) < 1e-6 && Math.abs(t.ctr[1] - py) < 1e-6);
      if (got && got.pi !== s.pi) wrong++;
    }
    claim('shapes now get handed the wrong kind', wrong > 0, `  — ${wrong} slots`);
  }
}

console.log(fails ? `\n${fails} FAILED\n` : '\nall claims hold\n');
process.exit(fails ? 1 : 0);
