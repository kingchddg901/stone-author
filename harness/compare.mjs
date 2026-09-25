// Two raw RGBA buffers in, the shape of their difference out.
//
// An 8x8 map of mean channel difference, so anti-aliasing everywhere reads differently from one blown-out
// region, plus the difference as an x8-amplified image and the first buffer's own luma spread — which is how
// a blank render is told from a slab. Pure arithmetic, in Node: the engine gate did this inside the browser
// at first, and WebKit spent over 45 seconds on it while Chromium lost its execution context. It lives in its
// own file so it can be ablated without launching anything (scratchpad/test-compare.mjs).
const RAMP = ' .,:;ox%#';

export function compare(a, b, w, h, { amplify = 8 } = {}) {
  if (a.length !== b.length) throw new Error(`comparing ${a.length} bytes against ${b.length}`);
  if (a.length !== w * h * 4) throw new Error(`${w}x${h} needs ${w * h * 4} bytes, given ${a.length}`);
  const G = 8, cell = new Float64Array(G * G), cellN = new Float64Array(G * G);
  const vis = Buffer.alloc(w * h * 4);
  let sum = 0, max = 0, over = 0, lum = 0, lum2 = 0;
  const n = w * h;
  for (let y = 0; y < h; y++) {
    const gy = Math.min(G - 1, Math.floor(y * G / h));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
      sum += d; if (d > max) max = d; if (d > 1) over++;
      const g = gy * G + Math.min(G - 1, Math.floor(x * G / w)); cell[g] += d; cellN[g]++;
      const L = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114; lum += L; lum2 += L * L;
      const v = Math.min(255, Math.round(d * amplify));
      vis[i] = vis[i + 1] = vis[i + 2] = v; vis[i + 3] = 255;
    }
  }
  const mean = lum / n, sd = Math.sqrt(Math.max(0, lum2 / n - mean * mean));
  const map = [];
  for (let gy = 0; gy < G; gy++) {
    let s = '';
    for (let gx = 0; gx < G; gx++) { const m = cell[gy * G + gx] / (cellN[gy * G + gx] || 1); s += RAMP[Math.min(RAMP.length - 1, Math.round(m))]; }
    map.push(s);
  }
  return { mean: +(sum / n).toFixed(3), max: +max.toFixed(1), pctOver1: +(100 * over / n).toFixed(2), sd: +sd.toFixed(2), map, vis };
}
