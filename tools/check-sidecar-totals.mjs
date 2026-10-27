// DOES THE SIDECAR README STILL DESCRIBE THE SIDECAR FOLDER?
//
// `docs/sidecars/README.md` states totals in prose - how many sidecars, how many bytes of master they
// stand for, how many pixels, how much JSON that costs, and the ratio between the last two. Every one
// of those moves the moment a file is added to the folder, and nothing noticed when they stopped being
// true. Measured on 2026-10-27: the paragraph claimed "13 GB of pixels carry about a third of a
// megabyte of checkable evidence" while the folder held 17.56 GB and 15.50 MB - wrong by 46x on the
// second figure, and wrong at every point in the folder's history, not merely stale. It also disagreed
// with the "about 19 GB in all" two sentences below it, which is the tell this gate generalises: two
// totals for one quantity, neither measured.
//
// WHAT IT PROVES: every figure below is a fresh sum over the directory it describes, formatted exactly
// as the prose formats it, and compared as a string. No tolerance - a tolerance is a second opinion
// about how wrong is acceptable, and the prose does not have one.
//
// IT FAILS CLOSED, which is the part worth keeping. A check that quietly passes when it cannot find
// its figure is an off switch disguised as a check: reword the sentence and the gate stops testing
// anything while still printing green. So a pattern that matches zero times is a FAILURE, and so is
// one that matches twice - a figure stated in two places is exactly how the 13/19 GB contradiction
// survived, and this gate refuses to pick a winner.
//
// WHAT IT CANNOT SEE, stated because the limit is not obvious: it recomputes the totals the same way
// the author computed them, so it catches DRIFT and not a SHARED MISTAKE. A unit basis chosen wrongly
// in both places passes. That is not hypothetical - `32.88 MB` was written into this file as MiB while
// every other figure in it (78.1 GB, 122.29 GB, 400 MB) is decimal, and a gate written the same
// afternoon would have agreed with it. Everything here is decimal SI, which is the file's convention;
// if that ever changes, change it in one place here and the prose will fail until it follows.
//
//   node tools/check-sidecar-totals.mjs
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DOCS = join(HERE, '..', 'docs', 'sidecars');
const ARCHIVE = join(DOCS, 'archive');

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('  ok    ' + name); return; }
  fails++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

// BYTES AS THE REPOSITORY STORES THEM, NOT AS THIS CHECKOUT HOLDS THEM. statSync().size was the first
// try and CI rejected it within the minute: 34.48 MB on a Windows working tree against 34.21 on the
// Linux runner, because the older sidecars sit CRLF here and LF there. A figure in the prose that moves
// with a checkout policy is not a figure about the evidence, so a carriage return that precedes a
// line feed is discounted and both machines get the number the repository actually holds.
function lfBytes(buf) {
  let cr = 0;
  for (let i = 0; i < buf.length - 1; i++) if (buf[i] === 13 && buf[i + 1] === 10) cr++;
  return buf.length - cr;
}

// A sum over one directory of sidecars. `skip` keeps index.json out of the archive's count - it is the
// index, not a master's record of itself, and counting it would make the count disagree with its rows.
function sum(dir, skip) {
  const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== skip);
  let json = 0, bytes = 0, px = 0, largest = 0;
  for (const f of files) {
    const buf = readFileSync(join(dir, f));
    json += lfBytes(buf);
    const j = JSON.parse(buf.toString('utf8'));
    bytes += j.bytes || 0;
    px += (j.w || 0) * (j.h || 0);
    if ((j.bytes || 0) > largest) largest = j.bytes;
  }
  return { n: files.length, json, bytes, px, largest };
}

const top = sum(DOCS, null);
const arc = sum(ARCHIVE, 'index.json');
// The archive's master bytes are the ON-DISK sizes, which only its index records - a sidecar's own
// `bytes` counts image data and stops before the tail. README.md says so at length; this follows it.
const arcBytes = JSON.parse(readFileSync(join(ARCHIVE, 'index.json'), 'utf8'))
  .reduce((a, r) => a + (r.bytes || 0), 0);

const WORDS = {
  twenty: 20, 'twenty-one': 21, 'twenty-two': 22, 'twenty-three': 23, 'twenty-four': 24,
  'twenty-five': 25, 'twenty-six': 26, 'twenty-seven': 27, 'twenty-eight': 28, 'twenty-nine': 29,
  thirty: 30, 'thirty-one': 31, 'thirty-two': 32, 'thirty-three': 33, 'thirty-four': 34,
  'thirty-five': 35, 'thirty-six': 36, 'thirty-seven': 37, 'thirty-eight': 38, 'thirty-nine': 39,
  forty: 40,
};
const word = n => Object.keys(WORDS).find(k => WORDS[k] === n) || '(no word for ' + n + ')';

const GB = b => (b / 1e9).toFixed(2);
const GB1 = b => (b / 1e9).toFixed(1);
const MB = b => (b / 1e6).toFixed(2);
const MB1 = b => (b / 1e6).toFixed(1);
const TPX = p => (p / 1e12).toFixed(3);
const COMMA = n => n.toLocaleString('en-US');

const SRC = readFileSync(join(DOCS, 'README.md'), 'utf8').split('\r\n').join('\n');
const EM = '—';

// Each entry anchors on enough surrounding prose to land exactly once. The expectation is a LIST, so a
// sentence carrying two figures is checked as one match rather than two patterns racing over the file.
const CHECKS = [
  ['folder count (callout)', /curates ([a-z-]+) sidecars chosen as evidence/,
    [word(top.n)]],
  ['folder count (headline)', /\*\*([A-Za-z-]+) masters, ([a-z-]+) sidecars\*\*/,
    [word(top.n).replace(/^t/, 'T'), word(top.n)]],
  ['masters / pixels / evidence', new RegExp('\\*\\*([\\d.]+) GB of masters ' + EM +
    ' ([\\d.]+) terapixels ' + EM + '\\s*\\ncarry ([\\d.]+) MB of checkable evidence\\*\\*'),
    [GB(top.bytes), TPX(top.px), MB(top.json)]],
  ['bytes-of-master ratio', /one byte of sidecar per ([\d,]+) bytes of master/,
    [COMMA(Math.round(top.bytes / top.json))]],
  ['largest master / total', /400 MB to \*\*([\d.]+) GB\*\* each, \*\*([\d.]+) GB\*\* in all/,
    [GB(top.largest), GB(top.bytes)]],
  ['archive count / bytes / JSON', /machine, (\d+) of them standing for ([\d.]+) GB of pixels in ([\d.]+) MB of JSON/,
    [String(arc.n), GB1(arcBytes), MB1(arc.json)]],
];

console.log('docs/sidecars: ' + top.n + ' sidecars, ' + GB(top.bytes) + ' GB, ' + TPX(top.px) +
  ' Tpx, ' + MB(top.json) + ' MB      archive: ' + arc.n + ', ' + GB1(arcBytes) + ' GB, ' + MB1(arc.json) + ' MB');

for (const [label, re, want] of CHECKS) {
  const all = [...SRC.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
  if (all.length !== 1) {
    ok(label, false, all.length === 0
      ? 'the sentence this reads is gone or reworded - re-anchor the pattern, do not delete the check'
      : 'stated in ' + all.length + ' places; one quantity, one statement');
    continue;
  }
  const got = all[0].slice(1, want.length + 1);
  const same = got.length === want.length && got.every((g, i) => g === want[i]);
  ok(label, same, same ? '' : 'README says [' + got.join(', ') + '], the folder says [' + want.join(', ') + ']');
}

console.log(fails ? '\nFAILED ' + fails + ' check(s) - re-sum the folder and correct the prose'
  : '\nthe prose matches the folder');
process.exit(fails ? 1 : 0);
