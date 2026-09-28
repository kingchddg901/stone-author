// THE GATE FOR ANY REFACTOR THAT TOUCHES STATE.
//
// `inputs` in a master is a hash over the picture AND the light. It is what makes two masters
// comparable, and the 2026-09-28 set is seven black-light masters that all read a98ab1f5. If a refactor
// moves the SHAPE of the state - a number where a string was, a key a token default filled in, an object
// that now serialises in another order - the hash moves and every one of those masters is orphaned. No
// fix afterwards recovers it, because a master keeps the signature it was written with.
//
// So this computes the signature the app would produce, from a slab file, WITHOUT rendering. It is the
// cheap half of the check: run it before touching anything, and after every change.
//
//   node tools/state-sig.mjs gallery/slabs/HERO-MASTER-sealkey.json
//
// It mirrors renderSig() in the app. If the app's version changes, this must be changed with it - and
// that is the point: a silent divergence here is the failure it exists to catch, so it prints what it
// hashed and the field order it used.
//
// The other half is a real render: export at any width and read `inputs` with tiff-meta. Width does not
// enter the hash, so 512 proves as much as 65535 and takes seconds - confirmed across nine widths, which
// all carry inputs a98ab1f5 and seal kid 47238f77.
//
// KNOWN SIGNATURES, to check a refactor against:
//
//   HERO-MASTER-sealkey.json   daylight 2259e26a   black light a98ab1f5   (the published set)
//   the app's DEFAULT state    daylight bc019919   black light 37d2ca86   (12,569 bytes, 4 marks)
//
// The DEFAULT state is the better target for a refactor, and not only because it is 42x smaller than the
// hero slab. A loaded slab overwrites the defaults; the default state IS the defaults, which is exactly
// where a token layer would silently fill in a key that was never there. Read it from the running app:
// localStorage["stone-author:autosave:v1"], hashed with the same FIELDS below.
import { readFileSync } from 'fs';

const NEWLINE = String.fromCharCode(10);

function crc32(u8) {                                     // the app's own, byte for byte
  let crc = ~0;
  for (let i = 0; i < u8.length; i++) {
    crc ^= u8[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

// The FIELD ORDER is load-bearing: JSON.stringify writes keys in insertion order, so a reordering here
// silently produces a different hash for identical state. Kept in the app's order deliberately.
const FIELDS = ['fam', 'G', 'T', 'layTiles', 'layers', 'soloLay', 'OVR', 'OVR_uv', 'perItem', 'hidden', 'marks'];

export function stateSig(slab, lightSpectrum, uvMode, spotOn) {
  const o = {};
  for (const f of FIELDS) o[f] = slab[f];
  o.light = [lightSpectrum, uvMode, spotOn];
  return crc32(new TextEncoder().encode(JSON.stringify(o))).toString(16);
}

// RUN AS A SCRIPT ONLY. stateSig is imported by tools/ablate-state-sig.mjs, and without this guard the
// CLI below fired on import and exited 2 before the ablation ran a single case. The same trap is why
// findMeta lives in tools/lib/find-meta.mjs rather than inside tiff-meta.mjs.
const DIRECT = process.argv[1] && process.argv[1].split(String.fromCharCode(92)).join("/").endsWith("/state-sig.mjs");
if (!DIRECT) { /* imported for stateSig; nothing below runs */ } else {

const path = process.argv[2];
if (!path) {
  console.error('usage: node tools/state-sig.mjs <slab.json>');
  process.exit(2);
}
const slab = JSON.parse(readFileSync(path, 'utf8'));
const missing = FIELDS.filter(f => slab[f] === undefined);

// REFUSE A FILE THAT IS NOT A SLAB, rather than hashing its absence. Found by pointing this at the
// repo's own fixtures: test-slabs/stylus-*.json are PEN CALIBRATION recordings, and because every
// field below is absent in both, both hashed to the SAME pair - 2fa83c29 / a47b6fb6 - which is the
// hash of an object of eleven undefineds. Two unrelated files, one signature, printed with a straight
// face. A gate that answers where it should refuse is worse than no gate, and the failure it would
// hide is the one that matters most: a serialize() that stopped writing these fields reads as a
// SIGNATURE, not as an alarm.
if (missing.length === FIELDS.length) {
  console.error(path + NEWLINE + '  NOT A SLAB. None of the hashed fields are present, so there is no state here to sign.' +
    NEWLINE + '  (A pen-calibration recording or a metadata sidecar will do this. Pass a saved .json slab.)');
  process.exit(2);
}

const day = stateSig(slab, 0, false, false);
const black = stateSig(slab, -1, true, false);

console.log(path);
console.log('  fields hashed  ' + FIELDS.join(', '));
if (missing.length) console.log('  PARTIAL SLAB, absent: ' + missing.join(', ') + '   (absent hashes as undefined, which is itself a value)');
console.log('  daylight     ' + day + (day === '2259e26a' ? '   matches the published set' : ''));
console.log('  black light  ' + black + (black === 'a98ab1f5' ? '   matches the published set' : ''));

// A named expectation, so this can be run in CI or by hand and MEAN something rather than print numbers.
const want = process.argv[3];
if (want) {
  const ok = (black === want || day === want) && missing.length === 0;
  if (missing.length) console.log('  a field is ABSENT, so the shape has moved whatever the hash says');
  console.log('  expected ' + want + ': ' + (ok ? 'MATCHED' : 'NOT FOUND — the state shape has moved'));
  process.exit(ok ? 0 : 1);
}

}
