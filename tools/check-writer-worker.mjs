// IS THE WRITER WORKER'S SOURCE ACTUALLY JAVASCRIPT, AND DOES IT REACH FOR ANYTHING IT HAS NOT GOT?
//
// WRITER_SRC is a string assembled from quoted lines and handed to a Blob URL. Nothing else in this repo
// looks at it. `node tools/check-build.mjs` parses the app's own script blocks and sees a perfectly valid
// array of strings; a syntax error INSIDE those strings is invisible to it and surfaces only in a
// browser, in a worker, part way into a render. That is the most expensive place to find one.
//
// The sibling hazard is scope. The render pool is built by putting this file's own functions through
// toString(), which loses their closure - that is what check-worker-core.mjs exists for, after four
// separate names leaked out of it. This worker is written as a literal source string precisely so it
// cannot inherit that problem, and that claim is worth holding rather than repeating: a line added here
// that names an app variable would throw at run time exactly like sectionList did.
//
// So, three things:
//   1  the assembled source parses
//   2  it contains no control characters - a \b written through a generator is a BACKSPACE, converts
//      silently, and prints as if it were intact
//   3  every bare name it uses is either declared inside it or a global a dedicated worker really has
//
//   node tools/check-writer-worker.mjs
//   node tools/check-writer-worker.mjs --self-test   prove it can go red
import { readFileSync } from 'fs';

const APP = 'app/stone-author.html';
const SRC = readFileSync(new URL('../' + APP, import.meta.url), 'utf8');
const SELF = process.argv.includes('--self-test');

// Lift the array literal and evaluate it, so what is checked is exactly what ships.
function lift() {
  const head = 'const WRITER_SRC = ' + String.fromCharCode(96);
  const a = SRC.indexOf(head);
  if (a < 0) throw new Error('cannot find WRITER_SRC - this gate is stale');
  const open = a + head.length - 1;                      // at the opening backtick
  let end = -1;
  for (let i = open + 1; i < SRC.length; i++) {
    if (SRC[i] === '\\') { i++; continue; }
    if (SRC.charCodeAt(i) === 96) { end = i; break; }
  }
  if (end < 0) throw new Error('WRITER_SRC literal is not closed');
  // Evaluated rather than sliced, so an escape in the literal means here what it will mean there.
  return new Function('return ' + SRC.slice(open, end + 1))();
}

// What a dedicated worker genuinely has. Anything outside this is either declared in the source or is a
// name that does not exist where this runs.
const WORKER_GLOBALS = new Set([
  'self', 'navigator', 'postMessage', 'onmessage', 'Promise', 'Error', 'String', 'Number', 'Object',
  'Array', 'JSON', 'Uint8Array', 'ArrayBuffer', 'DataView', 'Math', 'console', 'undefined', 'null',
  'true', 'false', 'globalThis',
]);
const KEYWORDS = new Set([
  'let', 'const', 'var', 'function', 'async', 'await', 'return', 'if', 'else', 'for', 'of', 'in',
  'while', 'do', 'try', 'catch', 'finally', 'throw', 'new', 'typeof', 'instanceof', 'delete', 'void',
  'this', 'class', 'extends', 'super', 'switch', 'case', 'default', 'break', 'continue', 'yield',
]);

function freeNames(src) {
  // strings and comments out first, so a name inside a message never counts as a reference
  const bare = src.replace(/\/\/[^\n]*/g, '')
                  .replace(/'(?:\\.|[^'\\])*'/g, "''")
                  .replace(/"(?:\\.|[^"\\])*"/g, '""');
  const declared = new Set();
  for (const m of bare.matchAll(/\b(?:let|const|var|function)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of bare.matchAll(/\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>/g)) declared.add(m[1]);   // (e) =>
  for (const m of bare.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of bare.matchAll(/\{\s*([A-Za-z_$][\w$]*)\s*\}\s*=/g)) declared.add(m[1]);
  const free = new Set();
  for (const m of bare.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)) {
    const n = m[2];
    if (KEYWORDS.has(n) || declared.has(n) || WORKER_GLOBALS.has(n)) continue;
    if (/^\d/.test(n)) continue;
    free.add(n);
  }
  // an object literal key is not a reference: { id: m.id } mentions `id` and reaches for nothing
  for (const m of bare.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) free.delete(m[1]);
  return [...free];
}

function check(src, label) {
  const bad = [];
  try { new Function(src); } catch (e) { bad.push('does not parse: ' + e.message); }
  const ctl = [];
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32)) ctl.push(i + ':' + c);
  }
  if (ctl.length) bad.push('control characters at ' + ctl.slice(0, 6).join(', '));
  const free = freeNames(src);
  if (free.length) bad.push('reaches for ' + free.join(', ') + ' - not declared here and not a worker global');
  return bad;
}

if (SELF) {
  // THE BITE, in all three shapes. A gate that only ever prints OK is indistinguishable from one that
  // read nothing.
  const good = lift();
  let fails = 0;
  const want = (name, src, expect) => {
    const bad = check(src, name);
    const got = bad.length > 0;
    console.log('  ' + (got === expect ? 'ok   ' : 'FAIL ') + name + (got ? '   -> ' + bad[0].slice(0, 70) : ''));
    if (got !== expect) fails++;
  };
  want('the shipping source is clean', good, false);
  want('a syntax error is caught', good + '\nif (', true);
  want('a backspace is caught', good + '\n// \b', true);
  want('a reach for an app variable is caught', good + '\nsectionList();', true);
  if (fails) { console.error('SELF-TEST FAILED'); process.exit(2); }
  console.log('\nself-test: the gate bites in all three shapes.');
  process.exit(0);
}

const src = lift();
const bad = check(src, 'WRITER_SRC');
if (bad.length) {
  console.error('writer worker:\n  ' + bad.join('\n  '));
  process.exit(1);
}
console.log('writer worker: OK - ' + src.split('\n').length + ' lines parse, no control characters, ' +
            'nothing reached for beyond a worker\'s own globals');
