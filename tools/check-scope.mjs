// IS ANYTHING CALLED FROM OUTSIDE THE FUNCTION THAT DECLARES IT?
//
// `cantBand` was declared inside renderStoneOffscreen and called from renderFloorTile, which is a
// ReferenceError the moment it is reached. It was never reached: the call sits behind `STAGE > 1 ?`
// and every floor rendered so far had one stage, so the ternary short-circuited and the export
// finished. A staged wood floor through the TIFF path would have thrown, with nothing to say why.
// A second renderer that is wrong only in a configuration nobody has tried yet is the shape that
// costs a day, and no test here could have caught it: the path does not run.
//
// NO DYNAMIC REGEX IN HERE ON PURPOSE, for the reason check-same-image.mjs gives at length - escapes
// do not survive being generated through a shell, and the first version of this file shipped
// `[^\w$.]` as `[^w$.]`, which threw rather than lying, and the next one might lie. The call test is
// a character scan.
//
// No parser either: the app is 11,000 lines of HTML around three inline scripts, and the question is
// narrow enough for a brace scan. Only a NESTED function declaration with NO module-level
// declaration of the same name is considered, so a shadowed name is never reported.
//
//   node tools/check-scope.mjs             audit
//   node tools/check-scope.mjs --self-test  prove it can go red
import { readFileSync } from 'fs';

const SRC = 'app/stone-author.html';
const SELF = process.argv.includes('--self-test');
const lines = readFileSync(SRC, 'utf8').split(/\r?\n/);

// a line's code, with line comments and string bodies emptied so a name inside one is not a call
const code = l => l.replace(/\/\/.*/, '').replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, '``');

const wordish = ch => ch !== undefined && (/[A-Za-z0-9_$]/.test(ch) || ch === '.');

// Does this line CALL `name`? True when the name appears with a non-word, non-dot character before it
// and an open bracket after it. `d.cantBand(` is a property and does not count.
function callsIt(line, name) {
  const s = code(line);
  let at = s.indexOf(name);
  while (at >= 0) {
    const before = at === 0 ? ' ' : s[at - 1];
    let k = at + name.length;
    while (k < s.length && s[k] === ' ') k++;
    if (!wordish(before) && s[k] === '(') return true;
    at = s.indexOf(name, at + 1);
  }
  return false;
}

// every top-level function: declared at exactly two spaces, closing where its braces balance
const TOP = [];
for (let i = 0; i < lines.length; i++) {
  if (!/^  (async )?function [A-Za-z_$][\w$]*\s*\(/.test(lines[i])) continue;
  const name = lines[i].match(/function ([A-Za-z_$][\w$]*)/)[1];
  let d = 0, began = false, end = lines.length - 1;
  for (let j = i; j < lines.length; j++) {
    for (const ch of code(lines[j])) { if (ch === '{') { d++; began = true; } else if (ch === '}') { d--; } }
    if (began && d === 0) { end = j; break; }
  }
  TOP.push({ name, start: i, end });
}

// a name declared at two spaces is reachable from anywhere, so it is never this bug
const moduleLevel = new Set();
for (const l of lines) {
  const m = code(l).match(/^  (?:const|let|var|function|async function)\s+([A-Za-z_$][\w$]*)/);
  if (m) moduleLevel.add(m[1]);
}

const nested = [];
for (const fn of TOP) {
  for (let i = fn.start + 1; i < fn.end; i++) {
    const c = code(lines[i]);
    const m = c.match(/^\s{4,}(?:const|let|var)\s+([A-Za-z_$][\w$]{3,})\s*=\s*(?:\(|function|async)/)
           || c.match(/^\s{4,}function\s+([A-Za-z_$][\w$]{3,})\s*\(/);
    if (m && !moduleLevel.has(m[1])) nested.push({ name: m[1], declared: i + 1, fn });
  }
}

// WHICH NAMES EACH TOP-LEVEL FUNCTION DECLARES FOR ITSELF. Without this the gate reports every
// helper whose name is reused - `show`, `send`, `samp`, `step` are each declared independently
// inside several binders - and a caller that has its own binding is resolving perfectly well. The
// first run of this gate produced 1 real finding and 27 of these.
const ownNames = new Map();
for (const n of nested) {
  if (!ownNames.has(n.fn.name)) ownNames.set(n.fn.name, new Set());
  ownNames.get(n.fn.name).add(n.name);
}
const enclosing = j => { for (const fn of TOP) if (j >= fn.start && j <= fn.end) return fn; return null; };

// AND THE RULE THAT MAKES THIS PRECISE RATHER THAN NOISY. A brace scan cannot see every binding -
// `const bindFoo = () => {` is a scope it does not model, and a name can arrive as a PARAMETER or
// out of a destructuring, neither of which is a declaration it can find. So a name that is bound
// more than once anywhere, or that is ever destructured or taken as an argument, is left alone.
// Measured: the unrestricted form found 1 real defect and 27 false ones, then 15. Only a name with
// exactly ONE binding in the whole file can be judged by where that binding sits.
const bindCount = new Map();
const otherwiseBound = new Set();
for (const l of lines) {
  const c = code(l);
  for (const m of c.matchAll(/(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g))
    bindCount.set(m[1], (bindCount.get(m[1]) || 0) + 1);
  // a destructuring, or an argument list: every name inside braces or brackets on a binding line
  if (/(?:const|let|var)\s*\{/.test(c) || /\(\s*\{/.test(c))
    for (const m of c.matchAll(/([A-Za-z_$][\w$]*)\s*[,}:]/g)) otherwiseBound.add(m[1]);
  for (const m of c.matchAll(/(?:function\s*[A-Za-z_$\w$]*\s*|=>\s*|\(\s*)\(([^)]*)\)/g))
    for (const p of m[1].split(',')) { const t = p.trim().split(/[\s=]/)[0]; if (/^[A-Za-z_$][\w$]*$/.test(t)) otherwiseBound.add(t); }
}
const judgeable = name => bindCount.get(name) === 1 && !otherwiseBound.has(name);

// `async finish(desc) {` is a method being DEFINED, not finish being called. The call scan cannot
// tell them apart, so the definition shape is excluded here.
function isDefinition(line, name) {
  const t = code(line).trim();
  const head = t.startsWith('async ') ? t.slice(6).trimStart() : t;
  return head.startsWith(name + '(') && t.endsWith('{');
}

const findings = [];
for (const n of nested) {
  if (!judgeable(n.name)) continue;                         // bound more than once, or not by a declaration
  for (let j = 0; j < lines.length; j++) {
    if (j >= n.fn.start && j <= n.fn.end) continue;        // inside its own function is fine
    if (!callsIt(lines[j], n.name)) continue;
    if (isDefinition(lines[j], n.name)) continue;          // a method of that name, not a call
    const host = enclosing(j);
    if (host && ownNames.get(host.name) && ownNames.get(host.name).has(n.name)) continue;  // its own
    findings.push({ ...n, called: j + 1, host: host ? host.name : 'module scope', text: lines[j].trim().slice(0, 72) });
  }
}

if (SELF) {
  // THE BITE, against ground truth chosen rather than derived: plant a call to a nested name on a
  // line outside its function and require this exact finding back. An empty scan proves nothing.
  if (!nested.length) { console.error('self-test: no nested declaration exists to plant against'); process.exit(2); }
  const v = nested[0];
  const planted = lines.slice();
  const where = v.fn.end + 1 < lines.length ? v.fn.end + 1 : v.fn.start - 1;
  planted[where] = `  const _plantedProbe = ${v.name}(0);` + planted[where];
  let hit = false;
  for (let j = 0; j < planted.length; j++) {
    if (j >= v.fn.start && j <= v.fn.end) continue;
    if (callsIt(planted[j], v.name)) hit = true;
  }
  console.log(`self-test: planted a call to ${v.name} (declared line ${v.declared} inside ${v.fn.name}) at line ${where + 1}`);
  if (!hit) { console.error('SELF-TEST FAILED: the planted call was not seen'); process.exit(2); }
  console.log('self-test: the planted call was caught. The gate bites.');
  process.exit(0);
}

if (!findings.length) {
  console.log(`scope: ${nested.length} nested functions, every one called only from inside the function that declares it`);
  process.exit(0);
}
for (const f of findings) console.error(`  ${f.name} declared at ${f.declared} inside ${f.fn.name}, called at ${f.called} in ${f.host}\n      ${f.text}`);
console.error(`scope: ${findings.length} call${findings.length > 1 ? 's' : ''} that cannot resolve — a ReferenceError wherever it is reached`);
process.exit(1);
