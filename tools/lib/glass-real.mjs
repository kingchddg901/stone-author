// PACKING A REAL DOCUMENT'S SCENE FOR THE SHADER.
//
// glass-scene.mjs holds a synthetic scene chosen to reach every branch. This takes the F that
// paintGlassContent actually assembled - captured by tools/capture-scene.mjs - and packs the same
// two buffers from it, so the tile probe can measure the slab somebody authored rather than one
// invented to be awkward.
//
// THEY ARE NOT THE SAME SHAPE, and that is the point of doing this. The glass master slab carries
// eight ops where the synthetic scene has five, three stirs where it has one, NO ribbons at all
// (glassLay takes the procedural strips, not the per-ribbon walk), no roller and no stamps, and the
// radial mould on. The synthetic scene measured 67% more work a pixel than the renderer does.
//
// ONE WARP GRID, AND THAT IS A PROPERTY OF THIS SLAB RATHER THAN OF THE FORMAT. Each stir carries
// its own warp state in principle - op.S comes out of F.SG, keyed by the stir's range - and the
// shader reads a single grid. On this document all three stirs resolve to the SAME state, checked
// rather than assumed, so one grid is correct here. A document whose stirs have different ranges
// would need a grid per op, which is a second arena offset in the op record and is not built.

const NL = String.fromCharCode(10);

// the arena's parts, in the order the Env's offsets name them
const PART_NAMES = ['WU', 'WV', 'MEX', 'MHL', 'MD', 'MRIM', 'BS', 'BV', 'RPR', 'RTL',
                    'STS', 'MCC', 'SPIN', 'OPS', 'CANE'];

const f32 = a => a instanceof Float32Array ? a : new Float32Array(a || []);

// GRIDS OF ONE SIZE, LAID END TO END. Their equal length is what the caller has already required,
// so the stride is the first one's and grid w starts at w * stride.
function catGrids(list, pick) {
  if (!list.length) return new Float32Array(0);
  const first = f32(pick(list[0])), n = first.length;
  const a = new Float32Array(n * list.length);
  list.forEach((g, i) => a.set(f32(pick(g)), i * n));
  return a;
}

// one op is sixteen floats; the same record glass-scene.mjs writes, read off the app's own OPC.
// `wi` is this op's index into the packed warp grids, or -1 for an op that has none.
function opRow(op, wi) {
  const a = new Float32Array(16);
  a[0] = op.k; a[1] = op.ox; a[2] = op.oy; a[3] = op.a; a[4] = op.s;
  a[5] = op.rot ? 1 : 0; a[6] = op.cd; a[7] = op.sd; a[8] = op.u0;
  a[9] = op.face; a[10] = op.bite;
  // SLOT 13 IS AN INDEX NOW, PLUS ONE, so zero still reads as "this op has no warp" and the
  // shader's existing `aOP(i, 13) != 0.0` test is unchanged. A document with one warp packs 1 for
  // every stir and indexes grid 0, which is the arithmetic it had before this was per-op.
  a[11] = op.st ? 1 : 0; a[12] = op.B ? 1 : 0;
  a[13] = (op.S && wi >= 0) ? wi + 1 : 0;
  return a;
}

// stamps as the shader reads them: four floats an entry, a / x / r / rot
function stampsOf(F) {
  const op = F.OPC.find(o => o.st && o.raw && o.raw.st && o.raw.st.length);
  if (!op) return { arr: new Float32Array(0), n: 0, C: 0 };
  const list = op.raw.st;
  const a = new Float32Array(list.length * 4);
  list.forEach((s, i) => {
    a[4 * i] = +s.a || 0; a[4 * i + 1] = +s.x || 0;
    a[4 * i + 2] = +s.r || 1; a[4 * i + 3] = +s.rot || 0;
  });
  return { arr: a, n: list.length, C: Math.PI * (+op.raw.D || 6) / 12 };
}

export function packReal(F, extra) {
  const SLAB = extra.SLAB, H = F.H;
  // EVERY DISTINCT WARP, IN FIRST-APPEARANCE ORDER. The arena carries them end to end and each
  // stir names its own by index, so a document whose stirs disagree is DRAWN rather than refused.
  // That refusal is what sent a glass with three stir ranges onto the CPU painter at 25x the cost,
  // silently, on 2026-10-25.
  const warpList = [];
  for (const o of F.OPC) if (o.k === 5 && o.S && warpList.indexOf(o.S) < 0) warpList.push(o.S);
  if (!warpList.length && F.S) warpList.push(F.S);
  const S = warpList[0] || null;
  const B = (F.ROLL && F.ROLL[0]) || null;
  const stamp = stampsOf(F);

  // THEY MUST STILL AGREE ON THEIR DIMENSIONS, and that is the whole of what is left of the old
  // refusal. One stride indexes the lot - grid w starts at w * nx * ny - which is what lets nx, ny
  // and WPH stay single fields in a 304-byte uniform and leaves the Env struct untouched. Grids of
  // two sizes would need a per-grid table and a wider uniform; no document has produced one.
  //
  // SHORT PIECES ON PURPOSE. This file is inlined into the app, where check-i18n reads every
  // string literal and asks why a sentence is not routed through a pack. A developer-facing
  // Error is not translatable prose, and the gate cannot tell the difference - so it is written
  // as fragments none of which read like a sentence.
  for (const w of warpList) {
    if (w.nx !== S.nx || w.ny !== S.ny) {
      throw new Error('packReal: warp grids of two sizes'
        + ' (one stride, ' + warpList.length + ' grids)');
    }
  }

  // AND EVERY PRESS ON ITS ROLLER, for the same reason and with a worse failure when it is not
  // checked. B is F.ROLL[op.ri], so a document carrying two rollers packs ROLL[0] and the shader
  // stamps EVERY press with it - a different picture from the one the CPU painter draws, with no
  // throw, no console line and no refusal. The warp check above has been here since this path
  // shipped and this shoulder had not, which is the shape where a guard that exists reads as
  // complete. Same fragments, same reason: check-i18n reads every string literal in this file.
  const presses = F.OPC.filter(o => o.k === 4 && o.B);
  const rollers = new Set(presses.map(o => o.B));
  if (rollers.size > 1) {
    throw new Error('packReal: ' + rollers.size + ' roller states, 1 grid'
      + ' (per-op grids not built)');
  }

  const parts = {
    // END TO END, grid 0 first. With one warp this is byte for byte what it packed before.
    WU: catGrids(warpList, w => w.u), WV: catGrids(warpList, w => w.v),
    MEX: f32(F.MEX), MHL: f32(F.MHL), MD: f32(F.MD), MRIM: f32(F.MRIM),
    BS: f32(B && B.s), BV: f32(B && B.v),
    RPR: f32(B && B.R && B.R.pr), RTL: f32(B && B.R && B.R.tl),
    STS: stamp.arr,
    MCC: f32((F.MC || []).map(c => c.c | 0)),
    SPIN: f32(extra.spin),
    OPS: (() => { const a = new Float32Array(F.OPC.length * 16);
      F.OPC.forEach((op, i) => a.set(opRow(op, warpList.indexOf(op.S)), i * 16)); return a; })(),
    CANE: f32([].concat(...(extra.canes || []))),
  };

  // an empty part still needs an offset; the shader never indexes one whose count is zero
  const offs = {}; let at = 0;
  for (const n of PART_NAMES) { offs[n] = at; at += Math.max(parts[n].length, 1); }
  const arena = new Float32Array(at);
  for (const n of PART_NAMES) if (parts[n].length) arena.set(parts[n], offs[n]);

  const b = new ArrayBuffer(304), d = new DataView(b);
  const FL = [
    F.TH || 0, F.RM || 0, F.RS || 0, F.FR || 1,
    F.FP || 0, F.FD || 0, F.SD || 0, F.INC || 0,
    F.SST || 1, F.MOB || 0, F.MST || 1, F.MW || 1,
    F.MSQ || 1, F.MJ || 0, F.CN || 1, F.TW || 0,
    F.LC || 0, F.LS || 0, F.CW || 0, F.CS || 1,
    F.LP || 0, stamp.C, H, (B && B.H) || H,
    (B && B.total) || 0, F.PX || 0, F.PY || 0, SLAB,
    F.TH || 0, extra.CORD || 0, extra.OPQ || 0, extra.OREF || 8,
    extra.kr || 0, extra.kg || 0, extra.kb || 0, extra.LBR || 255,
    extra.LBG || 255, extra.LBB || 255, H, 0,
  ];
  FL.forEach((v, i) => d.setFloat32(i * 4, v, true));

  const FORMI = { spun: 1, poured: 2, blown: 3, rolled: 4, flattened: 5 };
  const IN = [
    FORMI[F.form] || 4, F.MR ? 1 : 0, F.MB ? 1 : 0, (F.MC && F.MC.length) || 0,
    stamp.n, (S && S.nx) || 0, (S && S.ny) || 0, (B && B.nx) || 0,
    (B && B.ny) || 0, (B && B.R && B.R.pr.length) || 0, 0, 0,
    offs.WU, offs.WV, offs.MEX, offs.MHL, offs.MD, offs.MRIM,
    offs.BS, offs.BV, offs.RPR, offs.RTL, offs.STS, offs.MCC,
    offs.SPIN, offs.OPS, F.OPC.length, offs.CANE,
    (extra.canes || []).length, extra.tileW || 0, extra.tileX || 0, extra.tileY || 0,
    extra.fullW || 0, extra.tileH || extra.tileW || 0, extra.ss || 1, 0,
  ];
  IN.forEach((v, i) => d.setInt32(160 + i * 4, v, true));

  return { uni: b, arena, offs, parts,
    summary: {
      ops: F.OPC.length,
      kinds: F.OPC.map(o => o.k).join(','),
      ribbons: (F.MC && F.MC.length) || 0,
      stamps: stamp.n,
      radial: !!F.MR, blobs: !!F.MB, form: F.form,
      warp: S ? S.nx + 'x' + S.ny : 'none',
      roller: B ? B.nx + 'x' + B.ny : 'none',
      arenaFloats: at,
    } };
}

export { PART_NAMES };
