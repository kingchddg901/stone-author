// THE APP'S COPY OF EVERY LOCALE MUST BE THE ONE IN i18n/.
//
// The app carries all fifteen packs inline so that the single file is a single file in every
// language, not just in English. i18n/ stays the editable source. The danger that creates is precise
// and silent: `check-i18n` reads the FILES for the packs, so a translator's edit lands in the file,
// passes every i18n check, and never reaches a reader — the gate that should have caught it is the
// one looking at the wrong copy.
//
// So: regenerate the block and compare. No tolerance, no normalising beyond line endings. This is the
// same arrangement as the shader in check-gpu-sync.mjs, for the same reason.
//
// IT ALSO CHECKS THE OTHER DIRECTION, which the shader gate does not need: a pack inlined that has no
// file, or a file with no inline pack. The first ships a language nobody can edit; the second is the
// case above, and is the one that actually happens.
//
//   node tools/check-i18n-sync.mjs
//   node tools/check-i18n-sync.mjs --ablate   prove the comparison can fail
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generate, currentBlock, langs } from './sync-i18n.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NL = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + NL;
const src = readFileSync(join(ROOT, 'app', 'stone-author.html'), 'utf8').split(CRLF).join(NL);

const have = currentBlock(src);
if (have === null) {
  console.error('i18n-sync: the app has no I18N-SYNC block at all.');
  console.error('  Every language but English would be missing from the file. Run: node tools/sync-i18n.mjs');
  process.exit(1);
}
const want = generate();

// ---- the two directions, named before the byte compare so a gap reads as a gap ------------------
const onDisk = langs();
const inline = [...have.matchAll(/^    "([a-zA-Z-]+)": JSON\.parse\(/gm)].map(m => m[1]);
const missing = onDisk.filter(l => !inline.includes(l));
const extra = inline.filter(l => !onDisk.includes(l));
let fail = 0;
for (const l of missing) { fail++; console.error('  i18n/' + l + '.json has no inline pack — that language cannot load from the file alone'); }
for (const l of extra) { fail++; console.error('  the app inlines "' + l + '" but i18n/' + l + '.json does not exist — nobody can edit it'); }

// ---- ABLATION. A comparison that cannot fail is not a comparison ---------------------------------
if (process.argv.includes('--ablate')) {
  const broken = have.replace(/("[a-z]{2}[a-zA-Z-]*": JSON\.parse\(")/, '$1zzz');
  if (broken === have) { console.error('  ablate: could not perturb the block — this gate is stale'); process.exit(1); }
  console.log(broken === want
    ? '  ablate: FAILED — a perturbed block still compared equal'
    : '  ablate: a one-character change to a pack is caught');
  process.exit(broken === want ? 1 : 0);
}

if (have === want && !fail) {
  console.log('i18n-sync: OK — the app’s ' + inline.length + ' inline pack(s) match i18n/');
  process.exit(0);
}
if (fail) process.exit(1);

// SAY WHICH LANGUAGE, because one line per pack is the whole point of the layout.
const a = have.split(NL), b = want.split(NL);
let i = 0;
while (i < a.length && i < b.length && a[i] === b[i]) i++;
const which = (b[i] || a[i] || '').match(/^    "([a-zA-Z-]+)"/);
console.error('i18n-sync: the app’s copy has DRIFTED from i18n/.');
console.error('  app has ' + a.length + ' lines, i18n/ generates ' + b.length);
console.error('  first difference at line ' + (i + 1) + ' of the block' + (which ? ', in "' + which[1] + '"' : ''));
if (which) {
  const x = a[i] || '', y = b[i] || '';
  let j = 0; while (j < x.length && j < y.length && x[j] === y[j]) j++;
  console.error('    app:   …' + JSON.stringify(x.slice(Math.max(0, j - 40), j + 40)));
  console.error('    i18n/: …' + JSON.stringify(y.slice(Math.max(0, j - 40), j + 40)));
}
console.error('');
console.error('  i18n/ is the source. If the files are right:  node tools/sync-i18n.mjs');
process.exit(1);
