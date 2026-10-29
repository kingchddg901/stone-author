// THE PLANNER'S MEMORY IS WRITTEN ONLY BY A RENDER THE PLANNER CHOSE.
//
// `stone-author:plan:v5` holds one record per device, width, light and memory setting: `ok` is the
// tile size that won the race and finished, `bad` the sizes that were started and never came back.
// Both are evidence, and a FORCED render is not evidence of either - forcedTile() skips the
// remembered plan and the whole ladder walk, so its size was never weighed against anything.
//
// WHAT THIS CATCHES, because it shipped: markAttempt was guarded and proveTile was not. Forcing a
// tile could not teach the planner that a size was DANGEROUS, and did teach it that a size was
// RIGHT - so one `?tile=2048` diagnostic at a width made 2048 the remembered answer for that width
// from then on, handed back to every later render that asked for nothing. Half of the pair had been
// thought about, which is exactly the shape that reads as complete.
//
// AND THE FORGET MUST STAY UNGUARDED. `proveTile(0, W)` is how a remembered plan that no longer
// calibrates is dropped, and that has to happen whatever chose it. Without this third check the gate
// would be satisfied by guarding every call, which would leave a stale plan in the store for good.
//
// There is deliberately no backslash escape anywhere in the patterns below: this repo has shipped a
// regex whose \b became a backspace through a generator, and the grep that checked it printed the
// byte as if it were intact. Character classes and explicit groups only.
//
//   node tools/check-plan-memory.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'app/stone-author.html';
const src = readFileSync(join(ROOT, APP), 'utf8');
const lines = src.split(String.fromCharCode(10));
const GUARD = '!forcedTile()';
const bad = [];

// WHICH CALLS EXIST, by name, skipping the two declarations. A call that moves out of this file, or
// is renamed, takes its check with it - so the count is asserted too.
const CALLS = ['proveTile', 'markAttempt'];
const found = { proveTile: 0, markAttempt: 0, forget: 0 };

lines.forEach((line, i) => {
  const n = i + 1;
  for (const name of CALLS) {
    const at = line.indexOf(name + '(');
    if (at < 0) continue;
    if (line.indexOf('function ' + name + '(') >= 0) continue;   // the declaration itself
    const before = line.slice(0, at);
    const after = line.slice(at + name.length + 1);
    const firstArg = after.slice(0, after.indexOf(',') < 0 ? after.length : after.indexOf(',')).trim();
    const forget = name === 'proveTile' && firstArg === '0';
    const guarded = before.indexOf(GUARD) >= 0;
    if (forget) {
      found.forget++;
      if (guarded) bad.push(`${APP}:${n}  the FORGET is guarded by ${GUARD} - a plan that no longer`
        + ` calibrates has to be dropped whatever chose it, or a stale one is kept for good`);
    } else {
      found[name]++;
      if (!guarded) bad.push(`${APP}:${n}  ${name}(${firstArg}, ...) writes the planner's memory`
        + ` without ${GUARD} - a forced render ran no race, so its size is not evidence`);
    }
  }
});

for (const name of CALLS) {
  if (!found[name]) bad.push(`no call to ${name} found in ${APP} - this gate is checking nothing.`
    + ' If the planner memory moved, move the check with it.');
}
if (!found.forget) bad.push(`no proveTile(0, ...) found in ${APP} - the one path that un-remembers a`
  + ' plan that stopped calibrating. Without it a bad plan is handed back for ever.');

// AND THE GUARD HAS TO COVER EVERY ROUTE INTO A FORCED TILE. forcedTile() is the question the
// planner already asks - `const proven = forcedTile() ? 0 : provenTile(W)` - and it answers for all
// three: the URL, the Render panel's dropdown, and a resumed job pinning the size from its record.
// Narrowed to TILE_FORCED alone it would let the other two write the store again.
const def = /const forcedTile = \(\) => ([^;]+);/.exec(src);
if (!def) {
  bad.push(`no forcedTile definition in ${APP} - the guard above names something that is not there`);
} else {
  for (const part of ['TILE_FORCED', 'tilePick']) {
    if (def[1].indexOf(part) < 0) {
      bad.push(`forcedTile() is "${def[1].trim()}" and does not read ${part}, so a tile chosen that`
        + ' way still writes the planner memory');
    }
  }
}

// No control character may have reached the patterns above through an editor or a generator.
const junk = [...GUARD].map((c, i) => [i, c.charCodeAt(0)]).filter(([, c]) => c < 32);
if (junk.length) bad.push('the guard string carries a control character at index ' + junk[0][0]);

if (bad.length) {
  console.error('plan-memory: ' + bad.length + ' problem(s)');
  for (const b of bad) console.error('  ' + b);
  process.exit(1);
}
console.log('plan-memory: OK — ' + found.proveTile + ' promote, ' + found.markAttempt
  + ' death mark, both behind ' + GUARD + '; ' + found.forget + ' forget, unguarded');
