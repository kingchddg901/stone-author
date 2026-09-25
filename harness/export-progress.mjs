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
    let everDisabled = false, menusLocked = null;
    const iv = setInterval(() => {
      const t = stat.textContent;
      if (t && seen[seen.length - 1] !== t) { seen.push(t); fills.push(document.getElementById('expfill').style.width); }
      if (btn.disabled) everDisabled = true;
    }, 15);
    btn.click();
    // Read in this tick: exportAll disables synchronously, before its first await, and a small export can
    // finish before any sampler fires. An earlier version of this check sampled 30 ms in and saw nothing.
    menusLocked = document.getElementById('expres').disabled && document.getElementById('expwhat').disabled;
    // Poll for the end rather than sleeping a fixed time: the container's speed is not ours to assume.
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50));
      if (seen.length && !btn.disabled) break;
    }
    clearInterval(iv);
    return { seen, fills, everDisabled, menusLocked,
             menusFreeAfter: !document.getElementById('expres').disabled && !document.getElementById('expwhat').disabled,
             enabledAfter: !btn.disabled,
             finalLine: stat.textContent, clock: document.getElementById('expclock').textContent,
             stillShown: !document.getElementById('expprog').hidden };
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
  // Leaving the menus live during an export lets you change one, see nothing happen, and conclude the
  // app ignored you.
  ['the width and scope menus lock too', got.menusLocked, got.menusLocked === true],
  ['and are free again afterwards', got.menusFreeAfter, got.menusFreeAfter === true],
  // The finished line STAYS: it is the record of what was last exported and how long it took, which is
  // the number you compare against after touching the renderer.
  ['it leaves the finished export up', got.finalLine, got.stillShown === true && /\d+:\d\d$/.test(got.finalLine)],
  ['and a wall-clock time with it', got.clock, /^\d+:\d\d$/.test(got.clock)],
  // The kit's first image is the finished slab -- the same tiled render the render-only path does, and
  // the longest step by far. Without this it sat on "Rendering 1 of 14" for the whole of it.
  [`the kit's first image counts tiles too`, got.seen.filter(t => /^Image 1 of /.test(t)).length + ' lines',
   got.seen.some(t => /^Image 1 of \d+ . tile \d+ of \d+/.test(t))],
];

// --- render-only must count TILES, not sit on one step -------------------------------------------
// For a render-only export the single image IS the whole job, so "Rendering 1 of 1" is a progress bar
// with one tick -- and at 16384 that one tick lasts about two minutes on a phone, which reads as a hang.
// renderTiledStepped runs the same tile closures in the same order with a yield between them.
const tiled = await page.evaluate(async () => {
  const btn = document.getElementById('export'), stat = document.getElementById('expstat');
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {};
  try {
    document.getElementById('expres').value = '4096';                 // 4 x 3 tiles, enough to count
    document.getElementById('expwhat').value = 'render';
    const seen = [];
    // A MutationObserver sees EVERY change; a poll sees whatever it happens to land on, and on a fast
    // machine the tiles go by quicker than the interval. That cost a red CI run on a correct app.
    const obs = new MutationObserver(() => { const t = stat.textContent; if (t && seen[seen.length - 1] !== t) seen.push(t); });
    obs.observe(stat, { childList: true, characterData: true, subtree: true });
    btn.click();
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) { await new Promise(r => setTimeout(r, 40)); if (!btn.disabled) break; }
    obs.disconnect();
    document.getElementById('expwhat').value = 'all';
    return { seen, finalLine: stat.textContent };
  } finally { HTMLAnchorElement.prototype.click = realClick; }
});
const tileLines = tiled.seen.filter(t => /\d+ of \d+/.test(t) && !/1 of 1/.test(t));

// --- the render must carry its own timings, and still be a PNG -----------------------------------
// A tEXt chunk spliced after IHDR records what the render was and how long each stage took, so a later
// "it feels faster" can be checked against a number. Splicing bytes into a PNG is exactly the kind of
// thing that silently produces a file that opens in one viewer and not another, so every chunk's CRC is
// verified, not just the added one.
const meta = await page.evaluate(async () => {
  const btn = document.getElementById('export');
  document.getElementById('expres').value = '1024';
  document.getElementById('expwhat').value = 'render';
  let grabbed = null;
  const realURL = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = function (b) { if (b instanceof Blob && b.type === 'image/png') grabbed = b; return realURL.call(URL, b); };
  HTMLAnchorElement.prototype.click = function () {};
  try {
    btn.click();
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) { await new Promise(r => setTimeout(r, 40)); if (!btn.disabled) break; }
    if (!grabbed) return { error: 'no PNG was produced' };
    const u8 = new Uint8Array(await grabbed.arrayBuffer()), dv = new DataView(u8.buffer);
    const crc32 = a => { let c = ~0; for (let i = 0; i < a.length; i++) { c ^= a[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
    let at = 8, badCrc = [], order = [], text = null;
    while (at < u8.length) {
      const len = dv.getUint32(at), type = String.fromCharCode(...u8.subarray(at + 4, at + 8));
      if (dv.getUint32(at + 8 + len) !== crc32(u8.subarray(at + 4, at + 8 + len))) badCrc.push(type);
      order.push(type);
      if (type === 'tEXt') { const d = u8.subarray(at + 8, at + 8 + len), z = d.indexOf(0);
        text = { kw: new TextDecoder().decode(d.subarray(0, z)), body: new TextDecoder().decode(d.subarray(z + 1)) }; }
      if (type === 'IEND') break;
      at += 12 + len;
    }
    const size = await createImageBitmap(grabbed).then(b => [b.width, b.height]).catch(() => null);
    return { order: order.slice(0, 2), badCrc, tidy: at + 12 === u8.length, size,
             kw: text && text.kw, meta: text && JSON.parse(text.body) };
  } finally { URL.createObjectURL = realURL; HTMLAnchorElement.prototype.click = realClick; }
});
const m = meta.meta || {};
checks.push(['the render carries a tEXt chunk', meta.kw || 'none', meta.kw === 'stone-author']);
checks.push(['it sits right after IHDR', (meta.order || []).join(','), (meta.order || []).join(',') === 'IHDR,tEXt']);
checks.push(['every chunk CRC still checks', (meta.badCrc || ['?']).length === 0 ? 'all valid' : meta.badCrc.join(','), (meta.badCrc || ['?']).length === 0 && meta.tidy === true]);
checks.push(['and it still decodes as a PNG', (meta.size || []).join('x') || 'NO', Array.isArray(meta.size) && meta.size[0] === 1024]);
checks.push(['with per-stage timings', m.ms ? `render ${m.ms.render}ms encode ${m.ms.encode}ms` : 'none',
             !!(m.ms && Number.isFinite(m.ms.render) && Number.isFinite(m.ms.encode) && Number.isFinite(m.ms.total)) && m.tiles >= 1]);
checks.push(['render-only counts its tiles', tileLines.length + ' tile lines', tileLines.length >= 3]);
checks.push(['render-only reports a time', tiled.finalLine, /\d+:\d\d$/.test(tiled.finalLine)]);

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
console.log('kit:         ' + got.seen.join(' | '));
console.log('render only: ' + tiled.seen.join(' | '));

const bad = checks.filter(c => !c[2]).length;
console.log('');
console.log(bad ? `Export progress FAILED ${bad} of ${checks.length} checks — an export can run without saying so.`
                : `Export progress: PASS — the export reports itself from start to finish.`);
process.exit(bad ? 1 : 0);
