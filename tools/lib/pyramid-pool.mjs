// AN ORDERED POOL: n tasks, j at a time, EMITTED IN INDEX ORDER whatever order they finish in.
//
// WHY THIS IS ITS OWN FILE, AND WHY IT IS THE PART UNDER TEST. What it protects is not speed, it is
// WHERE a tile lands. add-overviews assigns a tile's offset at the moment it writes it, so the
// TileOffsets array is a RECORD OF WRITE ORDER rather than a plan. Emit tile 7 before tile 6 and the
// file still holds every byte - in the wrong place, under a directory that says otherwise, inside a
// 44 GB master that was appended to in place. No gate downstream would notice: the TIFF is valid, the
// parts all checksum, and a viewer simply shows a scrambled overview.
//
// So the ordering lives here, away from the worker plumbing, where a probe can drive it with results
// that arrive deliberately backwards. `probe-pyramid-order.mjs` does exactly that, and its ablation is
// a pool that emits on arrival - which must come out in a different order on the same schedule, or the
// test cannot tell the two apart.
//
// build(i) may return a promise; at most j are in flight. emit(i, value) is called with i strictly
// 0, 1, 2, ... and is awaited, so a caller may write synchronously or not.
export async function runPool({ n, jobs, build, emit }) {
  const J = Math.max(1, jobs | 0);
  const live = new Map();          // index -> in-flight promise
  const ready = new Map();         // index -> finished value, waiting its turn
  let next = 0, issued = 0, peak = 0;

  while (next < n) {
    while (issued < n && live.size < J) {
      const i = issued++;
      const p = Promise.resolve().then(() => build(i)).then(
        v => ({ i, v }),
        e => {
          // CARRY THE INDEX OUT WITH THE FAILURE. A worker that dies on one tile out of 54,617 is
          // worth naming: by this point the caller has already destroyed the tail of the file, and
          // the operator needs to know whether to --restore or to go and look at that tile.
          const w = new Error('task ' + i + ': ' + ((e && e.message) || e));
          w.task = i; w.cause = e;
          throw w;
        });
      p.catch(() => {});           // a late rejection, after the race already settled, is not unhandled
      live.set(i, p);
    }
    if (live.size > peak) peak = live.size;
    const { i, v } = await Promise.race(live.values());
    live.delete(i);
    ready.set(i, v);
    while (ready.has(next)) {
      const val = ready.get(next);
      ready.delete(next);
      await emit(next, val);
      next++;
    }
  }
  return { peak };
}
