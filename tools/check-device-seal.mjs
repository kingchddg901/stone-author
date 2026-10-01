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
import { openSeal, makeSeal, keyFor, DEV_INFO, KID_BYTES } from './lib/device-seal.mjs';

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
// THE APP AND THE READER MUST AGREE ON THE SCHEME VERSION. This file already warns that a silent
// drift reads as "wrong slab" for every master ever written; the version is a second way to drift,
// and it arrived with the v2 rotation. makeSeal defaults to the version the reader considers current,
// and the app stamps a literal, so the two are compared directly.
const appV = app.match(/devSeal = [{] v: (\d+), sealed: true/);
if (!appV) fail.push('the app no longer stamps a seal version literal, so the reader cannot tell which scheme a master used');
else if (+appV[1] !== makeSeal({ ua: 'x' }, slab).v)
  fail.push('the app seals as v' + appV[1] + ' but the reader writes v' + makeSeal({ ua: 'x' }, slab).v + ': one of them is rotating without the other, and every new master would read as the wrong slab');
// AND THE NAME MUST BE OUT OF THE KEY. That is what v2 IS. If the hash goes back to hashing the whole
// of serialize(), renaming a slab silently orphans every master sealed under the old name.
// AND THE SESSION STATE MUST BE OUT OF IT TOO. That is what v3 IS. serialize() carries the authoring
// state and the session state together; the session half moves without a pixel changing, and
// deserialize() FORCES the tool to `move` on load, so a slab that is merely opened already hashes
// differently from the file on disk. If any of these seven returns to the key, a master rendered from a
// published slab stops being openable with it - which is what happened to the 2026-10-01 set.
const destr = app.match(/const [{]([^}]*)[}] = serialize[(][)];/);
if (!destr) fail.push('the seal no longer destructures serialize(), so what is in the key cannot be read from the source');
else for (const k of ['name', 'tool', 'view', 'guidesOn', 'NEXT', 'nextId', 'activeLayer'])
  if (!destr[1].includes(k + ':'))
    fail.push(k + ' is back inside the seal key: it cannot change the exported picture, so a master would be sealed under state the saved slab does not reproduce');

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

// v3 BEHAVIOUR, against a slab shaped like a real one. Session fields must be inert; anything that
// reaches the picture must not be. Both directions, because a key that ignores everything is as broken
// as one that ignores nothing.
const real = o => JSON.stringify(Object.assign({
  v: 1, name: 'n', fam: 'granite', tool: 'moon', view: 'stone', layTiles: false, guidesOn: false,
  G: { subsurface: 0.05 }, T: {}, NEXT: { gauge: 1 }, nextId: 644,
  layers: [{ key: 'base', on: true }], soloLay: null, activeLayer: { major: 'major#6' },
  OVR: {}, OVR_uv: {}, perItem: {}, hidden: [], folders: [], marks: [1, 2, 3],
}, o));
const kid3 = s => keyFor(Buffer.from(s, 'utf8'), 3).kid;
const baseKid = kid3(real({}));
for (const [k, v] of [['tool', 'move'], ['view', 'tile'], ['guidesOn', true], ['nextId', 999],
                      ['NEXT', { gauge: 2 }], ['activeLayer', { major: 'major#1' }], ['name', 'other']])
  if (kid3(real({ [k]: v })) !== baseKid)
    fail.push('changing ' + k + ' moved the v3 key, and it cannot change a pixel - a master would not open with its own slab');
for (const [k, v] of [['fam', 'carrara'], ['layTiles', true], ['soloLay', 'web'],
                      ['G', { subsurface: 1 }], ['marks', [1, 2, 4]], ['layers', [{ key: 'base', on: false }]]])
  if (kid3(real({ [k]: v })) === baseKid)
    fail.push('changing ' + k + ' did NOT move the v3 key, but it changes the picture - two different slabs would share a key');
// the rotation trick has to survive: one space anywhere still rekeys.
if (kid3(real({}) + ' ') === baseKid)
  fail.push('an extra space did not move the v3 key - the digest has stopped being over the bytes, and a published twin would open its private original');

if (fail.length) { console.error('device seal:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log(`device seal: OK — ${entries.length} export path(s) seal, identity out of the clear, ` +
            `right slab opens, one extra space does not`);
