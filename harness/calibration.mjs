// Drive the pen calibrator with a SYNTHETIC PEN of known properties and assert it recovers them.
//
// The calibrator's whole job is to measure a hand, so the only test that means anything is one that
// hands it a hand whose answers are known in advance. This dispatches pen events carrying a fabricated
// 480 Hz report rate, a fabricated sustained pressure per phase, a fabricated tilt and a fabricated
// speed, then checks the profile the studio shows the user. Every number below is injected, so a
// disagreement is the studio's, never the pen's.
//
// It exists because of a defect that shipped: the calibrator stamped performance.now() as it processed
// each event. A pointermove carries a whole coalesced batch that the hardware reported milliseconds
// apart, and the batch is processed inside one tick — so the gaps it measured were its own redraw cost.
// A real 480 Hz S Pen read as 3333 Hz (0.3 ms, the cost of one calSeg), and running this harness
// against the build that had the defect reproduces 3333 Hz exactly, from a simulated pen, on a
// different machine. That is the signature of a number that describes the code and not the device —
// and it is why the same figure appeared on two calibration runs that agreed about nothing else.
//
//   node harness/calibration.mjs
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Served over http rather than opened as a file:// URL, because a file:// page has an opaque origin
// where localStorage can throw — and the profile the calibrator saves is the thing under test.
const html = readFileSync(join(root, 'app', 'stone-author.html'));
const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const app = `http://127.0.0.1:${server.address().port}/stone-author.html`;

// What the synthetic pen IS. The studio must report these back.
const PEN = {
  rate: 480,                 // Hz, the S23 Ultra's real figure (8 x 60)
  perFrame: 8,               // samples per coalesced batch, i.e. 480 Hz delivered at 60 fps
  span: 0.84,                // fraction of the canvas each stroke crosses
  // phase order must match CAL_PHASES in the studio: natural, hard, light, laid, quick
  phases: [
    { p: 0.40, tilt: 45, n: 240 },
    { p: 0.90, tilt: 45, n: 240 },
    { p: 0.08, tilt: 45, n: 240 },
    { p: 0.40, tilt: 60, n: 240 },
    { p: 0.40, tilt: 45, n: 60 },   // same path, a quarter of the time
  ],
};
const dur = n => (n - 1) / PEN.rate;                       // seconds a stroke of n samples takes
const WANT = {
  rate: PEN.rate,
  coalesced: PEN.perFrame,                                 // samples per move event
  pressLo: 0.08, pressMid: 0.40, pressHi: 0.90,            // the SUSTAINED level of each phase
  leanRest: 45, leanMax: 60,                               // degrees, as the readout prints them
  speedNatural: PEN.span / dur(240),
  speedQuick: PEN.span / dur(60),
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('page error:', e.message));
// domcontentloaded, not load: the page asks Google Fonts for a face it has a fallback for, and there is
// no reason to make a calibration gate wait on a font — or fail when CI cannot reach the CDN.
await page.goto(app, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#cal-start', { timeout: 15000 });
// Wait for the canvas to actually have a box. Measured immediately after navigation it is 0 x 0, every
// coordinate becomes 0/0, and the run produces a profile that is wrong rather than a run that fails.
await page.waitForFunction(() => {
  const r = document.getElementById('field').getBoundingClientRect();
  return r.width > 100 && r.height > 100;
}, null, { timeout: 15000 });

const got = await page.evaluate(({ PEN }) => {
  try { localStorage.removeItem('stone-author:calib:v1'); } catch (_) { /* storage blocked; the checks below will say so */ }
  const cv = document.getElementById('field');
  const b = cv.getBoundingClientRect();
  if (!b.width || !b.height) return { error: 'the canvas has no size; nothing can be drawn on it' };
  document.getElementById('calib').open = true;
  document.getElementById('cal-start').click();

  const dt = 1000 / PEN.rate;
  const mk = (type, u, ph, t) => {
    const x = b.left + b.width * ((1 - PEN.span) / 2 + PEN.span * u), y = b.top + b.height * 0.5;
    // Press, hold, release — the shape a real stroke has, and the shape that made a plain median lie.
    const f = u < 0.35 ? u / 0.35 : u > 0.65 ? (1 - u) / 0.35 : 1;
    const ev = new PointerEvent(type, {
      pointerId: 7, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true,
      clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1,
      pressure: type === 'pointerup' ? 0 : Math.max(0.001, ph.p * f), tiltX: ph.tilt, tiltY: 0,
    });
    // A synthetic event's timeStamp is its construction time; the pen's clock is the whole point here.
    Object.defineProperty(ev, 'timeStamp', { value: t });
    return ev;
  };

  for (const ph of PEN.phases) {
    for (let s = 0; s < 4; s++) {
      // Anchor every stroke to the real clock. The studio rejects an event timestamp more than 5 s from
      // performance.now() (an old browser's epoch-based timeStamp) and falls back to wall time, so a
      // simulated clock left to run free would be thrown out — by a guard doing exactly its job.
      const t0 = performance.now();
      cv.dispatchEvent(mk('pointerdown', 0, ph, t0));
      let i = 1;
      while (i < ph.n) {
        const batch = [];
        for (let k = 0; k < PEN.perFrame && i < ph.n; k++, i++) batch.push(mk('pointermove', i / (ph.n - 1), ph, t0 + i * dt));
        const lead = batch[batch.length - 1];
        Object.defineProperty(lead, 'getCoalescedEvents', { value: () => batch });
        cv.dispatchEvent(lead);
      }
      cv.dispatchEvent(mk('pointerup', 1, ph, t0 + (ph.n - 1) * dt));
    }
  }

  // The READOUT is the oracle: it is the thing a person reads and believes.
  const dd = [...document.getElementById('cal-out').querySelectorAll('dd')].map(d => d.textContent);
  if (dd.length < 4) return { error: 'no profile was produced; the readout is empty' };
  const nums = s => (s.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const [pLo, pMid, pHi] = nums(dd[0]), [lRest, lMax] = nums(dd[1]);
  const [sNat, sQuick] = nums(dd[2]), [rate, coalesced] = nums(dd[3]);   // "480 Hz x8"
  let stored = null;
  try { stored = Object.values(JSON.parse(localStorage.getItem('stone-author:calib:v1') || '{}'))[0] || null; } catch (_) { /* storage blocked */ }
  return { pLo, pMid, pHi, lRest, lMax, sNat, sQuick, rate, coalesced, v: stored && stored.v, readout: dd };
}, { PEN });

await browser.close();
server.close();

if (got.error) { console.error('calibration harness: ' + got.error); process.exit(1); }

const near = (g, w, tol) => Number.isFinite(g) && Math.abs(g - w) <= tol * Math.abs(w);
const checks = [
  ['report rate (Hz)', got.rate, WANT.rate, near(got.rate, WANT.rate, 0.02)],
  ['samples per move', got.coalesced, WANT.coalesced, near(got.coalesced, WANT.coalesced, 0.02)],
  ['pressure, light', got.pLo, WANT.pressLo, near(got.pLo, WANT.pressLo, 0.08)],
  ['pressure, natural', got.pMid, WANT.pressMid, near(got.pMid, WANT.pressMid, 0.08)],
  ['pressure, hard', got.pHi, WANT.pressHi, near(got.pHi, WANT.pressHi, 0.08)],
  ['grip (deg)', got.lRest, WANT.leanRest, near(got.lRest, WANT.leanRest, 0.03)],
  ['laid over (deg)', got.lMax, WANT.leanMax, near(got.lMax, WANT.leanMax, 0.03)],
  ['speed, natural', got.sNat, WANT.speedNatural, near(got.sNat, WANT.speedNatural, 0.05)],
  ['speed, quick', got.sQuick, WANT.speedQuick, near(got.sQuick, WANT.speedQuick, 0.05)],
];
// A v1 profile was measured against the wrong clock; it must not survive a load as if it were current.
checks.push(['stored profile version', got.v, 2, got.v === 2]);

console.log('check                     got        want');
for (const [name, g, w, ok] of checks)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(22)}  ${(+g).toFixed(3).padStart(9)}  ${(+w).toFixed(3).padStart(9)}`);

const bad = checks.filter(c => !c[3]).length;
console.log('');
console.log(bad ? `Calibration FAILED ${bad} of ${checks.length} checks — the studio does not recover a pen it was handed.`
                : `Calibration: PASS — all ${checks.length} properties of the synthetic pen recovered.`);
process.exit(bad ? 1 : 0);
