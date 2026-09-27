// Does the device seal hold, and can this check go red?
//
// Four ways it can fail, each with the input that fires it named in the message:
//   1  an export path that does not seal        -> that master ships the UA in the clear
//   2  the UA back in the clear in expMeta      -> the seal is decoration
//   3  the app and the reader drift apart       -> every master reads as "wrong slab" forever
//   4  a wrong slab that opens, or opens into rubbish -> the lock is not a lock
//
// Checks 1-3 read the app's source. Check 4 runs the real reader — tools/lib/device-seal.mjs, the same
// module tiff-meta uses — against a seal made for a known identity, so it is not testing a copy of itself.
import { readFileSync } from 'fs';
import { openSeal, makeSeal, DEV_INFO, KID_BYTES } from './lib/device-seal.mjs';

const app = readFileSync('app/stone-author.html', 'utf8');
const fail = [];

// 1 — every export entry seals. The entry is the line that claims the export lock; there are three.
const entries = app.match(/exporting = true;[^\n]*/g) || [];
if (entries.length < 3) fail.push(`found ${entries.length} export entr${entries.length === 1 ? 'y' : 'ies'}, expected at least 3 — has one been renamed?`);
// It STARTS the seal and does not wait for it. Awaiting here yielded to the event loop before the export
// disabled its own controls, so the width menu stayed live on a render already under way — caught by the
// browser harness, not by this gate, which is why the harness owns the ordering and this owns the wiring.
for (const [i, line] of entries.entries())
  if (!/sealing = sealDevice\(\)/.test(line)) fail.push(`export entry ${i + 1} does not start the device seal: ${line.trim()}`);
if (/await sealDevice\(\)/.test(app)) fail.push('an export awaits sealDevice() inline: that yields before the controls lock');
// and every metadata build must have waited for it, or the block is missing from that master
const metaCalls = (app.match(/expMeta\(\{/g) || []).length;
const awaited = (app.match(/await sealing;/g) || []).length;
if (awaited < metaCalls) fail.push(`${metaCalls} metadata builds but only ${awaited} await the seal — one master would record no device block`);

// 2 — the identity is not in the clear. expMeta may carry cores/mem/dpr/engine/arch; not the UA.
const meta = app.slice(app.indexOf('const expMeta = o =>'), app.indexOf('function zipStore'));
if (/\bua:\s*navigator\.userAgent/.test(meta)) fail.push('expMeta records ua: navigator.userAgent in the clear — the seal hides nothing');
if (!/\bdev:\s*devSeal\b/.test(meta)) fail.push('expMeta does not record the sealed block (dev: devSeal)');

// 2b — FAIL CLOSED. The identity must be assembled only after the seal is known to be possible, and every
// unsealed block must declare itself withheld rather than carry the identity. An earlier cut wrote it in
// the clear on a non-secure origin; that is what this refuses to let back in.
const body = app.slice(app.indexOf('async function sealDevice()'), app.indexOf('const expMeta = o =>'));
const uaHits = (body.match(/navigator\.userAgent/g) || []).length;
const tryAt = body.indexOf('try {');
if (uaHits !== 1) fail.push(`sealDevice mentions navigator.userAgent ${uaHits} times, expected once`);
// Test the absence FIRST. Comparing against indexOf's -1 is how this check passed an ablation that
// deleted the try outright: "before position -1" is false for everything.
if (tryAt < 0) fail.push('sealDevice has no try block — nothing makes the withheld block stand on a throw');
else if (uaHits === 1 && body.indexOf('navigator.userAgent') < tryAt)
  fail.push('the identity is assembled before the seal is known possible — a throw would leave it in the clear');
for (const m of body.matchAll(/devSeal = \{([^}]*)\}/g)) {
  const lit = m[1].trim();
  if (!/sealed:\s*false/.test(lit)) continue;
  // Token split, not a word-boundary regex: a \b written through a generator becomes 0x08 and the
  // check dies silently while still LOOKING right in a terminal. This form cannot be mangled that way.
  if (lit.split(/[^\w$]+/).includes('id')) fail.push('FAILS OPEN: an unsealed block carries the identity: ' + lit);
  if (!/withheld/.test(lit)) fail.push('an unsealed block does not declare itself withheld: ' + lit);
}

// 3 — the app and the reader agree on the two constants that cannot drift silently.
if (!app.includes(`'${DEV_INFO}'`)) fail.push(`the app does not use the reader's domain string ${DEV_INFO} — every master would read as "wrong slab"`);
const kid = /slab\.slice\(0,\s*(\d+)\)/.exec(app);
if (!kid) fail.push('cannot find the key-id derivation in the app');
else if (+kid[1] !== KID_BYTES) fail.push(`key-id is ${kid[1]} bytes in the app and ${KID_BYTES} in the reader`);

// 4 — the lock locks. One slab opens it; a slab differing by ONE SPACE does not, and says so.
const slab = Buffer.from(JSON.stringify({ v: 1, marks: [1, 2, 3] }), 'utf8');
const twin = Buffer.from(slab.toString('utf8') + ' ', 'utf8');            // the free rekey: one space
const id = { ua: 'Mozilla/5.0 (Linux; Android 10; K) Chrome/154', model: 'SM-T510', platformVersion: '13' };
const dev = makeSeal(id, slab);

const right = openSeal(dev, slab);
if (!right || !right.id) fail.push('the right slab did not open the seal: ' + (right && right.why));
else if (right.id.model !== id.model || right.id.ua !== id.ua) fail.push('opened, but not into what was sealed');

const wrong = openSeal(dev, twin);
if (!wrong || wrong.id) fail.push('a slab differing by one space OPENED the seal — the key is not the bytes');
else if (!/wrong slab/.test(wrong.why)) fail.push('the wrong slab failed, but not as a wrong slab: ' + wrong.why);

// and with the label stripped, so the kid shortcut cannot be what is doing the work: AES-GCM must refuse.
const unlabelled = Object.assign({}, dev); delete unlabelled.kid;
const forced = openSeal(unlabelled, twin);
if (!forced || forced.id) fail.push('without the key-id, the wrong key still decrypted — GCM is not authenticating');

// no seal, nothing to open: null, never a throw.
if (openSeal(null, slab) !== null || openSeal({ v: 1, sealed: false }, slab) !== null) fail.push('an unsealed block should read as null');
// sealed but no slab to hand it: a reason, not a crash.
if (!(openSeal(dev, null) || {}).why) fail.push('sealed with no slab should explain itself');

if (fail.length) { console.error('device seal:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log(`device seal: OK — ${entries.length} export path(s) seal, identity out of the clear, ` +
            `right slab opens, one extra space does not`);
