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
digest = SHA-256(the slab bytes, name member removed)   # v2; v1 hashed the bytes as they stood
kid    = first 4 bytes of digest, hex             # travels in the clear
key    = SHA-256("stone-author/device/v1" || digest)
block  = AES-256-GCM(key, random 12-byte IV, JSON of the identity)
```

The ciphertext carries its authentication tag appended, which is what WebCrypto produces. The key is a
*second* digest over a domain string, so publishing `kid` hands out no part of the key it labels.

### v2 — the slab name is not part of the key

It used to be. A slab records a name, the name is a label you edit freely, and it sat inside the digest —
so renaming a slab made every master sealed under the old name unopenable, reporting `wrong slab` as
though you had handed it the wrong file.

That is not hypothetical. A picture loaded from a slab saved before names existed carried an empty name;
the first Save typed one in; and a day of masters could then only be opened by reconstructing the
original bytes with the name set back to empty. **v2 strips the name member and nothing else.**

The block records its own version, and the reader branches on it. **Rotation runs forward only** — a
master already written keeps the scheme it was written with, so both readers have to stay.

It strips the member *textually*, leaving every other byte alone. Parsing and re-serialising would be
simpler and would destroy the property the next section depends on: whitespace would stop mattering, and
with it the twin. The seal gate feeds a copy differing by one trailing space, and the first attempt at
v2 went red on exactly that.

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

Most slabs published in this repo's `gallery/` are public twins. Masters rendered from them by anyone
else are sealed under bytes that are already public, so for those the lock is nominal — as it should be.

`gallery/slabs/HERO-MASTER-sealkey.json` is **not** a twin: it is the exact key to the 2026-09-27 master
set, published deliberately. Those masters are 400–800 MB each and are not distributed, so there is
nothing in circulation for the key to unlock — the lock guards files that only ever existed on one desk.
What is published is the evidence extracted from them, and the slab is there so a reader can render the
same picture rather than take the figures on trust.

### v3 — only what can reach the picture is in the key

`serialize()` carries the authoring state and the **session** state in one object, and v2 removed only
the name. v3 removes the rest of the session half, because none of it can change a pixel:

| out of the key (v3) | why it cannot matter |
| --- | --- |
| `name` | a label, removed in v2 |
| `tool` | which tool is armed |
| `view` | the offline render reads it nowhere |
| `guidesOn` | likewise |
| `activeLayer` | where the *next* mark would land |
| `nextId` | the id that mark would get |
| `NEXT` | the settings it would be drawn with |

Everything that reaches the exported picture stays in: `fam`, `layTiles`, `G`, `T`, `layers`, `soloLay`,
`OVR`, `OVR_uv`, `perItem`, `hidden`, `folders`, `marks`. `soloLay` and `layTiles` look like UI and are
not — soloing a layer or laying tiles changes what is rendered.

**Why this had to change rather than be documented around.** `deserialize()` deliberately forces the tool
to `move` on load, so that opening a slab never leaves a drawing tool armed over a picture the user has
just said they want unchanged. That is right for the hand and fatal for the key: it means a master
rendered from a loaded slab was *always* sealed under a serialisation the saved slab could not produce.
Not a trap you could avoid by being careful — a guarantee. The 2026-10-01 masters are the proof: sealed
under `df62304e` where their own slab hashes to `19d7bd46`, and the entire difference is `"tool":"moon"`
against `"tool":"move"`.

The seven are removed **textually**, leaving every other byte alone, so the rotation trick above survives:
a published twin differing by one space still fails to open a master sealed under the private original.
Parsing and re-serialising would have been simpler and would have normalised that away.

Rotation runs forward only, as always. v1 and v2 readers stay, a master keeps the scheme it was written
with, and the masters already sealed under session state remain openable only by reproducing that state —
which is cheap when the drift is one enumerable field and impossible otherwise.

### The other direction is harder, and it has already caught one set

Publishing a twin and sealing under the original works, because you control the original's bytes. Sealing
**under a slab you publish** does not work the same way, and the reason is in the method above: the digest
is over `JSON.stringify(serialize())` — the app's serialisation at export time — with the `name` member
removed *and nothing else*. The file on disk is not the input. It is only one way of reproducing those
bytes, and it stops matching the moment the app's state does.

What `serialize()` carries alongside the picture: `tool`, `view`, `guidesOn`, `layTiles`, `soloLay`,
`activeLayer`, `nextId`, and the whole `NEXT` block of tool parameters. **None of those change a pixel.**
Every one of them changes the key.

Measured on 2026-10-01. Two masters were rendered from a copy of `HERO-MASTER-sealkey.json` that is
byte-identical to the published one — same SHA-256 — and sealed under `df62304e` rather than the slab's
own `19d7bd46`. The difference between the key that was used and the key that was published is one field:

```
"tool":"moon"     the slab as saved and published
"tool":"move"     the serialisation at export, after the Move tool was selected
```

**Recovery is cheap when the drift is enumerable, and impossible when it is not.** `kid` is four bytes and
travels in the clear, so candidate serialisations can be *tested* without decrypting anything: 320
combinations of tool x view x `guidesOn` x `layTiles` found that one in a second. The same week's other
pair sealed under `40e0022e`, which no combination of those four fields reaches from any published slab —
its drift is in `activeLayer`, `nextId` or a `NEXT` slider, which is not a searchable space. Those two
masters cannot be opened, and rotation runs forward only, so nothing can be done about it now.

**The practice, then.** If a master is meant to be openable with a slab you hand out, Save the slab and
export **without touching a tool in between** — or treat the slab you exported from as the key and keep
it, rather than assuming the one on disk still matches. `kid` is the check: compare the master's against
the slab's before relying on either.
