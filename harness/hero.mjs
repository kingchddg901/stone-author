// One gallery hero → { hash, png }, rendered from its slab in a hooked page.
//
// Both browser gates that render a hero go through here, because the hero setup — the warp mask reset, the
// moon override, the mask mark, the psyker palette, the spectrum, the burn pass — is the definition of what
// that hero IS. Two copies of it would drift, and the copy that drifted would be the one the second gate
// was measuring.
//
// `width` defaults to the reference width, so the determinism gate is unchanged; the engine gate passes a
// small width on purpose (see harness/engines.mjs). `pixels` additionally returns the raw RGBA as base64, so
// a comparison can be done in Node instead of asking a browser that has just rendered to also decode, loop
// and re-encode — the engine gate started out doing that in the page and WebKit spent over 45 seconds on it.
import { readFileSync } from 'fs';
import { join } from 'path';

export async function renderHero(page, { root, hero, ref, width, pixels }) {
  const slab = JSON.parse(readFileSync(join(root, 'gallery', hero.slab), 'utf8'));
  return page.evaluate(async ({ slab, h, ref, W, wantPixels }) => {
    const sa = window.__sa, s = W / 1000;
    sa.deserialize(slab);
    sa.G.warpMask = [];
    if (h.moonStrength != null) { const m = sa.marks.find(x => x.kind === 'moon'); if (m) m.p.moonStrength = h.moonStrength; }
    // maskSpec is the window's own light (0 = daylight) and maskInvert flips the disc from protecting a region
    // to being the only region the warp may touch. Both default to 0, which is what the first three heroes were
    // rendered with before either existed — so adding them here leaves those renders untouched.
    if (h.mask) sa.marks.push({ id: 990000, kind: 'mask', at: h.mask.at, r: h.mask.r, p: { maskFeather: h.mask.feather, maskWin: h.mask.window ? 1 : 0, maskSpec: h.mask.spec || 0, maskInvert: h.mask.invert ? 1 : 0 }, fam: 'granite' });
    if (h.palette === 'psyker') { const p = ref.psykerPalette.OVR_uv; for (const k in p) sa.OVR_uv[k] = [{ v: -1, c: p[k] }]; delete sa.OVR_uv['lay:minor']; }
    sa.setSpectrum(h.spectrum || 0);
    sa.render();
    const oc = sa.renderFull(W);
    if (h.burn) {
      const cx = oc.getContext('2d'); cx.setTransform(1, 0, 0, 1, 0, 0);
      const b = ref.burn, bx = b.center[0] * W, by = b.center[1] * W;
      cx.globalCompositeOperation = 'multiply';
      let g = cx.createRadialGradient(bx, by, 0, bx, by, b.multiply.r * s); for (const [o, c] of b.multiply.stops) g.addColorStop(o, c); cx.fillStyle = g; cx.fillRect(0, 0, oc.width, oc.height);
      cx.globalCompositeOperation = 'lighter';
      let hg = cx.createRadialGradient(bx, by, b.lighter.r0 * s, bx, by, b.lighter.r1 * s); for (const [o, c] of b.lighter.stops) hg.addColorStop(o, c); cx.fillStyle = hg; cx.fillRect(0, 0, oc.width, oc.height);
      cx.globalCompositeOperation = 'source-over';
    }
    const d = oc.getContext('2d').getImageData(0, 0, oc.width, oc.height).data;
    const buf = await crypto.subtle.digest('SHA-256', d);
    let px = null;
    if (wantPixels) {                                        // chunked: String.fromCharCode(...d) blows the stack
      let s = ''; const CH = 0x8000;
      for (let i = 0; i < d.length; i += CH) s += String.fromCharCode.apply(null, d.subarray(i, i + CH));
      px = btoa(s);
    }
    return { hash: [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join(''),
             png: oc.toDataURL('image/png'), w: oc.width, h: oc.height, px };
  }, { slab, h: hero, ref, W: width || ref.width, wantPixels: !!pixels });
}
