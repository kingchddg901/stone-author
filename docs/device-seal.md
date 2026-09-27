# The device seal

A master records the machine that made it. Some of that is useful to everyone and some of it identifies
the person, so the two are separated: the **class** is in the clear, the **identity** is sealed.

| in the clear | sealed |
| --- | --- |
| cores, memory as reported, dpr | the full user-agent string |
| architecture (`arm/64`) | the device model (`SM-T510`), from client hints |
| engine family (`android-chrome`) | the platform version |

The class is what an audit needs — a plan cannot be explained without the memory it budgeted against — and
it names nobody: `8 cores, dpr 1.33125` fits two different tablets, which is exactly why a whole evening
of measurements was attributed to the wrong one. The architecture stays in the clear because it decides
whether two machines may be farmed together, and because the UA's own platform token **lies** about it:
Chrome in desktop-site mode reports `X11; Linux x86_64` from an Android phone. The engine family stays
because it is already in the file's name.

## The method, in full

Nothing here is secret. The secret is the slab.

```
digest = SHA-256(the slab's exact bytes)          # JSON.stringify(serialize()), what Save writes
kid    = first 4 bytes of digest, hex             # travels in the clear
key    = SHA-256("stone-author/device/v1" || digest)
block  = AES-256-GCM(key, random 12-byte IV, JSON of the identity)
```

The ciphertext carries its authentication tag appended, which is what WebCrypto produces. The key is a
*second* digest over a domain string, so publishing `kid` hands out no part of the key it labels.

Read one back with the slab that made it:

```
node tools/tiff-meta.mjs --slab Hero_Psyker.json stone-65535-day-android-chrome-0926-161157.tif
```

Hand it the wrong slab and it says so — `wrong slab: sealed under 9718227f, that file is 53d74d95` —
rather than failing cryptically. Hand it a slab that differs by a single byte and AES-GCM refuses rather
than returning plausible rubbish.

## What this is and is not

It stops casual poking. Someone holding a master cannot read the device off it; someone holding the slab
can. That is the whole threat model, and the method is published because the method was never the secret.

It is **not** two-factor authentication, though it rhymes with it. Two artefacts are needed, but there is
**no revocation**: a slab that leaks once opens every master ever sealed under those bytes, for good.
Rotation runs forward only.

**It fails closed.** If the identity cannot be sealed — no `crypto.subtle`, which means any plain-http
origin, or any error at all — it is *withheld*, not written plainly. A master then reads
`device   withheld — no crypto.subtle on this origin`. The structure enforces that rather than diligence:
the identity is not assembled until after the seal is known to be possible.

## Rotating, and the one practice that matters

Changing the key is nearly free: **one space in the JSON is a different digest and the same picture.** The
render is a function of the slab's *content*; the key is a function of its *bytes*.

A slab is meant to be shared — it is the reproducible recipe, and that is the point of it. So sharing a
slab hands over the key to every master sealed under those bytes. If you intend to publish a slab and keep
your masters sealed:

**Publish the twin, seal under the original.** Add a space to the copy you post and keep the byte-exact
original private. Both render the identical picture; only one opens your masters. `kid` tells them apart,
so you can always check which file a master expects before you send anything.

Rotation runs forward only, so do this **before** the master you want sealed, not after. A master already
written stays under the bytes it was written with.

The slabs published in this repo's `gallery/` are the public twins. Masters rendered from them by anyone
else are sealed under bytes that are already public, so for those the lock is nominal — as it should be.
