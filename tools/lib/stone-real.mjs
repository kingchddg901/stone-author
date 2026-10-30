// PACKING A REAL STONE SCENE FOR THE SHADER.
//
// WHAT THE SHADER IS RESPONSIBLE FOR, and it is not the whole tile. renderOneTile lays the ground,
// calls its `paint` callback, then applies the coat and the reality windows - and the callback
// REPLACES paintContent, not just the content layers. So the shader owns exactly what
// paintStoneContent owns: the base modulators (breccia, clouds, bands) and then every content layer
// in authored order. The coat stays on the CPU, which is what makes one dispatch enough: applyCoat is
// twelve box-blur passes and a per-pixel shader cannot do it in one.
//
// AND THE GROUND IS REPRODUCED, NOT INHERITED. The shader has no sight of the canvas renderOneTile
// just filled, and clouds composites with SOFT-LIGHT, which needs its real backdrop - source-over is
// associative and soft-light is not, so clouds cannot be floated on transparency and blitted. The
// ground is two flat fills (STONE_BG, then groundCol at layOp('base')), so the shader lays it again
// from two packed colours and returns an OPAQUE face that replaces the region it covers.
//
// THE ARENA IS ONE Float32Array WITH NAMED OFFSETS, which is this repo's idiom for both other
// materials; the uniform names its own slots so the pool can ask for one by name rather than keeping
// a second copy of the layout.

const H = 0.625;                  // draw space is 1 x H; y = H is the frame bottom

// the arena's parts, in the order the uniform's offsets name them
const PART_NAMES = [
  'CLOUD',                        // the clouds mottle, one float a texel, bilinear in the shader
  'BREC',                         // breccia: a base SETTER, so THREE floats a texel - it carries colour
  'BAND',                         // the directional bands, grey like the clouds and soft-lit like them
  'LAY',                          // one record per content layer, in AUTHORED order
  'BLOB', 'FCS', 'FCI',           // fog: discs in draw space, and a grid per plane
  'SEG', 'CH', 'MCS', 'MCI',      // marks: segments in draw space, chunk records, and a grid per pass
  'POLY', 'PV',                   // specks: one record a speck, and its vertices in draw space
];

// WHICH PART CARRIES WHAT - the packer's CLAIM, so a gate holds it to this rather than to a comment.
const FIELD_PARTS = {
  cloud: 'CLOUD', brec: 'BREC', band: 'BAND', layer: 'LAY',
  blob: 'BLOB', fogCellStart: 'FCS', fogCellIndex: 'FCI',
  segment: 'SEG', chunk: 'CH', markCellStart: 'MCS', markCellIndex: 'MCI',
  poly: 'POLY', polyVertex: 'PV',
};

// A LAYER IS ONE RECORD WHATEVER KIND IT IS, because the shader walks them in authored order and
// kinds interleave - minor sits between two fog runs in his own slab. One stride, one loop, a kind
// field to branch on. Fog carries its colour and its collapsed filter matrix here; a mark layer's
// colour varies per chunk and lives in CH instead.
const LAY_STRIDE = 32;
const LAY_FIELDS = [
  'kind',                                                   // 0 = fog plane, 1 = mark pass, 2 = speck pass
  'alpha', 'colR', 'colG', 'colB',
  'm0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8',      // the filter chain, collapsed
  'offR', 'offG', 'offB',
  'oPrim', 'nPrim',                                          // into BLOB (fog), CH (marks) or POLY (specks)
  'oCS', 'oCI', 'pad8', 'pad9', 'pad10',                     // the grid is GLOBAL; see the uniform
  'pad0', 'pad1', 'pad2', 'pad3', 'pad4', 'pad5', 'pad6', 'pad7',
];
if (LAY_FIELDS.length !== LAY_STRIDE) throw new Error('LAY_FIELDS is ' + LAY_FIELDS.length + ', stride is ' + LAY_STRIDE);

// A CHUNK is runs()'s unit: up to six segments stroked as ONE path, so one width, one colour and one
// alpha. Its segments are a SET, not a path - round caps and joins make the union indifferent to
// whether they connect, which is why a keep=false gap needs no representation at all.
const CH_STRIDE = 8;
const CH_FIELDS = ['width', 'colR', 'colG', 'colB', 'alpha', 'oSeg', 'nSeg', 'blurS'];
if (CH_FIELDS.length !== CH_STRIDE) throw new Error('CH_FIELDS is ' + CH_FIELDS.length + ', stride is ' + CH_STRIDE);

// A SPECK IS A CLOSED PATH, not a stroke, and it is the one kind of this material that a capsule
// cannot stand in for. paintSpecksLayer walks s.n vertices at equally spaced angles, each at its own
// jittered radius, then scales across by s.el and turns the whole thing by s.ang - which is
// STAR-SHAPED about the centre rather than convex, so the max-of-halfplanes trick that works for a
// convex polygon reports a point outside a notch as inside. The vertices are resolved to draw space
// by the scene and land in PV; a record names where its own run starts and how long it is, the same
// shape a chunk names its segments.
const POLY_STRIDE = 8;
const POLY_FIELDS = ['colR', 'colG', 'colB', 'alpha', 'oVert', 'nVert', 'pad0', 'pad1'];
if (POLY_FIELDS.length !== POLY_STRIDE) throw new Error('POLY_FIELDS is ' + POLY_FIELDS.length + ', stride is ' + POLY_STRIDE);

// WHAT ctx.filter's blur ACTUALLY IS, in one number. It is not a Gaussian: the SVG filter spec
// prescribes THREE BOX passes, with the box width quantised to a whole number of pixels -
// d = floor(sigma * 3 * sqrt(2*PI) / 4 + 0.5), three boxes of d when d is odd and two of d plus one
// of d+1 when it is even. So the deviation the canvas really applies is the square root of the sum
// of those boxes' variances, (w*w - 1)/12 each, and it STEPS: measured on the canvas itself,
// a 0.9 token and a 1.25 token produce byte-identical profiles, because both land on d = 2.
//
// MEASURED AGAINST THE CANVAS, a single stroke's cross-section at four widths and five radii: this
// sigma fed to the closed form below scores rms 0.80 to 1.11 levels of 255 with a worst sample of
// 2.3 to 3.0, against a least-squares CEILING of 0.61 to 0.77 for any single-sigma formula. Half a
// level from the best possible, with nothing to calibrate - and the same order as the error the
// unblurred stroke already carries, which is the per-stroke 8-bit compositing rounding.
const boxSigma = N => {
  const d = Math.floor(N * 3 * Math.sqrt(2 * Math.PI) / 4 + 0.5);
  if (!(d >= 1)) return 0;                                  // below one box there is nothing to blur
  const v = w => (w * w - 1) / 12;
  return Math.sqrt((d % 2) ? 3 * v(d) : 2 * v(d) + v(d + 1));
};

// tileX, tileY and tileH ARE INTEGERS because the pool patches them with setInt32 per band, and
// tileW/tileH are named exactly that because the borrowed readback entries read E.tileW and E.tileH.
const UNI_FLOAT_NAMES = [
  'fullW', 'bgR', 'bgG', 'bgB',
  'gndR', 'gndG', 'gndB', 'gndOp',
  'cloudOp', 'cloudW', 'cloudH', 'blGain',
  'brecOp', 'brecW', 'brecH', 'bandOp',
  'bandW', 'bandH',
];
const UNI_INT_NAMES = [
  'tileW', 'tileH', 'tileX', 'tileY',
  'nLay', 'hasGround', 'hasCloud', 'gx',
  'hasBrec', 'hasBand',
  'gy', 'blOn', 'blD', 'blMode',
  ...PART_NAMES.map(n => 'o' + n),
  'blRS', 'padi2', 'padi3',
];
const UNI_BYTES = 256;
const UNI_FLOATS = UNI_FLOAT_NAMES.length;
const UNI_INTS = UNI_INT_NAMES.length;
if ((UNI_FLOATS + UNI_INTS) * 4 > UNI_BYTES) throw new Error('stone uniform needs ' + (UNI_FLOATS + UNI_INTS) * 4 + ' bytes');

// WHERE ONE FIELD LIVES, BY NAME. The pool patches three of these per band and asks here rather than
// carrying byte offsets of its own - which is what the glass pool does, and what made its OFF_TX a
// third copy of the layout.
function uniOffset(n) {
  const f = UNI_FLOAT_NAMES.indexOf(n);
  if (f >= 0) return f * 4;
  const i = UNI_INT_NAMES.indexOf(n);
  if (i >= 0) return UNI_FLOATS * 4 + i * 4;
  throw new Error('stone uniform has no field ' + n);
}

const hexRGB = h => {
  const s = String(h == null ? '' : h).replace('#', '');
  const n = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
  const v = [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
  return v.some(x => !(x >= 0)) ? [0, 0, 0] : v;
};

// ---------------------------------------------------------------- the filter chain, collapsed
//
// FOUR OF THE FIVE FILTERS COLLAPSE INTO TWELVE NUMBERS, and it is a derivation with a measurement
// behind it. A canvas gradient and a stroke both present the filter with an UNPREMULTIPLIED colour,
// and a CSS colour-matrix filter leaves alpha alone - so hue-rotate, saturate and brightness fold
// into a 3x3 and contrast adds an offset (v' = c*v + (0.5 - 0.5c)). Composed in the order filterOf
// prints them, a layer needs a matrix and a vector and the shader needs no filter code.
//
// MEASURED on his own values - fog#2 is saturate 4 then brightness 9, fog#6 adds contrast 3 - against
// a single blob over black at eight radii: unclamped is off by up to 180 levels, CLAMPED is exact at
// every sample but the faintest. Clamping is required; the two clamp models (once at the end, or
// between every stage) agree to the level on everything tried, so the shader clamps once because it
// is the cheaper of two models the data cannot separate.
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mul3 = (A, B) => {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++)
    o[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
  return o;
};
const apply3 = (M, v) => [
  M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
  M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
  M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
const satM = s => [
  0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
  0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
  0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
const hueM = deg => {                                       // the SVG hueRotate matrix, verbatim
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072];
};

function collapseFilter(adj) {
  const hue = adj.hue || 0, sat = adj.sat === undefined ? 1 : adj.sat;
  const br = adj.bright === undefined ? 1 : adj.bright;
  const ct = adj.contrast === undefined ? 1 : adj.contrast;
  let M = I3, off = [0, 0, 0];
  const stage = (L, o) => { M = mul3(M, L); off = apply3(L, off).map((v, i) => v + o[i]); };
  if (hue) stage(hueM(hue), [0, 0, 0]);
  if (sat !== 1) stage(satM(sat), [0, 0, 0]);
  if (br !== 1) stage([br, 0, 0, 0, br, 0, 0, 0, br], [0, 0, 0]);
  if (ct !== 1) stage([ct, 0, 0, 0, ct, 0, 0, 0, ct], [0.5 - 0.5 * ct, 0.5 - 0.5 * ct, 0.5 - 0.5 * ct]);
  return { M, off: off.map(v => v * 255) };
}

// ---------------------------------------------------------------- the grid
//
// COUNTING SORT, AND THE SECOND SWEEP GOES IN PRIMITIVE ORDER. Each cell's slots therefore fill in
// ascending primitive index, so a cell's list is the paint order restricted to that cell - which is
// required, not incidental, because a fading source makes source-over order-dependent. A grid that
// scrambled the order would be wrong in a way no radius tuning would fix.
//
// PRIMITIVES ARE BINNED BY A BOUNDING DISC, a superset of the shape: a few wasted distance tests, and
// never a lit pixel dropped. The pad is the stroke's or blob's own reach plus one pixel for the
// coverage ramp - bin a centreline and the stroke's edge falls out of its cell and vanishes.
function binDiscs(discs, gx, gy) {
  const cw = 1 / gx, ch = H / gy, nc = gx * gy;
  const span = discs.map(([x, y, r]) => [
    Math.max(0, Math.floor((x - r) / cw)), Math.min(gx - 1, Math.floor((x + r) / cw)),
    Math.max(0, Math.floor((y - r) / ch)), Math.min(gy - 1, Math.floor((y + r) / ch))]);
  const cnt = new Uint32Array(nc);
  for (const [i0, i1, j0, j1] of span)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cnt[j * gx + i]++;
  const cs = new Uint32Array(nc + 1);
  for (let k = 0; k < nc; k++) cs[k + 1] = cs[k] + cnt[k];
  const ci = new Uint32Array(cs[nc]);
  const fill = cs.slice(0, nc);
  span.forEach(([i0, i1, j0, j1], b) => {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) ci[fill[j * gx + i]++] = b;
  });
  let mx = 0;
  for (let k = 0; k < nc; k++) if (cnt[k] > mx) mx = cnt[k];
  return { gx, gy, cs, ci, cells: nc, mean: nc ? ci.length / nc : 0, max: mx };
}

// THE GRID IS GLOBAL AND LIVES IN DRAW SPACE, which is not a preference - it is what the framework
// forces. gpuPool calls pack(ew, W) ONCE per render and then patches only tileX, tileY and tileH per
// band, so anything built in tile-local pixels is per-tile data that cannot survive the patch. The
// first spelling of this binned in tile pixels at tileX = 0: every grid came back with ZERO non-empty
// cells for every tile but the top-left one, the shader drew bare ground, and it did it in 0.38 ms
// because the inner loops never ran. A grid over 0..1 x 0..H is packed once and read by every tile.
//
// ITS RESOLUTION FOLLOWS THE RENDER so the cell stays in the range the sweep liked. For a fog plane,
// cells of 8/16/32/64/128 px measured 0.076/0.085/0.106/0.152/0.266 ms on a preview-sized surface and
// 0.111/0.112/0.120/0.134/0.177 ms on a 512 tile of a 4096 render - flat to within 1.6x across the
// whole range on a tile, which is what makes a scale-following grid safe. Capped at 512 across so the
// cell tables stay small at 32768 (512 x 320 cells is 164k slots a layer).
const gridFor = W => {
  const gx = Math.max(64, Math.min(512, Math.round(W / 24)));
  return { gx, gy: Math.max(1, Math.round(gx * H)) };
};

// ---------------------------------------------------------------- the packer
//
// `scene` is assembled by the app, which is the only thing that can read its own closure:
//   bg, ground, groundOp, hasGround        the two flat fills renderOneTile laid
//   cloud { w, h, data, op } | null        ensureClouds()'s pixels, one float a texel
//   layers [...]                           content layers in AUTHORED order, already filtered to
//                                          the ones that paint, each either
//     { kind:'fog',  col, alpha, adj, blobs:[[x,y,r],...] }            draw space
//     { kind:'mark', chunks:[{segs:[[ax,ay,bx,by],...], width, col, alpha, blurPx}] }  draw space,
//                                          blurPx in OUTPUT pixels - ctx.filter ignores the CTM
//     { kind:'poly', polys:[{verts:[[x,y],...], col, alpha}] }                  draw space, closed
function packStone(scene, view) {
  const { tileW, tileH, tileX, tileY, fullW } = view;
  const { gx, gy } = gridFor(fullW);
  const parts = { CLOUD: [], BREC: [], BAND: [], LAY: [], BLOB: [], FCS: [], FCI: [], SEG: [],
                  CH: [], MCS: [], MCI: [], POLY: [], PV: [] };

  const cloud = scene.cloud || null;
  if (cloud) for (let i = 0; i < cloud.data.length; i++) parts.CLOUD.push(cloud.data[i]);
  // THE SAME SHAPE FOR THE OTHER TWO MODULATORS, because they are the same thing: a small map built
  // once over the whole slab and stretched across it. Breccia is three floats a texel rather than
  // one - it SETS the ground rather than modulating it, so it carries colour and not a lightness.
  const brec = scene.brec || null;
  if (brec) for (let i = 0; i < brec.data.length; i++) parts.BREC.push(brec.data[i]);
  const band = scene.band || null;
  if (band) for (let i = 0; i < band.data.length; i++) parts.BAND.push(band.data[i]);

  for (const L of scene.layers) {
    const V = {};
    for (const n of LAY_FIELDS) V[n] = 0;

    if (L.kind === 'fog') {
      if (!(L.alpha > 0)) throw new Error('packStone: fog layer with alpha ' + L.alpha + ' should not be packed');
      if (!Array.isArray(L.blobs) || !L.blobs.length) throw new Error('packStone: fog layer, no blobs');
      const oPrim = parts.BLOB.length / 3;
      const discs = [];
      for (const [x, y, r] of L.blobs) {
        parts.BLOB.push(x, y, r);                           // draw space, resolution-independent
        discs.push([x, y, r + 1 / fullW]);                  // and binned there too, plus the ramp
      }
      const g = binDiscs(discs, gx, gy);
      const col = hexRGB(L.col);
      const { M, off } = collapseFilter(L.adj || {});
      V.kind = 0; V.alpha = L.alpha;
      V.colR = col[0]; V.colG = col[1]; V.colB = col[2];
      for (let k = 0; k < 9; k++) V['m' + k] = M[k];
      V.offR = off[0]; V.offG = off[1]; V.offB = off[2];
      V.oPrim = oPrim; V.nPrim = L.blobs.length;
      V.oCS = parts.FCS.length; V.oCI = parts.FCI.length;
      for (const v of g.cs) parts.FCS.push(v);
      for (const v of g.ci) parts.FCI.push(v);
    } else if (L.kind === 'mark') {
      if (!Array.isArray(L.chunks) || !L.chunks.length) throw new Error('packStone: mark layer, no chunks');
      const oPrim = parts.CH.length / CH_STRIDE;
      const discs = [];
      for (const C of L.chunks) {
        if (!(C.width > 0)) throw new Error('packStone: chunk with width ' + C.width);
        if (!(C.alpha > 0)) throw new Error('packStone: chunk with alpha ' + C.alpha);
        if (!Array.isArray(C.segs) || !C.segs.length) throw new Error('packStone: chunk carries no segments');
        const oSeg = parts.SEG.length / 4;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [ax, ay, bx, by] of C.segs) {
          parts.SEG.push(ax, ay, bx, by);
          x0 = Math.min(x0, ax, bx); x1 = Math.max(x1, ax, bx);
          y0 = Math.min(y0, ay, by); y1 = Math.max(y1, ay, by);
        }
        const col = hexRGB(C.col);
        // THE BLUR IS AN OUTPUT-PIXEL QUANTITY AND STAYS ONE. ctx.filter is applied in device space
        // and is not scaled by the transform, so a blur token is the same number of pixels at every
        // render width - which is exactly what makes a closed form possible: sigma is a constant
        // per chunk rather than something the shader has to derive from the scale.
        const blurS = C.blurPx > 0 ? boxSigma(C.blurPx) : 0;
        const R = { width: C.width, colR: col[0], colG: col[1], colB: col[2],
                    alpha: C.alpha, oSeg, nSeg: C.segs.length, blurS };
        const miss = CH_FIELDS.filter(n => !(n in R));
        if (miss.length) throw new Error('packStone: nothing supplies chunk ' + miss.join(', '));
        for (const n of CH_FIELDS) parts.CH.push(R[n]);
        // THE STROKE'S BOX, NOT THE CENTRELINE'S: a capsule reaches half a width past its ends in
        // every direction, plus one pixel for the coverage ramp. Bin the centreline and the stroke's
        // own edge falls out of its cell and vanishes.
        // AND THE BIN PAD GROWS WITH IT. A blurred stroke reaches three deviations past its own
        // edge; bin it at the hard edge and the soft tail falls out of its cell and is cut off
        // square, which is a visible straight line along a cell boundary.
        const pad = C.width / 2 + (1 + 3 * blurS) / fullW;
        discs.push([(x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2 + pad]);
      }
      const g = binDiscs(discs, gx, gy);
      V.kind = 1;
      V.oPrim = oPrim; V.nPrim = L.chunks.length;
      V.oCS = parts.MCS.length; V.oCI = parts.MCI.length;
      for (const v of g.cs) parts.MCS.push(v);
      for (const v of g.ci) parts.MCI.push(v);
    } else if (L.kind === 'poly') {
      if (!Array.isArray(L.polys) || !L.polys.length) throw new Error('packStone: poly layer, no polys');
      const oPrim = parts.POLY.length / POLY_STRIDE;
      const discs = [];
      for (const P of L.polys) {
        if (!(P.alpha > 0)) throw new Error('packStone: poly with alpha ' + P.alpha);
        if (!Array.isArray(P.verts) || P.verts.length < 3) throw new Error('packStone: poly needs three vertices');
        const oVert = parts.PV.length / 2;
        let cx = 0, cy = 0;
        for (const [x, y] of P.verts) { parts.PV.push(x, y); cx += x; cy += y; }
        cx /= P.verts.length; cy /= P.verts.length;
        const col = hexRGB(P.col);
        const R = { colR: col[0], colG: col[1], colB: col[2], alpha: P.alpha,
                    oVert, nVert: P.verts.length, pad0: 0, pad1: 0 };
        const miss = POLY_FIELDS.filter(n => !(n in R));
        if (miss.length) throw new Error('packStone: nothing supplies poly ' + miss.join(', '));
        for (const n of POLY_FIELDS) parts.POLY.push(R[n]);
        // THE BINNING DISC IS THE CIRCUMCIRCLE OF THE VERTICES, not the speck radius: s.el stretches
        // one axis and the jitter pushes single vertices out, so a disc of s.rad drops the corner
        // that reaches furthest - and a dropped corner is a speck with a bite out of it in exactly
        // one cell. Plus a pixel for the coverage ramp, like every other primitive here.
        let rr = 0;
        for (const [x, y] of P.verts) rr = Math.max(rr, Math.hypot(x - cx, y - cy));
        discs.push([cx, cy, rr + 1 / fullW]);
      }
      const g = binDiscs(discs, gx, gy);
      V.kind = 2;
      V.oPrim = oPrim; V.nPrim = L.polys.length;
      // THE SPECK GRID SHARES THE MARK TABLES on purpose. A cell list is a run of primitive indices
      // and nothing in it knows what kind it indexes - the layer record already says that - so a
      // third pair of tables would be two more offsets in the uniform for no new information.
      V.oCS = parts.MCS.length; V.oCI = parts.MCI.length;
      for (const v of g.cs) parts.MCS.push(v);
      for (const v of g.ci) parts.MCI.push(v);
    } else {
      throw new Error('packStone: unknown layer kind ' + L.kind);
    }

    // A DECLARED FIELD NOTHING SUPPLIES is the defect from the packer side: the record names it, the
    // shader reads it, and it is quietly zero for the life of the port.
    const miss = LAY_FIELDS.filter(n => !(n in V));
    if (miss.length) throw new Error('packStone: nothing supplies layer ' + miss.join(', '));
    for (const n of LAY_FIELDS) parts.LAY.push(V[n]);
  }

  const offs = {}; let at = 0;
  for (const n of PART_NAMES) { offs[n] = at; at += Math.max(parts[n].length, 1); }
  const arena = new Float32Array(at);
  for (const n of PART_NAMES) if (parts[n].length) arena.set(parts[n], offs[n]);

  const bg = hexRGB(scene.bg), gnd = hexRGB(scene.ground);
  const V = {
    fullW, bgR: bg[0], bgG: bg[1], bgB: bg[2],
    gndR: gnd[0], gndG: gnd[1], gndB: gnd[2],
    gndOp: scene.hasGround ? (scene.groundOp === undefined ? 1 : scene.groundOp) : 0,
    cloudOp: cloud ? (cloud.op === undefined ? 1 : cloud.op) : 0,
    cloudW: cloud ? cloud.w : 0, cloudH: cloud ? cloud.h : 0,
    brecOp: brec ? (brec.op === undefined ? 1 : brec.op) : 0,
    brecW: brec ? brec.w : 0, brecH: brec ? brec.h : 0,
    bandOp: band ? (band.op === undefined ? 1 : band.op) : 0,
    bandW: band ? band.w : 0, bandH: band ? band.h : 0,
    tileW, tileH, tileX, tileY,
    nLay: scene.layers.length, hasGround: scene.hasGround ? 1 : 0, hasCloud: cloud ? 1 : 0,
    hasBrec: brec ? 1 : 0, hasBand: band ? 1 : 0,
    gx, gy, padi2: 0, padi3: 0,
    // THE BLOOM'S FOUR, PATCHED PER PASS AND NOT PACKED FROM THE SCENE. blOn is the only one the
    // scene could answer and it is still written by the pool, because the pool is what knows whether
    // it got the buffers - a document that wants the bloom and a device that will run it are two
    // different facts. Zero here means main dithers as it always did.
    blGain: 0, blOn: 0, blD: 0, blMode: 0, blRS: 0,
  };
  for (const n of PART_NAMES) V['o' + n] = offs[n];
  const absent = [...UNI_FLOAT_NAMES, ...UNI_INT_NAMES]
    .filter(n => !n.startsWith('pad') && !(n in V));
  if (absent.length) throw new Error('packStone: nothing supplies ' + absent.join(', '));

  const b = new ArrayBuffer(UNI_BYTES), d = new DataView(b);
  const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  UNI_FLOAT_NAMES.forEach((n, i) => d.setFloat32(i * 4, num(V[n]), true));
  UNI_INT_NAMES.forEach((n, i) => d.setInt32(UNI_FLOATS * 4 + i * 4, num(V[n]) | 0, true));

  return { uni: b, arena, offs, parts,
    summary: {
      layers: scene.layers.length,
      fog: scene.layers.filter(L => L.kind === 'fog').length,
      marks: scene.layers.filter(L => L.kind === 'mark').length,
      specks: scene.layers.filter(L => L.kind === 'poly').length,
      polys: parts.POLY.length / POLY_STRIDE,
      polyVerts: parts.PV.length / 2,
      blobs: parts.BLOB.length / 3,
      chunks: parts.CH.length / CH_STRIDE,
      segments: parts.SEG.length / 4,
      cloud: cloud ? cloud.w + 'x' + cloud.h : 'none',
      grid: gx + 'x' + gy, cellPx: +(fullW / gx).toFixed(1), arenaFloats: at,
    } };
}

export { PART_NAMES, FIELD_PARTS, LAY_FIELDS, LAY_STRIDE, CH_FIELDS, CH_STRIDE,
         POLY_FIELDS, POLY_STRIDE, gridFor, boxSigma,
         UNI_FLOAT_NAMES, UNI_INT_NAMES, UNI_BYTES, UNI_FLOATS, UNI_INTS,
         uniOffset, packStone, collapseFilter, binDiscs, hexRGB };
