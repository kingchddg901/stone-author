// Build a headless-renderable copy of the app. The shipped app/stone-author.html has no external render API;
// this injects a tiny `window.__sa` hook INSIDE the app's IIFE (so it can see the closure) and writes
// harness/dist/stone-author.hooked.html. The shipped artifact stays clean — the hook lives only in dist.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'app', 'stone-author.html');
const outDir = join(here, 'dist');
mkdirSync(outDir, { recursive: true });

let s = readFileSync(src, 'utf8');
const hook = `
  window.__sa = {
    deserialize, renderFull, setSpectrum,
    // THE COLOUR RESOLVE. deserialize calls this itself since 2026-10-29 - it did not, and a
    // programmatic load then painted from a stale COL - so a probe needs it only to force a
    // re-resolve after poking OVR directly.
    recolour,
    // the export's own builders, so the harness can time them against each other. renderTiled paints the
    // whole slab's content once PER TILE; renderFull paints it once but needs the entire canvas at once.
    renderTiled, renderTiledStepped, expBaseMask, expCoverage, expIdT,
    // THE BACK LIGHT'S WHOLE-SLAB MAPS AND THE RENDER-SCOPED HANDLE TO THEM. exportTiff and
    // renderTiled set this for the length of a render and clear it after; a probe comparing ONE
    // pooled tile against one sequential tile is not inside either, so it has to say so itself.
    backlitMaps, setBacklitFor: m => { backlitFor = m; },
    // THE TWO MAPS THEMSELVES, so a probe can ask WHICH of them differs between calls rather
    // than inferring it from the picture they were placed into.
    backlitScratch: () => ({ fold: workC, emit: emitC, base: backC }),
    // the strip path: a render larger than a canvas can be, assembled as a PNG stream
    renderStreamedPNG, stripPlan, renderStrip,
    // the grid path: an arbitrary rectangle of the picture, and the tiled container it is written into
    // rgbFromRGBA IS THE SHIPPED COMPACTION, not a copy of it. The stored tile is three
    // channels now and the harness has to build the same bytes the export does; writing the
    // loop again in the test would be testing the test.
    renderOneTile, tiffPlan, tiffTiled, deflateBytes, rgbFromRGBA,
    // THE WHOLE EXPORT, because the question the per-tile probes cannot answer is what a REAL render
    // costs: the pool, the finishers, the sink and the in-order consumer together. It writes the
    // per-tile timings and the pool trace into the master's own metadata, which is the instrument
    // that settled where a 3,949 ms wall went. Nothing else reaches it - exportTiff is reached from
    // a click and from nowhere a gate can call.
    exportTiff,
    // THE FLOOR, both ways. Without these the harness could not reach the floor at all - it has only
    // ever rendered the tiled SLAB - and a defect that put every output tile's material under one
    // piece went green through CI for as long as it existed. renderFloor builds the whole picture on
    // one canvas and BLITS each piece out of a pre-rendered slab; renderFloorTile paints each piece
    // procedurally into one output tile. They must agree, and only a gate that can call both can say.
    renderFloorTile, renderFloor, tileInstances,
    // THE GPU PATH, so a gate can run it against renderOneTile on the SAME tile. The shader is
    // verified function by function and whole-tile against a re-implementation of the painter's
    // order - not against renderOneTile itself, which also lays a ground, applies the coat and
    // composites reality windows. Those three are exactly where a port goes wrong quietly, and
    // without these there is no way to ask.
    gpuPool, gpuWhyNot, gpuCapability, gpuPrefGet, gpuPrefSet, glassScene, packReal, tiffPlan,
    // AND STONE'S SIDE OF THE SAME QUESTION. stoneScene is the only thing that can read the layer
    // list, the geometry and the override map, and the shader is useless to a gate without the scene
    // it was packed from. The differential that matters is renderOneTile against ITSELF - once
    // painting on the CPU and once handed the shader's face through its own paint callback - because
    // that way both tiles get the same ground and the same coat, and only the content can differ.
    stoneScene, stoneWhyNot, stoneChunks,
    // AND THE PACKER ITSELF, which takes a scene rather than building one - so a probe can pack the
    // SAME scene twice and diff the result. That is the only way to price a binning change without
    // writing the shader first: parts.MCI is literally the list of (primitive, cell) pairs every
    // pixel's cell walk is drawn from, so its length IS the cost.
    // STONE_PACK, NOT packStone: the packer lives inside the stone block - it has to, because all
    // three materials name their arena parts PART_NAMES - and this hook is injected at the END of
    // the app's IIFE, where that block's names are not in scope. STONE_PACK is the handle the block
    // hoists out for exactly this reason, and GPU_MAT's own stone entry reaches it the same way.
    packStone: (scene, view) => STONE_PACK(scene, view),
    // THE PREVIEW'S OWN PIECES. The export path is reachable through gpuPool and the tiled render;
    // draw() is not reachable from anywhere, and it is a DIFFERENT renderer - it paints one view of
    // the slab at the view transform rather than a grid of tiles at a fixed scale. Without these a
    // claim about what the preview costs, or about whether the shader draws the same view the
    // painter does, is an inference from the export path's numbers.
    draw, paintContent, applyCoat, size, redraw,
    // AND THE PREVIEW'S GPU PATH, which is a DIFFERENT renderer from the export's pool: one rect at
    // the view transform, on the main thread, rather than a grid of tiles at a fixed scale through a
    // pipelined pool. prevFill is the one await in the frame - without it a gate can only drive the
    // path by racing a rAF, and cannot tell a face that is not ready from a face that is wrong.
    prevFill, prevWhyNot, prevView, prevFace, gpuPrefSet, gpuSyncRow,
    get cv() { return cv; }, get ctx() { return ctx; }, get V() { return V; },
    get viewPx() { return { Wc, Hc, dpr, w: cv.width, h: cv.height }; },
    get STONE_PACK() { return STONE_PACK; }, get STONE_SRC() { return STONE_SRC; },
    get STONE_UNI_BYTES() { return STONE_UNI_BYTES; }, get STONE_UNI_OFF() { return STONE_UNI_OFF; },
    // drewOnGpu is what renderSig reads to decide whether the renderer belongs in the hash, and
    // exportTiff is the only thing that sets it. A gate has to be able to take BOTH signatures
    // without running a six-minute export, or the claim that an existing master keeps its hash is
    // an assertion rather than a measurement.
    get drewOnGpu() { return drewOnGpu; }, set drewOnGpu(v) { drewOnGpu = !!v; },
    get T() { return T; },
    get layTiles() { return layTiles; }, set layTiles(v) { layTiles = !!v; },
    // the spectral resolver, so a gate can ask what an artifact glows at a given light without rendering
    emit, emitAt, setSpx: (v) => { lightSpectrum = v; uvMode = v !== 0; },
    // both signatures, so a gate can show which one answers "same picture?"
    stateSig, renderSig,
    // THE RESUME OFFER, which has no other way in. The row is GATED - absent unless an unfinished
    // render of this picture is on disk - so the only state reachable without these is the hidden one,
    // and a gated control that never appears is indistinguishable from a broken one. resumeRow builds
    // a record in the app's own format rather than a copy of it, which is the whole point.
    resumeRow, resumeScan, resumeOffer,
    resumeAsk, resumeKind, resumeDiscard,
    // THE TWO HALVES OF THE WINDOW QUESTION, so a test can read which masks a slab holds and
    // which ones a render of it shows, rather than inferring the difference from a signature.
    gatherMasks, windowMasks,
    storedTilePixels, markSigNow, resumeVerify,
    masterBase, masterFiles, setMaterial: (m) => { MATERIAL = m; },
    tilePainted,                                 // the lost-canvas guard, so it can be shown to bite
    // THE POOL ITSELF, because its instrumentation has no other way in. The four timestamps are
    // written in exportTiff's loop and read off a finished master, so the only way to find out
    // whether they POPULATE is to run a 14 minute render and look - which is a slow way to discover
    // a typo. With this a gate can drive eight workers over a small picture and assert that an ack
    // came back, that the busy counts move, and that each worker is identified.
    tilePool, corePaintsThis, poolWhyNot, poolWidthFor,
    // THE SERIALISED CORE ITSELF. A worker that throws while compiling it leaves the pool's
    // promises unsettled and the caller hangs for ever - the failure this file's own comments
    // record - so a hang and a slow start look identical from outside. Handing the source out
    // lets a harness syntax-check it in one call instead of inferring the fault from silence.
    renderCoreSrc,
    get OVR() { return OVR; },                  // the adjustment ladder's store, so a gate can set strain
    // prevGen++ IS THE DOCUMENT CHANGING. In the app every mutation reaches the GPU face
    // through redraw, which counts a generation; this entry does not go through redraw, so
    // without the count a gate that mutates and re-renders is handed the face of the document
    // as it WAS - measured: a haze-removal ablation read mean 54.8 against a face that still
    // had the haze in it, and the number looked like a finding.
    render: () => { size(); build(); stoneReady = false; prevGen++; draw(); },
    get G() { return G; }, get OVR_uv() { return OVR_uv; },
    get marks() { return marks; }, set marks(v) { marks = v; },
    get layers() { return layers; },
    // THE DERIVED GEOMETRY AND THE LIGHT, read-only. A UV comparison that finds two identical
    // tiles has proved nothing if the lines it was comparing were never built - deserialize
    // restores MARKS, build() turns them into lines, and the light resets to daylight on load.
    // Without these a blank render and a correct one are the same observation.
    get geo() { return geo; },
    get light() { return { uvMode, lightSpectrum, spotOn, crossOn, spotR: G.spotR, lightX: G.lightX, lightY: G.lightY }; },
  };
`;
// THE BLOOM ABLATION, injected rather than edited into the app, so app/stone-author.html stays clean
// and there is nothing to revert or to commit by accident. It prices one question: how much of a UV
// tile is applyCoat's emission bloom - the two blurDraw passes at 3*bs and 8*bs, which at 16,384 are
// 49 and 131 px. That is the CEILING on what moving the bloom to the shader could buy.
//
// READ OFF `self`, NOT A DECLARED NAME. The pooled path paints in a WORKER whose core is serialised
// with fn.toString(), so it keeps the TEXT and loses the SCOPE - a free name would have to be
// declared in the worker preamble too (the lesson make-probe-builds.mjs carries for __ablPaint).
// `self` exists in both scopes and is undefined-safe in the worker, so an un-set flag simply leaves
// the bloom running, which is the right default on the side that is not being measured.
const BLOOM_SRC = `if (!(BLOOM_DRAW && glowPx > 0) && !coatBloomDone) {`;
const BLOOM_ABL = `if (!(BLOOM_DRAW && glowPx > 0) && !coatBloomDone && !self.__ABL_BLOOM) {`;
if (s.indexOf(BLOOM_SRC) < 0) { console.error('the emission-bloom branch has moved - the ablation would be silent'); process.exit(1); }
s = s.replace(BLOOM_SRC, BLOOM_ABL);

// --abl-bloom WRITES A SECOND BUILD WITH THE EMISSION BLOOM GONE, for the question the flag above
// cannot answer: what the bloom costs INSIDE THE POOL, where eight workers contend for one GPU-backed
// canvas and a tile measured alone at 242 ms really costs 652. A flag cannot reach there - the worker
// core is serialised with fn.toString(), so it keeps the TEXT and loses the SCOPE, and self.__ABL_BLOOM
// is simply undefined on that side. Deleting the two calls from the SOURCE removes them from both
// scopes at once, because applyCoat travels as its own text.
const ABL = process.argv.includes('--abl-bloom');
if (ABL) {
  // ONE LINE AT A TIME. This file is CRLF throughout and node's readFileSync does NOT normalise it,
  // so a multi-line pattern written with bare newlines matches nothing and the ablation would be
  // SILENT - it failed exactly that way once. Python hides the difference (read_text translates on
  // the way in and back out), which is why a patch script sees no problem where this does. Each call
  // is replaced on its own, so neither the newline nor the line count matters.
  const CALLS = ['blurDraw(tx, tcv, 3 * bs, w, h);', 'blurDraw(tx, tcv, 8 * bs, w, h);'];
  for (const c of CALLS) {
    if (s.indexOf(c) < 0) { console.error('emission-bloom pass missing, the ablation would be silent: ' + c); process.exit(1); }
    s = s.replace(c, 'void 0;   /* HARNESS: emission bloom ablated */');
  }
}

// THE BACK LIGHT'S TWO HALVES, EACH SWITCHABLE OFF, to price what a GPU port of it could take.
// backlitPlace is the only part a shader could do - a backlit tile paints no content, so there is no
// layer walk to replace - and backlitBloom is image-space over the tile, which is the thing that
// already lost on the GPU once today. Injected rather than edited so the app stays clean.
const BL_PLACE = 'function backlitPlace(gw, gh) {';
const BL_BLOOM = 'function backlitBloom(tcv, bs) {';
for (const [open, flag] of [[BL_PLACE, '__ABL_PLACE'], [BL_BLOOM, '__ABL_BLOOMB']]) {
  if (s.indexOf(open) < 0) { console.error('the back light half has moved: ' + open); process.exit(1); }
  s = s.replace(open, open + ' if (self.' + flag + ') { return; }');
}

const idx = s.lastIndexOf('})();');
if (idx < 0) { console.error('could not find the app IIFE end (})();)'); process.exit(1); }
s = s.slice(0, idx) + hook + s.slice(idx);
const out = join(outDir, ABL ? 'stone-author.ablbloom.html' : 'stone-author.hooked.html');
writeFileSync(out, s, 'utf8');
console.log('injected __sa hook ->', out, '(' + s.length + ' bytes)');
