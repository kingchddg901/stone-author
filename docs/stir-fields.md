# Stir fields: which drag, and how many

Status: **built.** Ranges shipped in 2026.10.17.136; the per-render field landed in .143.

A glass slab has one stir field. Every `stir` in the op list applies it, so a chain with three stirs
drags the sheet through the same displacement three times. Giving each stir a field of its own is the
difference between three folds and one fold done thrice.

## What is there now

`glassWarp(H, moons)` sums **every** moon mark's displacement into a single lattice:

    const moons = marks.filter(m => m.kind === 'moon');
    F.S = glassWarp(H, moons);

One filter, one field, built once per render. `glassUnform` then reads that same `F.S` at every `stir`
it meets. The lattice is 321 x ny (161 when the global current is off) of paired `Float32`, about half
a megabyte at the sizes in use, and the moons' cost is clipped by their radius, so building it is
cheap relative to painting with it.

The reference slab carries **twelve moons and three stirs**. All twelve sum into one field; all three
stirs apply it.

## What the measurements say

Each stir costs about a third of the remaining headroom, and a fourth falls off a cliff — measured at
2048 against a four-times-larger reference:

| chain | corr |
|---|---|
| no stirs at all (11 ops) | 0.9981 |
| minus the stir at position 7 | 0.9962 |
| minus the stir at position 5 | 0.9945 |
| minus the stir at position 1 | 0.9874 |
| **as authored, 3 stirs** | **0.9604** |
| plus a fourth stir | **0.6573** |

Nothing else in the list behaves like this. Adding a whole blow, spin or roll *improves* the number;
only a stir takes it down. That is the case for the change, and it is also the case for being careful
with it — a stir is the only op that has ever been expensive.

**And the field's strength scales with how many moons are in it.** Rendering the same chain with only
a quarter of the moons:

| field | corr | |
|---|---|---|
| all twelve moons | 0.9604 | what ships today |
| moons 1-4 | 0.9993 | |
| moons 5-8 | 0.9922 | |
| moons 9-12 | 0.9967 | |

Each quarter is a far gentler fold. They are also genuinely *different* folds: the 1-4 field and the
5-8 field disagree on **62.6%** of pixels.

So splitting twelve moons three ways would give three different drags, each in the 0.99 class, in
place of one 0.96 drag applied three times. More variety for less fineness is the whole proposition,
and the two tables above are the reason to believe it.

**What those numbers do NOT show.** Each subset above was applied by all three stirs, because there is
no way yet to give one stir a different field from another. So this measures *field strength against
moon count* and *difference between subsets*, which is the premise; it does not measure the proposed
arrangement. Nothing here should be quoted as the result of the feature.

## Three stirs is not quite an iteration

Worth stating precisely, because the obvious framing is slightly wrong. The stirs do not iterate one
map: blows and spins sit between them, so each stir drags a sheet that has already been rescaled and
turned since the last one. That is why removing the first stir costs more than removing the third
(0.9874 against 0.9962) — position matters, and it would not if they were pure repeats.

What *is* identical is the displacement, in slab coordinates. The same spatial pattern of pushing is
applied to three different sheets. Varying the pattern is what decorrelates the folds; the ops between
them already vary the sheet.

## The design question, which is the whole of it

The maths is easy — build k lattices instead of one, hand each stir an index. **Which moons belong to
which stir is the hard part**, and it is a question about authoring rather than about rendering.

- **A number on each.** The stir row takes a field number; each moon mark carries the same. Explicit,
  cheap, and the op rows already grew a sub-row for exactly this kind of field. Costs the author two
  places to keep in agreement.
- **Draw into the selected stir.** Selecting a stir row makes it the target, and moons drawn while it
  is selected belong to it. The nicest to use and the largest change: it needs a selection concept the
  op list does not have, and a way to see which moons are whose.
- **In order.** Stir one takes the first moon, stir two the second. No interface at all, and wrong for
  the slab that exists — twelve moons and three stirs is not a pairing, and every slab on disk would
  change meaning.

The first is the one to build first, because it can ship without deciding the second, and the second
can be added over it later as a way of *setting* the number rather than a different model.

## What must not change

- **A slab with no grouping must render exactly as it does today.** Ungrouped means every moon in every
  stir's field, which is the current behaviour stated as a rule rather than as an absence. The glass
  field holds a label, so a coordinate that moves by one part in 10^15 crosses a ribbon boundary and
  changes a pixel by 130 levels — there is no small error available, and the test is byte-identity on
  a real slab rather than a tolerance.
- **The field is built per render, not per tile.** It must stay that way or a 40,960-tile master pays
  for it 40,960 times, and cross-tiling byte-identity depends on every tile seeing the same lattice.
  This was a requirement the code did not meet for as long as it was written down: `glassWarp` sat
  inside `paintGlassContent`, which IS the per-tile painter, so the reference slab rebuilt four
  lattices on every pass. Measured at a 256 px tile, where almost nothing is painted: **1,542 ms
  before, 137 ms after**. Now memoised on a key covering everything the field reads, and gated in
  `tools/check-op-origin.mjs` - including that the memo is held on a const object's PROPERTY rather
  than a `let`, because a module-scope binding written from the painter context-allocates in V8 and
  cost 20 seconds a tile with byte-identical output.
- **Memory is k times one lattice.** Half a megabyte each is nothing at three; it is worth a cap
  before it is worth nothing at thirty.

## Risks worth naming before starting

- **A moon in no group is invisible**, and silently. Whatever the rule, an unassigned moon has to go
  somewhere or be reported — a mark that is drawn and does nothing is the shape of a bug nobody finds.
- **It makes stirs cheaper, which means more of them.** The fourth stir cost 0.30 of correlation; four
  gentle stirs may cost far less, and the author will then reach for a fifth. The carry warning is
  what keeps that honest, and this change makes that warning more load-bearing rather than less.
- **`renderSig` must take the grouping**, or two slabs with identical ops and different groupings share
  a signature and the archive cannot tell them apart.
- **It is glass only.** Nothing else has a stir.

## Staging

1. **One field per group, with every moon in group zero.** The gate is byte-identity against the
   current build on a real slab — if that holds, the whole mechanism is in place and inert.
2. **The number on the stir row and on the mark**, so a grouping can be authored at all.
3. **Measure the premise properly**: the same slab, twelve moons in one field against twelve split
   three ways, at matched op counts. The tables above predict roughly 0.96 to something near 0.99;
   if it does not land there, the reasoning above is wrong and should be rewritten rather than
   explained.
4. **Selection as a way to set the number**, if step 3 earns it.
