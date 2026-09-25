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

await browser.close();
server.close();

if (got.error) { console.error('export-progress harness: ' + got.error); process.exit(1); }

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

for (const [name, value, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)}  ${value}`);
console.log('');
console.log('messages seen: ' + got.seen.join(' | '));

const bad = checks.filter(c => !c[2]).length;
console.log('');
console.log(bad ? `Export progress FAILED ${bad} of ${checks.length} checks — an export can run without saying so.`
                : `Export progress: PASS — the export reports itself from start to finish.`);
process.exit(bad ? 1 : 0);
