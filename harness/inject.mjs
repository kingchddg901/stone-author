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
    // the export's own builders, so the harness can time them against each other. renderTiled paints the
    // whole slab's content once PER TILE; renderFull paints it once but needs the entire canvas at once.
    renderTiled, expBaseMask, expCoverage, expIdT,
    // the strip path: a render larger than a canvas can be, assembled as a PNG stream
    renderStreamedPNG, stripPlan, renderStrip,
    // the grid path: an arbitrary rectangle of the picture, and the tiled container it is written into
    // rgbFromRGBA IS THE SHIPPED COMPACTION, not a copy of it. The stored tile is three
    // channels now and the harness has to build the same bytes the export does; writing the
    // loop again in the test would be testing the test.
    renderOneTile, tiffPlan, tiffTiled, deflateBytes, rgbFromRGBA,
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
    tilePool, corePaintsThis, poolWidthFor,
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
const idx = s.lastIndexOf('})();');
if (idx < 0) { console.error('could not find the app IIFE end (})();)'); process.exit(1); }
s = s.slice(0, idx) + hook + s.slice(idx);
const out = join(outDir, 'stone-author.hooked.html');
writeFileSync(out, s, 'utf8');
console.log('injected __sa hook ->', out, '(' + s.length + ' bytes)');
