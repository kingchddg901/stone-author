// A long render dies when the screen sleeps, and not by crashing. The tile loop yields with setTimeout
// between tiles, and Blink throttles a hidden page's timers to one call a second, then to one a MINUTE
// after five minutes hidden -- so 160 tiles spend longer waiting than rendering. An evicted tab is worse:
// the master is written through createWritable, which commits at close(), so every tile written is lost.
// A 65535 left running on a tablet overnight was lost to exactly this.
//
// The fix is a screen wake lock whose lifetime is EXACTLY the lifetime of `exporting`. That pairing is the
// whole correctness argument, and it is invisible in the app's behaviour: a missing wakeOn() costs nothing
// until someone walks away from a two-hour render, and a missing wakeOff() leaves the screen awake for
// good. Neither shows up in a render's bytes, so no other gate here can see them.
//
// This reads every place `exporting` is assigned and insists the lock is taken and dropped alongside it,
// which is what stops a fourth export path arriving without one.
//
//   node tools/check-wake-lock.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'app/stone-author.html';
const src = readFileSync(join(root, APP), 'utf8');
const lines = src.split(/\r?\n/);
const bad = [];

// `exporting` is declared once; every OTHER assignment is an export starting or finishing.
const DECL = /^\s*let exporting = false;\s*$/;
let decls = 0;
lines.forEach((line, i) => {
  const at = `${APP}:${i + 1}`;
  if (DECL.test(line)) { decls++; return; }
  if (/\bexporting = true\b/.test(line) && !/\bwakeOn\(\)/.test(line))
    bad.push(`${at}  starts an export without wakeOn(): ${line.trim()}`);
  if (/\bexporting = false\b/.test(line) && !/\bwakeOff\(\)/.test(line))
    bad.push(`${at}  finishes an export without wakeOff(): ${line.trim()}`);
});
if (decls !== 1) bad.push(`${APP}  expected exactly one \`let exporting = false;\`, found ${decls}`);

const starts = lines.filter(l => /\bexporting = true\b/.test(l)).length;
const ends = lines.filter(l => /\bexporting = false\b/.test(l) && !DECL.test(l)).length;
if (!starts) bad.push(`${APP}  no export path found at all -- this gate has stopped watching anything`);
if (starts !== ends) bad.push(`${APP}  ${starts} export path(s) start but ${ends} finish`);

// The platform releases the lock whenever the page hides, so wanting it is not holding it: without this
// listener a render survives one trip to the lock screen and then runs unprotected for the rest of its life.
if (!/visibilitychange[\s\S]{0,160}wakeTake\(\)/.test(src))
  bad.push(`${APP}  no visibilitychange handler re-takes the lock after the page is hidden`);
for (const fn of ['function wakeOn(', 'function wakeOff(', 'async function wakeTake('])
  if (!src.includes(fn)) bad.push(`${APP}  missing ${fn}...)`);

if (bad.length) { console.error('wake lock:\n  ' + bad.join('\n  ')); process.exit(1); }
console.log(`wake lock: OK — ${starts} export path(s), each taking and dropping the screen lock`);
