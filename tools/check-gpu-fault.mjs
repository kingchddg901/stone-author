// A FAULTED DEVICE MUST NOT KEEP WRITING TILES.
//
// paintOne used to push a validation error scope and await the pop on every band of every tile.
// That cost 7.8-9.4 ms a tile on the desktop and 1.3-2.5 in the harness, against a map wait of
// 16 ms on both machines - 28% of a tile, for a check that can only newly fail when the dispatch
// geometry changes, and the geometry takes two values in a whole render.
//
// So the scope now runs once per distinct row count and `dev.onuncapturederror` carries everything
// else. That handler did not exist before: every error this device reported outside the scope went
// to the console and nowhere else, and nothing could fail a render on it.
//
// THE FIRST VERSION OF THE REPLACEMENT DID NOT BITE, and only a probe said so. It threw at the end
// of paintOne, which is the producer - but the producer runs AHEAD of the consumer. Tile 1 drew
// cleanly after a validation error was raised, because its paint had already finished as tile 0's
// prefetch. One tile late with a single prefetch; the lookahead that feeds the finishers runs up to
// thirteen deep, so thirteen tiles could reach OPFS and the TIFF after the device said it had gone
// wrong - and those tiles are PERSISTED, not discarded.
//
// Which is why this reads the HANDOFFS rather than the handler. A fault recorded and never checked
// where the data leaves the pool is a console message, not a guard, and that distinction is exactly
// what the probe caught and what reading the code did not.
//
// Ablated three ways while it was written: drop the faultCheck from tile(), drop the handler, make
// the scope unconditional - each one turns a row below red.
//
//   node tools/check-gpu-fault.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NL = String.fromCharCode(10);
const SRC = readFileSync(join(ROOT, 'app', 'stone-author.html'), 'utf8');

// COMMENTS BLANKED, NOT REMOVED, so offsets still land - and so that this file's own prose, which
// quotes the defect, cannot be read as the code that has it. check-gpu-finish.mjs shipped that bug
// on its first run and reported its own comment as the finding.
const CODE = SRC.split(NL).map(l => {
  const i = l.indexOf('//');
  return i < 0 ? l : l.slice(0, i) + ' '.repeat(l.length - i);
}).join(NL);

const fail = [];
const ok = (what, cond, note) => {
  if (!cond) fail.push(what);
  console.log('  ' + (cond ? 'ok  ' : 'RED ') + what + (note ? '   ' + note : ''));
};

// ---- the backstop exists and records somewhere that outlives a pool ------------------------------
ok('the device gets an onuncapturederror handler',
   /dev\.onuncapturederror\s*=/.test(CODE));
ok('the fault is recorded on the capability, not on the pool',
   /cap\.fault\s*=\s*\(?e/.test(CODE) && /fault:\s*null/.test(CODE),
   'a pool-local flag dies with the pool, and the pool is rebuilt per export');

// ---- the scope is conditional, and balanced on the same condition --------------------------------
const push = /if\s*\(check\)\s*\{[^}]*pushErrorScope/.test(CODE);
const pop = /check\s*\?\s*await\s+dev\.popErrorScope\(\)\s*:\s*null/.test(CODE);
ok('the validation scope is pushed only for an unseen geometry', push);
ok('and popped on the same condition', pop,
   'an unbalanced scope leaks one per tile and reports the wrong error');
ok('the geometry is what decides, not the tile index', /scoped\.has\(rows\)/.test(CODE),
   'rows is the only input validation reads; the uniform contents are not');

// ---- AND THE HANDOFFS CHECK IT. This is the row the first version failed. ------------------------
const fnBody = (name) => {
  const at = CODE.indexOf(name);
  if (at < 0) return '';
  return CODE.slice(at, at + 400);
};
for (const [name, sig] of [['tile', 'async tile(i) {'], ['finish', 'async finish(i) {']]) {
  const body = fnBody(sig);
  ok('pool.' + name + '() refuses once a fault is visible', /faultCheck\(\)/.test(body),
     body ? '' : 'could not find ' + JSON.stringify(sig));
}
// The producer check stays too - earlier is better when the producer is what notices.
ok('paintOne still throws on a fault it sees itself',
   /if\s*\(!e\s*&&\s*cap\.fault\)\s*throw/.test(CODE));

// ---- a fault must STOP things, not be logged ----------------------------------------------------
const chk = CODE.match(/const faultCheck = \(\) => \{[^}]*\}/);
ok('faultCheck throws rather than returning a verdict',
   !!chk && /throw new Error/.test(chk[0]),
   chk ? '' : 'faultCheck not found');

console.log('');
console.log(fail.length
  ? 'gpu-fault: ' + fail.length + ' FAILED - a faulted device could keep writing tiles'
  : 'gpu-fault: the backstop exists, the scope is conditional, and both handoffs refuse on a fault.');
process.exit(fail.length ? 1 : 0);
