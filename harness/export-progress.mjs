// An export must say that it is working, for as long as it is working.
//
// A full export blocks the main thread for minutes at the larger widths. It used to report itself with
// two hint() calls in its first milliseconds, and the hint removes itself after 2.6 s — so for the rest
// of the run the page was indistinguishable from a dead one. That is invisible at 1024, where the whole
// export finishes inside the hint's lifetime, and it is the entire experience at 16384.
//
// So this does not check that a message appears. It checks that the message KEEPS CHANGING, that the
// button is held disabled while the work runs, and that both are put back afterwards.
//
// It then checks the other half: that an export which CANNOT finish says so instead of waiting for ever.
//
//   node harness/export-progress.mjs
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'app', 'stone-author.html'));
const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const app = `http://127.0.0.1:${server.address().port}/stone-author.html`;

const WIDTH = '1024';        // the smallest export: if the signal survives here it survives everywhere
const MIN_UPDATES = 3;       // a single message that never changes is the defect this exists to catch

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(app, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#export', { state: 'attached', timeout: 15000 });
await page.waitForFunction(() => {
  const r = document.getElementById('field').getBoundingClientRect();
  return r.width > 100 && r.height > 100;
}, null, { timeout: 15000 });

const got = await page.evaluate(async (WIDTH) => {
  // The export hands the archive to the browser at the end. Neuter the anchor rather than let CI
  // accumulate zip files; everything under test happens before that point.
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {};
  try {
    document.getElementById('filesec').open = true;
    const btn = document.getElementById('export');
    document.getElementById('expres').value = WIDTH;
    const stat = document.getElementById('expstat');
    if (!stat) return { error: 'there is no export status line at all' };

    const seen = [], fills = [];
    let everDisabled = false;
    const iv = setInterval(() => {
      const t = stat.textContent;
      if (t && seen[seen.length - 1] !== t) { seen.push(t); fills.push(document.getElementById('expfill').style.width); }
      if (btn.disabled) everDisabled = true;
    }, 15);
    btn.click();
    // Poll for the end rather than sleeping a fixed time: the container's speed is not ours to assume.
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50));
      if (seen.length && !btn.disabled) break;
    }
    clearInterval(iv);
    return { seen, fills, everDisabled, enabledAfter: !btn.disabled,
             hiddenAfter: document.getElementById('expprog').hidden };
  } finally { HTMLAnchorElement.prototype.click = origClick; }
}, WIDTH);

if (got.error) { await browser.close(); server.close(); console.error('export-progress harness: ' + got.error); process.exit(1); }

const pcts = got.fills.map(w => parseInt(w, 10) || 0);
const rises = pcts.every((v, i) => i === 0 || v >= pcts[i - 1]);
const checks = [
  [`status changed at least ${MIN_UPDATES} times`, got.seen.length, got.seen.length >= MIN_UPDATES],
  ['the bar only ever moves forward', pcts.join(' '), rises],
  ['the bar actually advances', (pcts[pcts.length - 1] || 0) + '%', (pcts[pcts.length - 1] || 0) >= 50],
  ['Export was disabled while it ran', got.everDisabled, got.everDisabled === true],
  ['Export is usable again afterwards', got.enabledAfter, got.enabledAfter === true],
  ['the bar is put away afterwards', got.hiddenAfter, got.hiddenAfter === true],
];

// --- and it must FAIL loudly rather than wait for ever -------------------------------------------
// An encode that cannot happen used to leave a promise unsettled: the worker's onmessage is async, so a
// rejection inside it never reaches onerror, and the no-worker fallback called b.arrayBuffer() on the
// null that toBlob hands back when it cannot encode. Either way no message arrives, the pool's promise
// never settles, and the export sits on "Rendering 1 of 14" for ever with the UI responsive -- which is
// exactly how it presented on a phone at 16384. Forced here at 1024, where memory is not a factor.
const HANG_MS = 15000;
const fails = await page.evaluate(async (HANG_MS) => {
  const btn = document.getElementById('export'), stat = document.getElementById('expstat');
  const realWorker = window.Worker, realToBlob = HTMLCanvasElement.prototype.toBlob, realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {};
  const out = {};
  const run = async (label) => {
    btn.click();
    const t0 = Date.now();
    while (Date.now() - t0 < HANG_MS) { await new Promise(r => setTimeout(r, 50)); if (!btn.disabled) break; }
    out[label] = { settled: !btn.disabled, ms: Date.now() - t0, status: stat.textContent,
                   flagged: stat.classList.contains('bad'), lineShown: !document.getElementById('expprog').hidden };
  };
  try {
    delete window.Worker;                                  // take the sequential toBlob path
    HTMLCanvasElement.prototype.toBlob = function (cb) { setTimeout(() => cb(null), 0); };
    await run('toBlob returns null');
    HTMLCanvasElement.prototype.toBlob = realToBlob;
    window.Worker = class {                                // a worker that reports a failure
      constructor() { this.onmessage = null; this.onerror = null; }
      postMessage(d) { setTimeout(() => this.onmessage && this.onmessage({ data: { i: d.i, err: 'convertToBlob failed' } }), 0); }
      terminate() {}
    };
    await run('worker reports an error');
  } finally {
    window.Worker = realWorker;
    HTMLCanvasElement.prototype.toBlob = realToBlob;
    HTMLAnchorElement.prototype.click = realClick;
  }
  return out;
}, HANG_MS);

await browser.close();
server.close();

for (const [label, r] of Object.entries(fails)) {
  checks.push([`${label}: export settles`, r.settled ? `${r.ms} ms` : `HUNG for ${r.ms} ms`, r.settled === true]);
  checks.push([`${label}: says why, and stays`, r.status.slice(0, 44), r.settled && r.flagged && r.lineShown]);
}

for (const [name, value, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)}  ${value}`);
console.log('');
console.log('messages seen: ' + got.seen.join(' | '));

const bad = checks.filter(c => !c[2]).length;
console.log('');
console.log(bad ? `Export progress FAILED ${bad} of ${checks.length} checks — an export can run without saying so.`
                : `Export progress: PASS — the export reports itself from start to finish.`);
process.exit(bad ? 1 : 0);
