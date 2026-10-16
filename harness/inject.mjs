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
    renderOneTile, tiffPlan, tiffTiled, deflateBytes,
    // THE FLOOR, both ways. Without these the harness could not reach the floor at all - it has only
    // ever rendered the tiled SLAB - and a defect that put every output tile's material under one
    // piece went green through CI for as long as it existed. renderFloor builds the whole picture on
    // one canvas and BLITS each piece out of a pre-rendered slab; renderFloorTile paints each piece
    // procedurally into one output tile. They must agree, and only a gate that can call both can say.
    renderFloorTile, renderFloor, tileInstances,
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
    storedTilePixels, markSigNow, resumeVerify,
    masterBase, masterFiles, setMaterial: (m) => { MATERIAL = m; },
    tilePainted,                                 // the lost-canvas guard, so it can be shown to bite
    get OVR() { return OVR; },                  // the adjustment ladder's store, so a gate can set strain
    render: () => { size(); build(); stoneReady = false; draw(); },
    get G() { return G; }, get OVR_uv() { return OVR_uv; },
    get marks() { return marks; }, set marks(v) { marks = v; },
    get layers() { return layers; },
  };
`;
const idx = s.lastIndexOf('})();');
if (idx < 0) { console.error('could not find the app IIFE end (})();)'); process.exit(1); }
s = s.slice(0, idx) + hook + s.slice(idx);
const out = join(outDir, 'stone-author.hooked.html');
writeFileSync(out, s, 'utf8');
console.log('injected __sa hook ->', out, '(' + s.length + ' bytes)');
