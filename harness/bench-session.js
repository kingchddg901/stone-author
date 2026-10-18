// A BENCH THAT KNOWS WHEN ITS OWN INSTRUMENT HAS DRIFTED.
//
// Every render comparison in this project is bracketed by a control - the solo baseline pass, which
// is the same work on one worker in both runs, so a machine that changed announces itself instead of
// being read as a result. The in-page bench had no such thing, and it cost a wrong finding: a memo
// written as a `let` measured 46,941 ms against 25,503 for the same memo on a property, and the whole
// difference was Chrome's renderer degrading across repeated page loads in one session. The same
// build, unchanged, measured 34,782 ms late in a session and 15,648 immediately after opening a fresh
// tab. Nothing but the renderer process was different.
//
// SO: NO ABSOLUTE BASELINE, because one would be machine-specific and would rot. Instead the same
// reference render is taken before the measurements and again after, and the drift between them is
// reported. A session that drifted more than DRIFT_WARN cannot support a comparison and says so.
//
// AND INTERLEAVE WHEREVER POSSIBLE. Two variants measured A B A B A B survive a monotone drift that
// would ruin AAA BBB - the drift lands on both sides. Use runInterleaved when the variants can live
// in one page; use ref-bracketing when they cannot, which is the case for two different builds.
//
//   <script src="/harness/bench-session.js"></script>
//   const B = benchSession(window.__sa);
//   await B.bracket('what I am measuring', () => { ...render... });
(function (root) {
  const DRIFT_WARN = 0.05;                 // 5%: smaller than any effect worth reporting
  const REF = { W: 65535, x: 16384, y: 8192, px: 512, bleed: 4 };

  root.benchSession = function benchSession(sa) {
    if (!sa || !sa.renderOneTile) throw new Error('bench-session: needs the __sa hook');

    // THE REFERENCE IS SMALL ON PURPOSE. It has to be cheap enough to run three or four times around
    // a measurement without dominating it, and it still pays the same per-tile fixed costs and walks
    // the same per-pixel path, which is what degrades.
    const ref = () => {
      const t = performance.now();
      const c = sa.renderOneTile(REF.W, REF.x, REF.y, REF.px, REF.px, REF.bleed);
      const ms = performance.now() - t;
      c.width = 1; c.height = 1;
      return ms;
    };

    const yield_ = () => new Promise(r => setTimeout(r, 0));

    return {
      ref,

      // Run `fn` with a reference render either side. Returns the measurement AND whether the
      // session can be trusted to have produced it.
      async bracket(label, fn, reps) {
        reps = reps || 3;
        const before = ref(); await yield_();
        const t = [];
        for (let i = 0; i < reps; i++) { const t0 = performance.now(); await fn(); t.push(Math.round(performance.now() - t0)); await yield_(); }
        const after = ref();
        const drift = after / before - 1;
        const sorted = [...t].sort((a, b) => a - b);
        return {
          label, ms: t, median: sorted[sorted.length >> 1],
          refBefore: Math.round(before), refAfter: Math.round(after),
          drift: +(100 * drift).toFixed(1),
          // A SESSION THAT DRIFTED CANNOT SUPPORT A COMPARISON, and saying so is the entire point.
          trustworthy: Math.abs(drift) <= DRIFT_WARN,
          note: Math.abs(drift) <= DRIFT_WARN
            ? 'reference held to ' + (100 * Math.abs(drift)).toFixed(1) + '% - the session is sound'
            : 'REFERENCE MOVED ' + (100 * drift).toFixed(1) + '% DURING THIS MEASUREMENT. Open a fresh tab '
              + 'and run it again; do not compare this against anything.',
        };
      },

      // Two or more variants that CAN live in one page - different op chains, different slabs. Run
      // round-robin so a monotone drift lands on every variant instead of on whichever went last.
      async runInterleaved(variants, reps) {
        reps = reps || 3;
        const out = {}; for (const k of Object.keys(variants)) out[k] = [];
        const before = ref(); await yield_();
        for (let r = 0; r < reps; r++) {
          for (const k of Object.keys(variants)) {
            const t0 = performance.now(); await variants[k](); out[k].push(Math.round(performance.now() - t0));
            await yield_();
          }
        }
        const after = ref();
        const drift = after / before - 1;
        const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
        const medians = {}; for (const k of Object.keys(out)) medians[k] = med(out[k]);
        return {
          ms: out, medians,
          refBefore: Math.round(before), refAfter: Math.round(after),
          drift: +(100 * drift).toFixed(1),
          trustworthy: Math.abs(drift) <= DRIFT_WARN,
          note: Math.abs(drift) <= DRIFT_WARN
            ? 'interleaved, and the reference held to ' + (100 * Math.abs(drift)).toFixed(1) + '%'
            : 'reference moved ' + (100 * drift).toFixed(1) + '% - but interleaving means the drift fell on '
              + 'every variant, so the RATIO is still usable while the absolute times are not.',
        };
      },
    };
  };
})(window);
