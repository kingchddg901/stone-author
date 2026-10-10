// The material fork happens in ONE place, or it is not a fork.
//
// Stone Author is becoming Material Author: stone is path 1, wood is path 2, others follow. That works
// as a branch inside the single self-contained file - no dynamic loading, no build step, the published
// artifact stays one file - but only while the branch lives at exactly one seam: the field-to-face
// query. Everything downstream of the face is material-agnostic and must never learn which path it is
// on. The coat and light tier is surface optics. The layer and token spine, warp, masks, the tiled
// render, the master export, the device seal, i18n - none of them have any business asking.
//
// Tiling especially: herringbone, basketweave and Versailles are parquet patterns. They came from wood.
// The tile engine serves both materials and a material test inside it would be a bug, not a feature.
//
// So: `MATERIAL` is the discriminator, and it may only be read inside the marked seam. A deliberately
// narrow token, because the obvious alternative - grepping for 'stone' and 'wood' - is a false-positive
// machine: the app already has a VIEW called 'stone', and a slab records `"view":"stone"`.
//
// ARMED BEFORE IT IS NEEDED, on purpose. With one material there is nothing to branch on yet, so this
// passes trivially today and says so. It is a tripwire placed now because the cost of catching the
// first leak is nil and the cost of unpicking six of them later is not.
//
//   node tools/check-material-fork.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'app/stone-author.html';
const src = readFileSync(join(root, APP), 'utf8');
const lines = src.split(/\r?\n/);

const BEGIN = 'MATERIAL FORK BEGIN';
const END = 'MATERIAL FORK END';
const TOKEN = /\bMATERIAL\b/;

const begins = [], ends = [], uses = [];
lines.forEach((l, i) => {
  if (l.includes(BEGIN)) begins.push(i + 1);
  else if (l.includes(END)) ends.push(i + 1);
  else if (TOKEN.test(l)) uses.push(i + 1);
});

const fail = [];

if (!uses.length && !begins.length) {
  console.log(`material fork: OK — no material fork in ${APP} yet; the gate is armed for the first one`);
  process.exit(0);
}

// one seam, properly closed
if (begins.length !== 1 || ends.length !== 1)
  fail.push(`the seam must be marked exactly once: found ${begins.length} "${BEGIN}" and ${ends.length} "${END}". ` +
            `More than one fork is not a fork, it is a pattern spreading.`);
else if (ends[0] <= begins[0])
  fail.push(`"${END}" (line ${ends[0]}) comes before "${BEGIN}" (line ${begins[0]})`);
else {
  const [lo, hi] = [begins[0], ends[0]];
  const outside = uses.filter(n => n < lo || n > hi);
  if (outside.length)
    fail.push(`MATERIAL is read outside the seam (lines ${lo}-${hi}) at line(s) ${outside.join(', ')}. ` +
              `Whatever is downstream of the face does not get to know which material it is rendering.`);
  if (!uses.some(n => n > lo && n < hi))
    fail.push(`the seam is marked but reads MATERIAL nowhere inside it — an empty fork`);
}

if (fail.length) {
  console.error('material fork:\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log(`material fork: OK — ${uses.length} read(s) of MATERIAL, all inside the single seam ` +
            `at lines ${begins[0]}-${ends[0]}`);
