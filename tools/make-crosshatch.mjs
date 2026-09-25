// Author the test slab as DATA: a crosshatch of near-straight veins on an empty plane, plus a moon whose
// path is exactly 120 resample steps long, so one frame is one step and the drag grows perfectly evenly.
//
// Built from gallery/slabs/before.json so the layer schema, G and T come from a slab the app wrote itself
// rather than from my reconstruction of them — then the speck/web/styl/fog layers are removed, which is
// what takes the rebuild from 5,070 ms to 18 ms and leaves the plane empty for the crosshatch to sit on.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const STEP = 0.006;                       // applyMoon's own resample spacing
const FRAMES = 120;                       // 5 seconds at 24 fps
const L = STEP * FRAMES;                  // 0.72 — one step per frame
const H = 0.625;                          // slab is 1.0 x 0.625 in frame coordinates

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = JSON.parse(readFileSync(join(root, 'gallery', 'slabs', 'before.json'), 'utf8'));
const hero = JSON.parse(readFileSync(join(root, 'gallery', 'slabs', 'Hero_Psyker.json'), 'utf8'));
const proto = src.marks.find(m => m.kind === 'vein');

// --- the crosshatch -------------------------------------------------------------------------------
// "almost dead straight": a slow waver of a few thousandths, so it reads as stone rather than as a ruler.
const waver = (i, n, seed) => 0.005 * Math.sin((i / (n - 1)) * Math.PI * 1.7 + seed);
const stroke = (n, f) => Array.from({ length: n }, (_, i) => { const t = i / (n - 1); const [x, y] = f(t, i, n); return [+x.toFixed(5), +y.toFixed(5), +t.toFixed(5)]; });

const P = { ...proto.p, branches: 0, breaks: 0, rough: 0.35, gauge: 1.6, variant: 'natural' };
const marks = [];
let id = 1;
[0.25, 0.5, 0.75].forEach((x, k) => marks.push({
  id: id++, kind: 'vein', seed: 1000 + k * 37, layer: 'major', fam: src.fam, p: { ...P },
  samples: stroke(16, (t, i, n) => [x + waver(i, n, k * 2.1), 0.05 + t * (H - 0.10)]),
}));
[0.16, 0.3125, 0.47].forEach((y, k) => marks.push({
  id: id++, kind: 'vein', seed: 2000 + k * 53, layer: 'major', fam: src.fam, p: { ...P },
  samples: stroke(16, (t, i, n) => [0.05 + t * 0.90, y + waver(i, n, 4 + k * 1.3)]),
}));

// --- the moon's path ------------------------------------------------------------------------------
// A shallow S across the middle, so it crosses several intersections and the drag reads differently at
// each. Generated dense, then cut to exactly L of arc length.
// A bowed diagonal from just above the top horizontal to just below the bottom one, so the ball visits
// all three in turn instead of running along the centre line and leaving two of them as controls.
const AX = 0.18, AY = 0.15, DX = 0.65, DY = 0.32, BOW = 0.03;   // sized so the curve is a shade LONGER than L, and the cut lands on 0.72 exactly
const dense = [];
for (let i = 0; i <= 4000; i++) {
  const u = i / 4000, b = Math.sin(u * Math.PI) * BOW;      // perpendicular bow, zero at both ends
  const len = Math.hypot(DX, DY), nx = -DY / len, ny = DX / len;
  dense.push([AX + DX * u + nx * b, AY + DY * u + ny * b]);
}
const path = [dense[0]];
let acc = 0;
for (let i = 1; i < dense.length && acc < L; i++) {
  const d = Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
  if (acc + d > L) {                                   // land exactly on L
    const u = (L - acc) / d;
    path.push([dense[i - 1][0] + (dense[i][0] - dense[i - 1][0]) * u,
               dense[i - 1][1] + (dense[i][1] - dense[i - 1][1]) * u]);
    acc = L; break;
  }
  acc += d; path.push(dense[i]);
}
const moonPath = path.map((p, i) => [+p[0].toFixed(5), +p[1].toFixed(5), +(i / (path.length - 1)).toFixed(5)]);

marks.push({ id: id++, kind: 'moon', seed: 7777, fam: src.fam, samples: moonPath,
             p: { ...proto.p, moonReach: 1.4, moonStrength: 2.1 } });

// --- the slab -------------------------------------------------------------------------------------
const out = { ...src };
out.marks = marks;
out.nextId = id;
out.layers = src.layers.filter(L2 => !(L2.bucket === 'micro' || ['web', 'styl'].includes(L2.key) || L2.key.startsWith('fog')));
out.G = { ...src.G, warp: 0, brecStrength: 0, cloudStrength: 0, bandStrength: 0,
          specular: 0.35, subsurface: 0.3, lens: 0, backlight: 0 };
// KEEP src.OVR: before.json already carries the gold-on-black palette (ground #08080b, lay:major
// #b5811f). Clearing it is what made the first sheet come out as grey carrara on near-white.
out.OVR = src.OVR; out.perItem = {}; out.hidden = [];

// The strain primitive's settings, at BUCKET level, so the slab carries the effect rather than a harness:
// the veins reveal the hero's own second spectrum in proportion to how far the warp moved them.
out.OVR_uv = { 'lay:major': hero.OVR_uv['lay:major'] };
out.OVR['major:strain'] = 1; out.OVR['major:strainSpx'] = -1; out.OVR['major:strainScale'] = 0.06;

const dst = process.argv[2] || join(root, 'test-slabs', 'crosshatch.json');
writeFileSync(dst, JSON.stringify(out));
console.log(`crosshatch -> ${dst}`);
console.log(`  ${marks.length - 1} veins + 1 moon`);
console.log(`  moon path: ${moonPath.length} points, arc length ${acc.toFixed(4)} (target ${L}) -> ${Math.round(acc / STEP)} steps`);
console.log(`  path used: ${(acc / L * 100).toFixed(1)}% of the designed curve`);
console.log(`  layers kept: ${out.layers.map(l => l.key).join(', ')}`);
console.log(`  strain: ${out.OVR['major:strain']} at spectrum ${out.OVR['major:strainSpx']}, scale ${out.OVR['major:strainScale']}`);
