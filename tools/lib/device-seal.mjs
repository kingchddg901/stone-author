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
export function keyFor(slabBytes) {
  const slab = createHash('sha256').update(slabBytes).digest();
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
  const { kid, key } = keyFor(slabBytes);
  if (dev.kid && dev.kid !== kid) return { why: `wrong slab: sealed under ${dev.kid}, that file is ${kid}` };
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
export function makeSeal(id, slabBytes) {
  const { kid, key } = keyFor(slabBytes);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(id), 'utf8'), c.final(), c.getAuthTag()]);
  return { v: 1, sealed: true, kid, iv: iv.toString('base64'), ct: ct.toString('base64') };
}
