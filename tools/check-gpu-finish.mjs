// THE FINISHERS MUST ACTUALLY BE REACHED.
//
// exportTiff builds them, attaches them, and writes "gpu finishers 8" into the master's trail. None
// of that makes the export USE them: the tile loop takes the pool.finish branch on `p.fin` alone,
// and a stale line four below the finisher block read
//
//     if (pool) p.fin = false;
//
// left over from when a GPU pool could only hand back a canvas. It undid the wiring on every single
// render. Four quartets of 32,768 masters went through the path the finishers were built to
// replace, each one reporting in its own trail that the finishers were there.
//
// NOTHING CAUGHT IT. The trail said yes, the plan said yes, every gate was green, and the timing
// barely moved - which reads as "the finishers are not worth much" rather than "the finishers never
// ran". It took gpuOwn coming back with draw: 0 and n: 0 while copy was non-zero: the shader had
// run and the lookahead that feeds the workers had not.
//
// So this reads the ORDER of the assignments rather than whether the code looks right. A later
// unconditional `p.fin = false` after the finisher block is the defect, however it is spelled.
//
//   node tools/check-gpu-finish.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NL = String.fromCharCode(10);
const SRC = readFileSync(join(ROOT, 'app', 'stone-author.html'), 'utf8');

// COMMENTS BLANKED, NOT REMOVED, so every offset below still lands where it did. The first version
// of this read the comment that QUOTES the defect it was written to catch and reported the comment
// as the defect - a gate that cannot tell prose from code is one that gets ignored.
const CODE = SRC.split(NL).map(l => {
  const i = l.indexOf('//');
  return i < 0 ? l : l.slice(0, i) + ' '.repeat(l.length - i);
}).join(NL);

const fail = [];
const ok = (what, cond, note) => {
  if (!cond) fail.push(what);
  console.log('  ' + (cond ? 'ok  ' : 'RED ') + what + (note ? '   ' + note : ''));
};
const lineAt = (s, i) => s.slice(s.lastIndexOf(NL, i) + 1, s.indexOf(NL, i)).trim();

const attach = CODE.indexOf('pool.useFinishers(fw); p.fin = true;');
ok('the finishers are attached, and p.fin is set on the same line', attach > 0);

// Every assignment to p.fin, in order. Only `false` is interesting: setting it true IS the attach,
// which sits on that same line and would otherwise flag itself.
const assigns = [];
const re = /p\.fin\s*=\s*([^;]+);/g;
let m;
while ((m = re.exec(CODE))) assigns.push({ at: m.index, to: m[1].trim() });
ok('p.fin is assigned at all', assigns.length > 0, assigns.length + ' assignment(s)');

// An assignment after the attach is only safe when it is guarded by the finishers being absent -
// an `else` arm, a `!pool`, or the refusal branch. An unconditional one is the bug that shipped.
const after = assigns.filter(a => a.at > attach && /^false\b/.test(a.to));
const bad = after.filter(a => !/!pool|else|refused/.test(lineAt(CODE, a.at)));
ok('nothing turns p.fin off after the finishers are attached', bad.length === 0,
   bad.length ? bad.map(b => JSON.stringify(lineAt(CODE, b.at))).join(' | ') : '');

ok('the tile loop still branches on p.fin', CODE.indexOf('pool && attempt === 1 && p.fin') > 0);

console.log('');
console.log(fail.length
  ? 'gpu-finish: ' + fail.length + ' FAILED - the finishers are built and then not used'
  : 'gpu-finish: the finishers are attached and nothing unsets them afterwards.');
process.exit(fail.length ? 1 : 0);
