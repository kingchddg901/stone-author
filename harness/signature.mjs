// Does the signature in a master's metadata answer the question people ask of it?
//
// The question is "did these two files come from the same picture". stateSig cannot answer it, and that
// is not a theory — both failure directions were demonstrated with real 65535 masters on disk:
//
//   FALSE MATCH  a daylight master and a black-light master of one slab both carry state 19acbddd,
//                because the light spectrum is not part of serialize(). Two files with no shared pixels
//                and one signature.
//   FALSE VOID   two S23 renders that agree on all 160 tiles byte for byte carry 683ede19 and 19acbddd,
//                because serialize() DOES include the tool and the selected layer, which a person moves
//                while setting up and which reach no pixel.
//
// renderSig signs an explicit list of render inputs instead. This gates the false match, which is the one
// that misleads: a signature that moves when it should not wastes a comparison, a signature that holds
// when it should not certifies two different pictures as the same render.
//
// The light is the right probe because it needs no authored slab — daylight paints a ground, black light
// paints UV_DARK, so the pixels differ on an empty document and this gate has nothing to set up. Each
// claim is checked in both directions: the pixels MUST differ, or the probe proved nothing.
//
//   node harness/inject.mjs && node harness/signature.mjs
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const hooked = pathToFileURL(join(here, 'dist', 'stone-author.hooked.html')).href;
const W = 512;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(hooked);
await page.waitForFunction(() => !!window.__sa, null, { timeout: 15000 });

const res = await page.evaluate(async (W) => {
  const sa = window.__sa;
  const shot = (spx) => {
    sa.setSpx(spx);
    sa.render();
    const c = sa.renderOneTile(W, 0, 0, W, Math.round(W * 0.625), 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const px = new Uint8Array(d);
    c.width = 1; c.height = 1;
    return { px, state: sa.stateSig(), inputs: sa.renderSig() };
  };
  const day = shot(0);
  const uv = shot(-1);
  sa.setSpx(0);
  let differing = 0;
  for (let i = 0; i < day.px.length; i++) if (day.px[i] !== uv.px[i]) differing++;
  return {
    bytes: day.px.length, differing,
    dayState: day.state, uvState: uv.state,
    dayInputs: day.inputs, uvInputs: uv.inputs,
    // a signature of null would pass every comparison by accident
    nullSig: day.inputs == null || uv.inputs == null,
  };
}, W);

await browser.close();

const fail = [];
// The probe first. Without this, every other assertion below is vacuous.
if (!res.differing) fail.push(`daylight and black light rendered IDENTICAL pixels — the probe is broken, not the code`);
if (res.nullSig) fail.push('renderSig returned null; a null signature matches everything');
if (res.dayInputs === res.uvInputs)
  fail.push(`FALSE MATCH: renderSig is ${res.dayInputs} for both daylight and black light, ` +
            `which differ in ${res.differing} of ${res.bytes} bytes. The light is not being signed.`);

console.log(`daylight vs black light: ${res.differing} of ${res.bytes} bytes differ`);
console.log(`  renderSig  ${res.dayInputs} -> ${res.uvInputs}   ${res.dayInputs !== res.uvInputs ? 'moved (correct)' : 'DID NOT MOVE'}`);
console.log(`  stateSig   ${res.dayState} -> ${res.uvState}   ${res.dayState !== res.uvState ? 'moved' : 'did not move (the known defect it is kept for compatibility despite)'}`);

if (fail.length) { console.error('\nsignature:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('signature: OK — the light reaches the signature that claims to describe the render');
