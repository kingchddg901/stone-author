// IS THE OVERVIEW REDUCER EXACTLY REPRODUCIBLE?
//
// A master with pyramid levels is only still a reproducible artifact if the levels are a pure function
// of the picture. Two renders of one slab already agree byte for byte across engines and tilings; the
// moment a reducer rounds differently on one of them, that stops being true and every cross-engine
// comparison in this repo loses its footing.
//
// WHAT IT HAS TO PROVE:
//   1  the geometry halves, and a 2x2 of one colour returns that colour
//   2  rounding is half-UP and exact - the ablation puts truncation back and requires a case to go red
//   3  the same input twice gives the same bytes
//   4  alpha is handled as UNASSOCIATED: premultiplied sum over the alpha sum, not a naive average,
//      and the ablation shows the two genuinely differ so the test can tell them apart
//   5  the fast opaque path and the general path AGREE where they overlap - a disagreement would put a
//      seam into every overview exactly where alpha stopped being 255
//   6  nothing there reduces to nothing
//
//   node tools/probe-reduce.mjs
import { loadReducer, levels } from './lib/pyramid.mjs';
import { readFileSync } from 'fs';

const reduce2 = loadReducer();
let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('  ok    ' + name); return; }
  fails++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};
const px = (...v) => Uint8Array.from(v);

// ---- 1: geometry, and identity -------------------------------------------------------------------
{
  const src = new Uint8Array(8 * 6 * 4);
  for (let i = 0; i < src.length; i += 4) { src[i] = 40; src[i+1] = 80; src[i+2] = 120; src[i+3] = 255; }
  const out = reduce2(src, 8, 6);
  ok('a 8x6 reduces to 4x3', out.length === 4 * 3 * 4, out.length + ' bytes');
  let same = true;
  for (let i = 0; i < out.length; i += 4)
    if (out[i] !== 40 || out[i+1] !== 80 || out[i+2] !== 120 || out[i+3] !== 255) { same = false; break; }
  ok('a block of one colour returns that colour', same);
}

// ---- 2: rounding is half UP, and exact -------------------------------------------------------------
// 0,0,1,1 averages to 0.5. Half-up gives 1; truncation gives 0. One pixel decides it.
{
  const src = px(0,0,0,255,  0,0,0,255,
                 1,1,1,255,  1,1,1,255);
  const out = reduce2(src, 2, 2);
  ok('0,0,1,1 rounds up to 1', out[0] === 1, 'got ' + out[0]);
  const src2 = px(0,0,0,255,  0,0,0,255,
                  0,0,0,255,  1,1,1,255);
  ok('0,0,0,1 rounds down to 0', reduce2(src2, 2, 2)[0] === 0);
  const src3 = px(3,3,3,255,  3,3,3,255,
                  4,4,4,255,  4,4,4,255);
  ok('3,3,4,4 rounds up to 4', reduce2(src3, 2, 2)[0] === 4);
}

// ---- 3: the same input twice --------------------------------------------------------------------
{
  const src = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < src.length; i++) src[i] = (i * 37 + (i >> 4) * 11) & 0xff;
  for (let i = 3; i < src.length; i += 4) src[i] = 255;
  const a = reduce2(src, 16, 16), b = reduce2(src, 16, 16);
  ok('the same input gives the same bytes', a.length === b.length && a.every((v, i) => v === b[i]));
}

// ---- 4: unassociated alpha ------------------------------------------------------------------------
// One opaque red sample and three transparent ones. Premultiplied, the colour is RED - the transparent
// samples carry no colour to dilute it. A naive average would give a quarter-strength red, 64.
{
  const src = px(255,0,0,255,   0,0,0,0,
                   0,0,0,0,     0,0,0,0);
  const out = reduce2(src, 2, 2);
  ok('one opaque sample among three empty keeps its colour', out[0] === 255, 'got ' + out[0]);
  ok('and carries a quarter of the alpha', out[3] === 64, 'got ' + out[3]);
  ok('ABLATION a naive average would NOT have said 255', Math.round((255 + 0 + 0 + 0) / 4) !== out[0]);
}

// ---- 5: the two paths agree where they overlap -----------------------------------------------------
// The opaque branch is integer arithmetic; the general branch divides. They must not disagree, or every
// overview gets a seam exactly where alpha stops being 255.
{
  let worst = 0, cases = 0;
  for (let a = 1; a <= 255; a += 7) {
    for (let v = 0; v < 256; v += 13) {
      const opaque = reduce2(px(v,v,v,255, v+1,v+1,v+1,255, v+2,v+2,v+2,255, v+3,v+3,v+3,255), 2, 2);
      const dim    = reduce2(px(v,v,v,a,   v+1,v+1,v+1,a,   v+2,v+2,v+2,a,   v+3,v+3,v+3,a),   2, 2);
      const d = Math.abs(opaque[0] - dim[0]);
      if (d > worst) worst = d;
      cases++;
    }
  }
  ok('uniform alpha gives the same colour whatever that alpha is', worst === 0,
     'worst ' + worst + ' over ' + cases + ' cases');
}

// ---- 6: nothing reduces to nothing ------------------------------------------------------------------
{
  const out = reduce2(new Uint8Array(2 * 2 * 4), 2, 2);
  ok('a fully transparent block is all zero', out.every(v => v === 0));
}

// ---- the ablation: put truncation back ---------------------------------------------------------------
// THE INPUT THAT MAKES THIS RED is case 2. A reducer that truncates instead of rounding half up is a
// fifth of a level darker on average and - the part that matters - would disagree with any other
// implementation of "box filter", including the one somebody writes next year.
{
  const app = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');
  const k = app.indexOf('function reduce2(');
  let i = app.indexOf('{', k), d = 0;
  for (;; i++) { if (app[i] === '{') d++; else if (app[i] === '}' && --d === 0) break; }
  const good = app.slice(k, i + 1);
  const bad = good.split('+ 2) >> 2').join(') >> 2');
  if (bad === good) { console.log('  FAIL  could not find the rounding to ablate - probe is stale'); fails++; }
  else {
    const cut = new Function(bad + '\nreturn reduce2;')();
    const src = px(0,0,0,255, 0,0,0,255, 1,1,1,255, 1,1,1,255);
    ok('ABLATION truncation gives 0 where half-up gives 1',
       cut(src, 2, 2)[0] === 0 && reduce2(src, 2, 2)[0] === 1);
  }
}

// ---- the level ladder ---------------------------------------------------------------------------------
{
  const L = levels(262144, 163840, 4096);
  ok('levels halve down to the stop', L[0].w === 131072 && L[L.length - 1].w === 4096, L.map(l => l.w).join(','));
  ok('and each one knows its own tile grid', L[0].across === 32 && L[0].down === 20,
     L[0].across + 'x' + L[0].down);
  const tiny = levels(2048, 1280, 4096);
  ok('a picture already small enough gets no levels', tiny.length === 0, String(tiny.length));
}

console.log('');
if (fails) { console.error('probe-reduce: ' + fails + ' FAILED'); process.exit(1); }
console.log('probe-reduce: the reducer is a pure function of the picture, rounds half up,');
console.log('              and treats alpha as unassociated.');
