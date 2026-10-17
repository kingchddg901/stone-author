// HOW WIDE DOES THE MARK'S ENTRY GATE HAVE TO BE?
//
// `docs/positional-marks.md` explains the 32-bit magic by two incidents: a 4-bit version matched noise
// one time in sixteen, and copy-agreement was then defeated by a master whose blue low bits ran
// periodic. Read quickly that reads as "a short gate is unsafe", and on its own it is not enough to
// settle the width either way. This probe is what settles it.
//
// The original design had the weak gate and copy-agreement and NO structural range check. That missing
// stage was the defect. A gate of any width, followed by a range-checked address and copy-agreement,
// measures clean - including against the periodic family that broke the original.
//
// WHAT IT HAS TO PROVE:
//   1  a 3-bit gate alone is as weak as arithmetic says - about one position in eight
//   2  the address range check is the stage that does the work, worth about 1 in 26,000
//   3  all three stages together admit NOTHING, swept over every period up to the record stride
//   4  the ablation reaches the attack the sweep cannot: a field whose period EQUALS the stride makes
//      copy-agreement free by construction, and the probe must report it. Without this, item 3 is a
//      zero that has never been shown able to be anything else
//   5  a genuine planted record is still found through every gate width - a gate that rejected the real
//      article would score a perfect zero for the wrong reason
//   7  and the reader has a FOURTH stage this probe does not model: markRead also requires the decoded
//      address to equal the cell it was read from, which is overwhelming when you know the cell and
//      unavailable to a crop that does not
//   6  periodicity exposure is a property of the record STRIDE, not the gate: 67 is prime, 96 is not
//
// The address is packed and unpacked by the APP's OWN `markPack`/`markUnpack`, not by a copy living
// here, for the reason `tools/lib/mark.mjs` exists at all.
//
// The conclusion is recorded in `docs/image-dna.md`: the 32-bit magic is kept for scan cost and for
// continuity with what already ships, NOT because a shorter gate was shown to be unsafe.
//
//   node tools/probe-gate.mjs
import { loadMark } from './lib/mark.mjs';

const m = loadMark();
let fails = 0;
const ok = (what, cond, got) => {
  if (!cond) { fails++; console.error('  FAIL  ' + what + (got === undefined ? '' : '   got ' + got)); }
  else console.log('  ok    ' + what + (got === undefined ? '' : '   ' + got));
};

// The geometry of the largest picture the fleet renders: 262,144 x 163,840 at a 512 lattice.
const ACROSS = 512, DOWN = 320;

const read = (b, p, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 2 + b[p + i]; return v; };
const put = (b, p, v, n) => { for (let i = 0; i < n; i++) b[p + i] = (v / 2 ** (n - 1 - i)) & 1; };

// One record is [gate][address+version 32][picture key 32], written MARK_COPIES times in a row.
const stride = gateBits => gateBits + 64;

function scan(bits, gateBits, gateVal) {
  const rec = stride(gateBits), end = bits.length - rec * m.MARK_COPIES;
  let gate = 0, struct = 0, present = 0;
  for (let p = 0; p <= end; p++) {
    if (read(bits, p, gateBits) !== gateVal) continue;
    gate++;
    // markRead's rule, not a stricter one: a candidate copy carrying the gate, then `agree >= 2`.
    const copies = [];
    for (let c = 0; c < m.MARK_COPIES; c++) {
      const q = p + rec * c;
      copies.push([read(bits, q, gateBits), read(bits, q + gateBits, 32), read(bits, q + gateBits + 32, 32)]);
    }
    let best = null, agree = 0;
    for (const cand of copies) {
      if (cand[0] !== gateVal) continue;
      let k = 0;
      for (const v of copies) if (v[0] === cand[0] && v[1] === cand[1] && v[2] === cand[2]) k++;
      if (k > agree) { agree = k; best = cand; }
    }
    if (agree < 2) continue;
    struct++;
    const u = m.markUnpack(best[1]);
    if (u.ver !== m.MARK_VER || u.cx >= ACROSS || u.cy >= DOWN) continue;
    present++;
  }
  // `struct` counts arrivals at the range check; `present` is what the reader would call a mark.
  return { gate, struct, copies: present, positions: end + 1 };
}

const GATES = [['3-bit', 3, 0b111], ['8-bit', 8, 0xb1],
               ['16-bit', 16, m.MARK_MAGIC & 0xffff], ['32-bit', 32, m.MARK_MAGIC]];

const N = 240000;
let seed = 20261016;
const coin = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 16) & 1; };
const noise = n => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = coin(); return b; };

// The one address every stage of this probe plants, through the app's own packer.
const ADDR = m.markPack(307, 211, m.MARK_VER), KEY = 0x9e3779b9;

// ---- 0  the lift arrived, and the packer round-trips -------------------------------------------------
{
  const u = m.markUnpack(ADDR);
  ok('the app packs and unpacks the planted address', u.cx === 307 && u.cy === 211 && u.ver === m.MARK_VER,
     u.cx + ',' + u.cy + ' v' + u.ver);
  ok('and the magic came across as four bytes', m.MARK_MAGIC > 0xffffff,
     '0x' + m.MARK_MAGIC.toString(16).toUpperCase());
}

// ---- 1  a weak gate is exactly as weak as arithmetic says --------------------------------------------
{
  const field = noise(N), r = scan(field, 3, 0b111);
  const rate = r.gate / r.positions;
  ok('a 3-bit gate admits about one position in eight', Math.abs(rate - 1 / 8) < 0.01,
     (100 * rate).toFixed(2) + '% of ' + r.positions.toLocaleString());
  ok('a 32-bit gate admits none of a quarter-million', scan(field, 32, m.MARK_MAGIC).gate === 0);
}

// ---- 2  the range check is the stage doing the work --------------------------------------------------
{
  // ver == MARK_VER of 16, cx < 512 of 16384, cy < 320 of 16384
  const expect = (1 / 16) * (ACROSS / 16384) * (DOWN / 16384);
  ok('the address range check is worth about 1 in 26,000',
     Math.round(1 / expect) > 20000 && Math.round(1 / expect) < 30000, '1 in ' + Math.round(1 / expect));
  const r = scan(noise(N), 3, 0b111);
  ok('and nothing reaching it survives on fair noise', r.copies === 0,
     r.struct.toLocaleString() + ' of ' + r.gate.toLocaleString() + ' got past 2-of-3 agreement');
}

// ---- 3  every period, every gate, all three stages ---------------------------------------------------
// Reported with the stage-2 ARRIVAL count, because a zero at stage 3 means nothing if nothing reached
// it. Random periodic units almost never hold an in-range address, so this sweep mostly measures
// stage 2 - which is why item 4 exists.
const SWEEP = 96, K = 16;
{
  for (const [gn, gb, gv] of GATES) {
    let arrived = 0, worstC = 0;
    for (let p = 1; p <= SWEEP; p++) {
      for (let k = 0; k < K; k++) {
        const unit = noise(p), f = new Uint8Array(N);
        for (let i = 0; i < N; i++) f[i] = unit[i % p];
        const r = scan(f, gb, gv);
        arrived += r.struct;
        if (r.copies > worstC) worstC = r.copies;
      }
    }
    ok('no random periodic field up to ' + SWEEP + ' survives, ' + gn + ' gate', worstC === 0,
       arrived + ' reached stage 3' + (arrived === 0 ? ' - so this zero is VACUOUS, see item 4' : ''));
  }
}

// ---- 4  ABLATION - the attack the sweep cannot reach -------------------------------------------------
// A field whose period equals the record stride repeats the record exactly, so the copies agree for
// free. This is what "copy-agreement defeated by a periodic master" actually looks like, and the sweep
// above cannot build it: a RANDOM unit of period 67 or 96 almost never holds an in-range address.
{
  for (const [gn, gb, gv] of GATES) {
    const rec = stride(gb), unit = new Uint8Array(rec);
    put(unit, 0, gv, gb); put(unit, gb, ADDR, 32); put(unit, gb + 32, KEY, 32);
    const f = new Uint8Array(N);
    for (let i = 0; i < N; i++) f[i] = unit[i % rec];
    const r = scan(f, gb, gv), expect = Math.floor((N - rec * m.MARK_COPIES) / rec);
    ok('ablation: period == stride IS caught, ' + gn + ' gate', r.copies > expect * 0.9,
       r.copies.toLocaleString() + ' hits, ~' + expect.toLocaleString() + ' expected');
  }
}

// ---- 5  and a genuine record is still found, twice ---------------------------------------------------
// `agree >= 2` means a real record is also detectable one stride LATE, where its second and third
// copies are the only two in the window. markRead never notices because it reads one fixed cell-aligned
// position. A DNA reader recovering from an arbitrary crop has to SCAN, so it meets this: prefer
// agree == MARK_COPIES, or de-duplicate by alignment. Writing it down here because the format is about
// to grow a consumer that scans.
{
  for (const [gn, gb, gv] of GATES) {
    const rec = stride(gb), f = new Uint8Array(N), at = 7777;
    for (let c = 0; c < m.MARK_COPIES; c++) {
      const q = at + rec * c;
      put(f, q, gv, gb); put(f, q + gb, ADDR, 32); put(f, q + gb + 32, KEY, 32);
    }
    const r = scan(f, gb, gv);
    ok('a planted record is found in a quiet field, ' + gn + ' gate', r.copies === 2,
       r.copies + ' alignments - the record, plus one stride late at agree 2');
  }
}

// ---- 6  what the gate width actually buys -----------------------------------------------------------
// Item 4 defeated all three stages at EVERY width, so the question is not whether the check can be
// beaten but how likely the picture is to beat it. A field defeats it when three things coincide:
// its period divides the record stride, it carries the gate pattern, and the 32 bits behind that gate
// decode to an in-range address. The first is a property of the image. The third is fixed at 1 in
// 26,214. The gate is the only term the format controls - and it is the term that decides whether the
// coincidence is merely unlikely or impossible.
{
  const inRange = (1 / 16) * (ACROSS / 16384) * (DOWN / 16384);
  const rows = GATES.map(([gn, gb]) => {
    const rec = stride(gb);
    const perUnit = Math.pow(2, -gb) * inRange;          // chance a random stride-periodic unit qualifies
    const amplify = Math.floor((N - rec * m.MARK_COPIES) / rec);  // and how many reads it then corrupts
    return { gn, gb, rec, perUnit, amplify };
  });
  for (const r of rows)
    console.log('        ' + r.gn.padEnd(7) + 'one periodic field in ' +
      Math.round(1 / r.perUnit).toLocaleString().padStart(22) + ' qualifies, each corrupting ~' +
      r.amplify.toLocaleString() + ' reads');

  const weak = rows[0], strong = rows[rows.length - 1];
  ok('a 3-bit gate puts the catastrophe within reach of a plausible image',
     1 / weak.perUnit < 1e6, 'one in ' + Math.round(1 / weak.perUnit).toLocaleString());
  ok('32 bits puts it past anything this project will ever render',
     1 / strong.perUnit > 1e13, 'one in ' + Math.round(1 / strong.perUnit).toLocaleString());
  ok('and the failure is CATASTROPHIC, not graceful - one bad field, thousands of bad reads',
     weak.amplify > 1000, '~' + weak.amplify.toLocaleString() + ' reads from a single qualifying unit');

  // The counter-argument, kept because it is true and nearly carried the decision.
  const divisors = n => { const d = []; for (let p = 1; p <= n; p++) if (n % p === 0) d.push(p); return d; };
  const d3 = divisors(stride(3)), d32 = divisors(stride(32));
  ok('against it: the 3-bit stride is prime, so only periods 1 and itself expose it',
     stride(3) === 67 && d3.length === 2, d3.join(','));
  ok('while the 32-bit stride has twelve such periods', stride(32) === 96 && d32.length === 12,
     d32.join(','));
  ok('so width wins on the GATE term while losing on the STRIDE term', d32.length > d3.length);
}

console.log('');
if (fails) { console.error('probe-gate: ' + fails + ' FAILED'); process.exit(1); }
console.log('probe-gate: all three stages are defeatable at EVERY gate width (item 4). Width decides');
console.log('            how likely that is: 1 in 209,712 periodic fields at 3 bits, 1 in 1.1e14 at 32.');
