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
