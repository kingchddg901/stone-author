// The device seal, reader side.
//
// A master keeps hardware CLASS in the clear and seals the device IDENTITY — the UA string and, on
// Chromium, the real model. The key is SHA-256 of the SLAB'S OWN BYTES: whoever holds the slab opens it,
// whoever holds only the TIFF does not. That is the whole threat model — casual poking, not an adversary.
//
// Keep this in step with sealDevice() in app/stone-author.html; tools/check-device-seal.mjs fails if the
// domain string or the key-id length drift apart, because a silent drift here reads as "wrong slab" for
// every master ever written.
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export const DEV_INFO = 'stone-author/device/v1';
export const KID_BYTES = 4;

// One slab file -> the label that says which file this is, and the key derived from it. The key is a
// SECOND digest over a domain string, so publishing the label hands out no part of the key.
//
// v1 hashes the file BYTES, name included. v2 drops the name first, because a name is a label the user
// edits freely and it should never have moved the key. Keep both: a v1 master can never be re-sealed.
//
// The v2 reader has to rebuild the exact string the app hashed, which means parse -> drop name ->
// stringify. That is only faithful if the parse/stringify round trip is byte-exact - JSON.parse hoists
// integer-like keys into numeric order - so it is CHECKED rather than assumed. A silent reorder would
// produce a wrong kid and read as 'wrong slab', which is the confusing failure this whole change is
// meant to remove.
// STRIPS ONLY THE NAME MEMBER, TEXTUALLY, leaving every other byte alone. Parsing and re-stringifying
// would have been simpler and would have destroyed the free rekey the design wants: one space in the
// JSON is a different digest, so a slab published in a gallery never opens a master sealed under a
// private twin of itself. A normalising reader makes formatting irrelevant and hands that away. The
// seal gate caught it, feeding a twin that differs by a single trailing space.
//
// serialize() emits name SECOND and always, so the prefix is deterministic: {"v":1,"name":<string>,
// and removing that member reproduces exactly what the app hashed. No regex - the string scan below
// respects backslash escapes in the name without an escape sequence of its own to get mangled.
function stripName(text) {
  const HEAD = String.fromCharCode(123) + String.fromCharCode(34) + ['v','":1,'].join('') +
               String.fromCharCode(34) + 'name' + String.fromCharCode(34) + ':' + String.fromCharCode(34);
  if (!text.startsWith(HEAD)) return null;                       // not a slab this build would have written
  const BSLASH = String.fromCharCode(92), QUOTE = String.fromCharCode(34);
  let i = HEAD.length;
  for (; i < text.length; i++) {
    if (text[i] === BSLASH) { i++; continue; }                   // an escaped character, including an escaped quote
    if (text[i] === QUOTE) break;
  }
  if (i >= text.length || text[i + 1] !== ',') return null;      // unterminated, or not followed by the next member
  return String.fromCharCode(123) + QUOTE + 'v' + QUOTE + ':1,' + text.slice(i + 2);
}

// v1 hashes the file BYTES, name included. v2 hashes them with the name member removed, because a name
// is a label the user edits freely and it should never have moved the key. Both are kept: a master
// already on disk can never be re-sealed, so the reader branches on dev.v.
export function keyFor(slabBytes, v = 1) {
  let bytes = slabBytes;
  if (v >= 2) {
    const stripped = stripName(Buffer.from(slabBytes).toString('utf8'));
    // A file this build would not have written cannot be reduced to the v2 input. Hash it as it came:
    // the kid will not match and the caller reports "wrong slab", which is the honest answer.
    bytes = stripped === null ? slabBytes : Buffer.from(stripped, 'utf8');
  }
  const slab = createHash('sha256').update(bytes).digest();
  return {
    kid: slab.subarray(0, KID_BYTES).toString('hex'),
    key: createHash('sha256').update(Buffer.concat([Buffer.from(DEV_INFO), slab])).digest(),
  };
}

// Returns { id } when it opens, { why } when it does not. Never returns a guess: AES-GCM authenticates,
// so a wrong slab fails loudly instead of yielding plausible rubbish.
export function openSeal(dev, slabBytes) {
  if (!dev || !dev.sealed) return null;
  if (!slabBytes) return { why: 'sealed — pass --slab <file.json> to open it' };
  let kid, key;
  try { ({ kid, key } = keyFor(slabBytes, dev.v || 1)); }
  catch (e) { return { why: e.message }; }
  if (dev.kid && dev.kid !== kid) return { why: `wrong slab: sealed under ${dev.kid}, that file is ${kid} (seal v${dev.v || 1})` };
  try {
    const blob = Buffer.from(dev.ct, 'base64');
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(dev.iv, 'base64'));
    d.setAuthTag(blob.subarray(blob.length - 16));                  // WebCrypto appends the tag
    const clear = Buffer.concat([d.update(blob.subarray(0, blob.length - 16)), d.final()]);
    return { id: JSON.parse(clear.toString('utf8')) };
  } catch (e) { return { why: 'would not open: ' + e.message }; }
}

// The write side exists only so the gate can seal a known identity and prove the reader opens it. The app
// writes these blocks with WebCrypto; this produces the same layout (12-byte IV, tag appended).
export function makeSeal(id, slabBytes, v = 2) {
  const { kid, key } = keyFor(slabBytes, v);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(id), 'utf8'), c.final(), c.getAuthTag()]);
  return { v, sealed: true, kid, iv: iv.toString('base64'), ct: ct.toString('base64') };
}
