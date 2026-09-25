// An artifact's emission stops are a GRADIENT, and a single stop is not.
//
// `emit` used to return a colour only where the light sat within SPX_TOL of one of an artifact's stops, and
// nothing in between. It now blends between the two stops the light lies between — which is always exactly
// two, however many the artifact carries, so the cost does not grow with the palette.
//
// The half of this that needs a gate is the half that could break slabs people already own: an artifact
// with ONE stop must behave exactly as it did, because every OVR_uv entry in every committed slab has one.
// If that ever stops being true, this goes red before anyone's stone changes colour.
//
//   node harness/inject.mjs && node harness/spectrum.mjs
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const hooked = pathToFileURL(join(here, 'dist', 'stone-author.hooked.html')).href;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(hooked);
await page.waitForFunction(() => !!window.__sa, null, { timeout: 15000 });

const CYAN = '#35c8ff', MAGENTA = '#ff36c0';
const res = await page.evaluate(({ CYAN, MAGENTA }) => {
  const sa = window.__sa;
  const read = (layer, vals) => vals.map(v => { sa.setSpx(v); return sa.emit(null, layer); });
  sa.OVR_uv['lay:major'] = [{ v: -1, c: CYAN }, { v: -2, c: MAGENTA }];
  sa.OVR_uv['lay:minor'] = [{ v: -1, c: CYAN }];
  const two = read('major', [-1, -1.25, -1.5, -1.75, -2, -2.4, -0.5]);
  const one = read('minor', [-1, -1.1, -1.5, -2, -0.8]);
  // stops given out of order must resolve the same as in order — nothing may depend on how they were authored
  sa.OVR_uv['lay:web'] = [{ v: -2, c: MAGENTA }, { v: -1, c: CYAN }];
  const rev = read('web', [-1.5]);
  sa.setSpx(0);
  return { two, one, rev };
}, { CYAN, MAGENTA });
await browser.close();

const fail = [];
const mid = (a, b) => {                                   // the midpoint of two hex colours, to 1 unit
  const h = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
  const A = h(a), B = h(b);
  return [0, 1, 2].map(i => Math.round((A[i] + B[i]) / 2));
};
const rgb = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
const near = (got, want, tol = 2) => got && want.every((w, i) => Math.abs(rgb(got)[i] - w) <= tol);

const [t1, t125, t15, t175, t2, past, before] = res.two;
if (t1 !== CYAN) fail.push(`sitting on a stop must give it exactly: got ${t1}`);
if (t2 !== MAGENTA) fail.push(`sitting on the far stop must give it exactly: got ${t2}`);
if (!near(t15, mid(CYAN, MAGENTA))) fail.push(`halfway between the stops must be their midpoint: got ${t15}`);
if (!(t125 && t175 && t125 !== t15 && t175 !== t15)) fail.push('quarter and three-quarter points must differ from the midpoint');
if (past !== null) fail.push(`past the last stop must stay dark: got ${past}`);
if (before !== null) fail.push(`before the first stop must stay dark: got ${before}`);

const [o1, o11, o15, o2, o08] = res.one;
if (o1 !== CYAN || o11 !== CYAN) fail.push('a single stop must still light within tolerance');
if (o15 !== null || o2 !== null || o08 !== null) fail.push('A SINGLE STOP MUST NOT INTERPOLATE — every committed slab has one');

if (!near(res.rev[0], mid(CYAN, MAGENTA))) fail.push(`stops authored out of order resolved differently: got ${res.rev[0]}`);

for (const f of fail) console.error('  ' + f);
console.log(fail.length ? `Spectrum: ${fail.length} failure(s).`
                        : `Spectrum: PASS — blends between stops (${t125} · ${t15} · ${t175}), one stop unchanged, order-independent.`);
process.exit(fail.length ? 1 : 0);
