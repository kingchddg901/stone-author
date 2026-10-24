// A BUILD THAT HANDS OUT THE REAL F.
//
// tools/gpu-tile-probe.html measured a whole tile both ways and came back at 247x the pool - but
// against a SYNTHETIC scene, five invented ops and six invented ribbons, which its own cross-check
// showed was 67% more work than the real slab asks for. The ratio survives that; the nanoseconds do
// not, and neither does any claim about what a particular document would cost.
//
// So this build stashes the F that paintGlassContent actually assembles - the compiled op chain, the
// ribbon geometry, the roller and warp states, the pane and the form - on window.__F, at the moment
// it is complete. The probe loads this page in a same-origin iframe and reads F across the boundary
// rather than serialising it: the warp and roller grids are thousands of floats each, and a JSON
// round trip would be both large and a second description of the same data.
//
// IT CAPTURES, IT DOES NOT CHANGE. One assignment after F.UNF is set, which is the first moment
// every field exists. No arithmetic is touched, so a tile drawn by this build is the tile the app
// draws - and if that stops being true, the probe's own CPU arm is the thing that notices.
//
//   node harness/inject.mjs && node tools/capture-scene.mjs
//
// then, in a browser on harness/dist/scene-capture.html:
//
//   const slab = await (await fetch('/harness/dist/slab.json')).json();
//   __sa.deserialize(slab); __sa.render();
//   __sa.renderOneTile(65535, 0, 0, 64, 64, 0);        // any tile - F is built per tile
//   __F;                                                // the real thing
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'harness', 'dist', 'stone-author.hooked.html');
const OUT = join(root, 'harness', 'dist', 'scene-capture.html');

if (!existsSync(SRC)) {
  console.error('no hooked build at harness/dist/stone-author.hooked.html');
  console.error('Run: node harness/inject.mjs');
  process.exit(1);
}

const NL = String.fromCharCode(10);
let t = readFileSync(SRC, 'utf8').replace(/\r\n/g, NL);

// the first moment F is complete: the specialised chain has just been compiled onto it
const ANCHOR = '    F.UNF = compileUnform(F) || glassUnform;';
if (t.split(ANCHOR).length - 1 !== 1) {
  console.error('could not find the point where F is complete (F.UNF assignment)');
  console.error('the app has been edited and this tool is stale - fix it rather than capturing half an F');
  process.exit(1);
}
t = t.replace(ANCHOR, ANCHOR + NL
  + '    window.__F = F;                       // tools/capture-scene.mjs: the real scene, for the GPU probe'
  + NL + '    window.__CANES = canes; window.__LIGHT = [LBR, LBG, LBB];'
  + NL + '    window.__TINT = [kr, kg, kb]; window.__MIX = [CORD, OPQ, OREF, REL, TINT];');

// THE NAMES HAVE TO BE IN SCOPE WHERE THE CAPTURE SITS, and this checks the weak version of that
// on purpose. Two attempts at a strong one both called a correct file stale: LBR comes out of a
// destructuring, const [LBR, LBG, LBB] = hexRGB(...), and OREF is a second declarator, const OPQ =
// ..., OREF = 8. Matching every way JavaScript can introduce a name is writing a parser in regex,
// and a check that cries wolf gets deleted by the next person.
//
// So it asks only that each name EXISTS BEFORE the capture point. That cannot prove scope - the
// real proof is that the capture either throws at run time or hands back values the probe's own CPU
// arm then disagrees with - but it does catch the thing this is actually for: a rename or a removal
// leaving the capture reaching for something the app no longer has.
const at = t.indexOf(ANCHOR);
for (const name of ['canes', 'LBR', 'kr', 'CORD', 'OPQ', 'OREF', 'REL', 'TINT']) {
  const re = new RegExp('\\b' + name + '\\b');
  const m = t.slice(0, at).search(re);
  if (m < 0) {
    console.error('the app has no ' + name + ' before the capture point - this tool is stale');
    console.error('fix it rather than capturing an F with holes in it');
    process.exit(1);
  }
}

writeFileSync(OUT, t);
console.log('captured F, the canes, the light, the tint and the mix -> harness/dist/scene-capture.html');
console.log('window.__F is set once a tile has been painted; F is built per tile, so paint one first');
