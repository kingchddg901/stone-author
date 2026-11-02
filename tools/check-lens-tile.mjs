// DOES A TILE GET THE PIXELS THE WHOLE PICTURE WOULD HAVE GIVEN IT?
//
// The lens is a GATHER: every output pixel is read from a displaced one. For most of this app's life
// that meant it could not be tiled at all, so it ran once over an assembled canvas — and the one
// export path that streams tiles to disk rather than assembling them simply had no lens in it. A TIFF
// and a PNG of one slab, same `inputs`, came out at light.mean 67.35 and 80.01, and the TIFF recorded
// `omits: ['lens']` in a field no tool printed.
//
// It is tileable because the field is closed form in PICTURE coordinates: `vp` says where the tile
// sits, `lensReach()` puts the displacement into the bleed, and the gather then reads a pixel the
// tile was actually given. Both halves have to be right. Get `vp` wrong and every tile centres its
// own rings — obvious. Get the BLEED wrong and the gather clamps at the tile edge instead, which
// flattens the groove into a straight line at every seam and is the quiet one: each tile is a
// perfectly good picture of something slightly wrong.
//
// So: render a picture whole, render it again in tiles with the bleed the app itself computes, and
// demand the interiors agree EXACTLY. No tolerance — these are the same arithmetic on the same
// pixels, and anything but zero means a tile read something the whole picture did not.
//
// IT RUNS THE APP'S OWN TEXT. `lensField` and `applyLens` are lifted out of the file and executed
// against a fake 2D context, so this cannot pass against a copy of the code that used to be there.
//
//   node tools/check-lens-tile.mjs
//   node tools/check-lens-tile.mjs --ablate   starve the bleed and prove the comparison bites
import { readFileSync } from 'fs';

const APP = readFileSync('app/stone-author.html', 'utf8');
const ABLATE = process.argv.includes('--ablate');

// ---- lift a function out of the app by brace matching ----------------------------------------------
function bodyOf(name) {
  const at = APP.indexOf('\n  function ' + name + '(');
  if (at < 0) return null;
  let d = 0, i = APP.indexOf('{', at);
  const start = at + 1;
  for (; i < APP.length; i++) {
    const c = APP[i];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) return APP.slice(start, i + 1); }
  }
  return null;
}
const fail = [];
const parts = {};
for (const n of ['lensField', 'applyLens', 'lensReach']) {
  parts[n] = bodyOf(n);
  if (!parts[n]) fail.push('`' + n + '` is not in the app — the lens no longer has the shape this gate checks');
}
if (fail.length) { for (const f of fail) console.error(f); process.exit(1); }

// COAT_REF and H are read by lensReach and are plain constants in the app; take them from the app
// rather than restating them, or this gate would keep passing after they moved.
const num = (re, what) => {
  const m = APP.match(re);
  if (!m) { console.error('cannot read ' + what + ' from the app'); process.exit(1); }
  return Number(m[1]);
};
const COAT_REF = num(/const COAT_REF = (\d+)/, 'COAT_REF');
const H = num(/const H = ([\d.]+);\s*\/\/ frame height/, 'the frame aspect H');

// ---- a 2D context that is an array ------------------------------------------------------------------
function ctxOver(w, h, data) {
  return {
    canvas: { width: w, height: h },
    getImageData(x, y, gw, gh) {
      const out = new Uint8ClampedArray(gw * gh * 4);
      for (let r = 0; r < gh; r++) out.set(data.subarray(((y + r) * w + x) * 4, ((y + r) * w + x + gw) * 4), r * gw * 4);
      return { width: gw, height: gh, data: out };
    },
    createImageData: (cw, ch) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }),
    putImageData(img, dx, dy, sx, sy, sw, sh) {
      for (let r = 0; r < sh; r++)
        data.set(img.data.subarray(((sy + r) * img.width + sx) * 4, ((sy + r) * img.width + sx + sw) * 4),
                 ((dy + r) * w + dx) * 4);
    },
  };
}

// A PICTURE WITH DETAIL IN IT, because the defect this replaced was the loss of detail and a smooth
// test image cannot see it. One pixel in three is a hard edge.
function picture(w, h, seed) {
  const d = new Uint8ClampedArray(w * h * 4);
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = (i / w) | 0, k = ((x * 7 + y * 13) % 3 === 0) ? 255 : 30;
    d[i * 4] = k * rnd(); d[i * 4 + 1] = (x * 255 / w) | 0; d[i * 4 + 2] = k; d[i * 4 + 3] = 255;
  }
  return d;
}

const run = new Function('G', 'COAT_REF', 'H', 'tcv', 'tx', 'vp',
  parts.lensField + parts.lensReach + parts.applyLens + '\nreturn { applyLens, lensReach };');

let bad = 0;
const say = (m) => { console.error('  ' + m); bad++; };

for (const type of ['fresnel', 'reeded', 'water']) {
  const G = { lens: 0.45, lensPitch: 9, lensType: type };
  const W = 384, FH = Math.round(W * H);
  const api = run(G, COAT_REF, H, null, null, null);
  const bleed = ABLATE ? 0 : api.lensReach(W / COAT_REF);
  if (!ABLATE && !(bleed > 0)) say(type + ': lensReach is 0 for a lens that is on — the bleed would never grow');

  // the whole picture, in one piece
  const whole = picture(W, FH, 7);
  api.applyLens({ width: W, height: FH }, ctxOver(W, FH, whole), null);

  // the same picture, in tiles, each told where it sits
  const got = new Uint8ClampedArray(W * FH * 4);
  const TS = 128;
  for (let ty = 0; ty < FH; ty += TS) for (let tx0 = 0; tx0 < W; tx0 += TS) {
    const tw = Math.min(TS, W - tx0), th = Math.min(TS, FH - ty);
    const ex = tx0 - bleed, ey = ty - bleed, ew = tw + 2 * bleed, eh = th + 2 * bleed;
    // the tile's own canvas, filled from the source picture and clamped at the picture's edge exactly
    // as a renderer's bleed is: outside the slab there is nothing to read, so the edge pixel stands
    const src = picture(W, FH, 7), tile = new Uint8ClampedArray(ew * eh * 4);
    for (let y = 0; y < eh; y++) for (let x = 0; x < ew; x++) {
      const px = Math.min(W - 1, Math.max(0, ex + x)), py = Math.min(FH - 1, Math.max(0, ey + y));
      tile.set(src.subarray((py * W + px) * 4, (py * W + px) * 4 + 4), (y * ew + x) * 4);
    }
    api.applyLens({ width: ew, height: eh }, ctxOver(ew, eh, tile), { ox: ex, oy: ey, fw: W, fh: FH });
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++)
      got.set(tile.subarray(((y + bleed) * ew + x + bleed) * 4, ((y + bleed) * ew + x + bleed) * 4 + 4),
              ((ty + y) * W + tx0 + x) * 4);
  }

  let diff = 0, worst = 0;
  for (let i = 0; i < whole.length; i++) { const d = Math.abs(whole[i] - got[i]); if (d) { diff++; if (d > worst) worst = d; } }
  const pct = (100 * diff / whole.length).toFixed(3);
  if (ABLATE) {
    console.log('  ablate ' + type + ': bleed 0 -> ' + diff + ' channel(s) differ (' + pct + '%), worst ' + worst);
    if (!diff) say('ablate ' + type + ': a bleed of ZERO still matched the whole picture — this comparison cannot fail');
  } else if (diff) {
    say(type + ': a tiled render differs from the whole picture in ' + diff + ' channel(s) (' + pct + '%), worst ' + worst +
        ' — at bleed ' + bleed + '. Either `vp` is not reaching applyLens or lensReach is short.');
  } else {
    console.log('  ' + type + ': tiled == whole, bleed ' + bleed + 'px, ' + W + 'x' + FH + ' in 128px tiles');
  }
}

// ---- and the lens must still be IN the coat, not bolted on after it ---------------------------------
if (!ABLATE) {
  if (!/if \(!f\.ident && G\.lens > 0\) applyLens\(tcv, tx, vp\);/.test(APP))
    say('applyCoat no longer calls applyLens with its viewport — a tile would centre its own rings');
  if (/applyLens\(fc, fx\)/.test(APP))
    say('something still runs the lens over an assembled canvas as well as per tile, which refracts it twice');
  if (!/shadowReach\(6 \* maxGlow\(\)\), lensReach\(bs\)\)/.test(APP))
    say('coatReach no longer includes lensReach, so the bleed does not cover the gather');
}

if (bad) { console.error('check-lens-tile: ' + bad + ' problem(s)'); process.exit(1); }
console.log('check-lens-tile: OK' + (ABLATE ? ' — the comparison bites' : ''));
