// Every line pin in docs/functions.md must point at the function it names.
//
// `functions.md` is the function reference for app/stone-author.html, and each entry ends with the
// line the function is declared on, as *(1234)*. Those pins are the only thing making a 40 KB
// reference navigable — and they rot silently, because nothing about editing the app disturbs a
// number written in a markdown file. Measured on 2026-10-01, before this gate existed: 54 pins,
// ZERO correct, drifting by up to +3,450 lines. `expCompleted` was pinned at 2316 and lived at
// 5766. A reader following a pin landed three thousand lines from the function, which is worse than
// no pin at all: it costs them the time to work out that the map is wrong rather than their reading.
//
// The pin is checked against a DECLARATION, not a mention, so a function's own call sites cannot
// satisfy it. Arrow consts count — half this app is `const name = x => ...` and an earlier version
// of this check reported six functions "missing" that were all arrow consts, which is the sort of
// false alarm that gets a gate switched off.
//
// A name declared more than once must be pinned at one of its declarations; the gate does not guess
// which, it only requires the pin to be one of them.
//
//   node tools/check-fn-refs.mjs          check
//   node tools/check-fn-refs.mjs --fix    rewrite the pins from the source, then check
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'app/stone-author.html';
const DOC = 'docs/functions.md';
const fix = process.argv.includes('--fix');

const app = readFileSync(join(root, APP), 'utf8').split(/\r?\n/);
const docRaw = readFileSync(join(root, DOC), 'utf8');
// functions.md is CRLF. Split on either, remember which, and write back the way it came: a gate that
// silently reflows 472 line endings would bury its own one-line fix in a whole-file diff. (In JS `.`
// does not match \r, so leaving the CR on the line also makes every `$`-anchored pattern below fail —
// which is exactly how the first version of this parser found zero pins in a file with 93.)
const EOL = docRaw.includes('\r\n') ? '\r\n' : '\n';

// A declaration, in every form this app actually uses. Deliberately no backslash escapes in the
// built patterns beyond the name itself: these are assembled from a literal name, not from user text.
const declPatterns = name => {
  const n = name.replace(/[$]/g, '\\$');
  return [
    new RegExp('\\bfunction\\s+' + n + '\\s*\\('),            // function name(
    new RegExp('\\b(?:const|let|var)\\s+' + n + '\\s*='),     // const name = ... (arrow or function)
    new RegExp('^\\s*' + n + '\\s*\\([^)]*\\)\\s*\\{'),       // name(args) {   — object/class method
    new RegExp('\\b' + n + '\\s*:\\s*(?:async\\s+)?function'),// name: function
    new RegExp('\\b' + n + '\\s*:\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>'), // name: (args) =>
  ];
};

const declsOf = name => {
  const pats = declPatterns(name);
  const out = [];
  for (let i = 0; i < app.length; i++) if (pats.some(p => p.test(app[i]))) out.push(i + 1);
  return out;
};

// An entry is a bullet: the name is backticked in its FIRST line, and the *(1234)* closes it —
// often on a continuation line two or three lines further down. So carry the current bullet's name
// forward rather than demanding both on one line, which would silently skip a third of the file.
const nameRx = /^\s*[-*]\s+`([A-Za-z_$][\w$]*)\s*\(/;
const pinRx = /\*\((\d+)\)\*/;

const rows = [];
const lines = docRaw.split(/\r?\n/);
let current = null;
lines.forEach((line, idx) => {
  const n = nameRx.exec(line);
  if (n) current = n[1];
  const p = pinRx.exec(line);
  if (p && current) rows.push({ idx, name: current, pinned: Number(p[1]) });
});

if (!rows.length) {
  console.error(`${DOC}: no *(line)* pins found — the reference lost its pins, or this parser is broken.`);
  process.exit(1);
}

const bad = [];
const unknown = [];
for (const r of rows) {
  r.decls = declsOf(r.name);
  if (!r.decls.length) unknown.push(r);
  else if (!r.decls.includes(r.pinned)) bad.push(r);
}

if (fix) {
  let fixed = 0;
  for (const r of bad) {
    // Nearest declaration to the existing pin: entries are written in source order, so the nearest
    // is the one the author meant even when a name is declared more than once.
    const target = r.decls.reduce((a, b) => (Math.abs(b - r.pinned) < Math.abs(a - r.pinned) ? b : a));
    lines[r.idx] = lines[r.idx].replace(pinRx, `*(${target})*`);
    fixed++;
  }
  if (fixed) writeFileSync(join(root, DOC), lines.join(EOL));
  console.log(`fn-refs: repinned ${fixed} of ${rows.length}`);
  if (unknown.length) {
    console.error(`fn-refs: ${unknown.length} name(s) have no declaration and were left alone: ` +
                  unknown.map(r => r.name).join(', '));
    process.exit(1);
  }
  process.exit(0);
}

if (unknown.length) {
  console.error(`${DOC}: ${unknown.length} pinned name(s) are not declared in ${APP}:`);
  for (const r of unknown) console.error(`  ${r.name} — pinned at ${r.pinned}`);
}
if (bad.length) {
  console.error(`${DOC}: ${bad.length} of ${rows.length} line pin(s) do not point at their function:`);
  for (const r of bad.slice(0, 20)) {
    const near = r.decls.reduce((a, b) => (Math.abs(b - r.pinned) < Math.abs(a - r.pinned) ? b : a));
    console.error(`  ${r.name.padEnd(26)} pinned ${String(r.pinned).padStart(5)} -> declared at ${near} (${near - r.pinned >= 0 ? '+' : ''}${near - r.pinned})`);
  }
  if (bad.length > 20) console.error(`  ... and ${bad.length - 20} more`);
  console.error('Run: node tools/check-fn-refs.mjs --fix');
}
if (bad.length || unknown.length) process.exit(1);

console.log(`fn-refs: OK — all ${rows.length} line pins in ${DOC} land on their declaration`);
