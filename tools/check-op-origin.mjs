// AN OP WITHOUT A CENTRE MUST STILL BE THE OP IT WAS.
//
// spin and blow took a per-op centre so that two of them stop being one. Two spins about a single
// centre compose - spin(a1) then spin(a2) IS spin(a1+a2) - and two blows compose exactly, measured
// byte-identical on a real fourteen-op chain: 1.84 then 1.58 rendered the same 262,144 pixels as a
// single 2.9072. A centre is what makes them different maps.
//
// EVERY SLAB EVER SAVED HAS NO SUCH FIELD. So the absent case has to be the old behaviour, and not
// approximately: a glass field holds a LABEL, so a coordinate that moves by one part in 10^15 can
// cross a ribbon boundary and change a pixel by 130 levels. There is no small error here. It is the
// same picture or a different one.
//
// Verified empirically before this gate existed - the disco slab rendered to FNV 0x375c1a38 and mean
// luminance 172.2093 on both builds - and what this file protects is the thing that would quietly
// undo it: someone writing `+op.cx` where `+op.cx || 0` is meant, which is NaN for every slab on disk
// and turns the whole field into nothing.
//
//   node tools/check-op-origin.mjs
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');
let fails = 0;
const ok = (what, cond, got) => {
  if (!cond) { fails++; console.error('  FAIL  ' + what + (got === undefined ? '' : '   ' + got)); }
  else console.log('  ok    ' + what + (got === undefined ? '' : '   ' + got));
};

const at = SRC.indexOf('function glassUnform(');
const body = at < 0 ? '' : SRC.slice(at, SRC.indexOf('\n  }', at));
ok('glassUnform is where it was', at > 0);

// ---- the default is what makes an old slab safe ------------------------------------------------------
{
  const dec = body.match(/const ox = ([^,]+), oy = ([^;]+);/);
  ok('the centre is read with a default', !!dec, dec ? dec[0] : 'no declaration');
  if (dec) {
    ok('across falls back to zero, not NaN', /\|\|\s*0\s*$/.test(dec[1].trim()), dec[1].trim());
    ok('and so does down', /\|\|\s*0\s*$/.test(dec[2].trim()), dec[2].trim());
  }
}

// ---- translate, transform, translate back ------------------------------------------------------------
// With ox = oy = 0 each of these is the identity on its own, which is why the absent case is exact
// rather than close. Checked numerically over 200,000 random points at zero deviation.
{
  const spin = body.slice(body.indexOf("if (k === 'spin')"), body.indexOf("} else if (k === 'blow')"));
  ok('spin measures its radius from the centre', /const px = x - ox, py = y - oy/.test(spin));
  ok('spin puts the point back around the centre', /x = ox \+ r \* Math\.cos\(th\); y = oy \+ r \* Math\.sin\(th\)/.test(spin));
  const blow = body.slice(body.indexOf("} else if (k === 'blow')"), body.indexOf("} else if (k === 'roll')"));
  ok('blow spreads from the centre', /x = ox \+ \(x - ox\) \/ s; y = oy \+ \(y - oy\) \/ s/.test(blow));
}

// ---- the arithmetic, proved rather than asserted -----------------------------------------------------
// A copy of the formulas, which proves only the copy - so it is the WEAK half of this file and is here
// for the one thing a text scan cannot do: show that a zero centre is bit-exact, not merely close.
{
  const a = 1.2197;
  const was = (x, y) => { const r = Math.hypot(x, y); if (r <= 1e-9) return [x, y];
    const th = Math.atan2(y, x) - a * r; return [r * Math.cos(th), r * Math.sin(th)]; };
  const now = (x, y, ox, oy) => { const px = x - ox, py = y - oy, r = Math.hypot(px, py);
    if (r <= 1e-9) return [x, y];
    const th = Math.atan2(py, px) - a * r; return [ox + r * Math.cos(th), oy + r * Math.sin(th)]; };
  let worst = 0, moved = 0;
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 8) / 8388608 * 4 - 2; };
  for (let i = 0; i < 200000; i++) {
    const x = rnd(), y = rnd();
    const w = was(x, y), n0 = now(x, y, 0, 0), n1 = now(x, y, 0.5, -0.3);
    worst = Math.max(worst, Math.abs(w[0] - n0[0]), Math.abs(w[1] - n0[1]));
    if (Math.abs(w[0] - n1[0]) > 1e-6 || Math.abs(w[1] - n1[1]) > 1e-6) moved++;
  }
  ok('a zero centre is bit-exact over 200,000 points', worst === 0, 'worst deviation ' + worst);
  // ABLATION. If an offset centre changed nothing, the whole feature would be decoration and the
  // check above would be passing for the wrong reason.
  ok('and an offset centre genuinely moves the map', moved > 190000,
     moved.toLocaleString() + ' of 200,000 points moved');
}

// ---- the copy has to differ, or it is the row it was replacing ---------------------------------------
{
  const vc = SRC.indexOf('function variedCopy(');
  const vb = vc < 0 ? '' : SRC.slice(vc, SRC.indexOf('\n  }', vc));
  ok('variedCopy exists', vc > 0);
  ok('it varies the magnitude', /o\.a = .*VAR_A/.test(vb));
  ok('and the centre', /VAR_O/.test(vb));
  ok('through the three-sine wave, so a run of copies never repeats', /snakeWave\(/.test(vb));
  const sw = SRC.match(/const snakeWave = [\s\S]{0,260}?0\.15 \* Math\.sin\(x \* 2\.5 - t \* 0\.7\);/);
  ok('and that wave is the three-term one, not a single sine', !!sw);
}

// ---- a stir without a range is the stir it always was ------------------------------------------------
// Every stir used to read one lattice built from every moon. Ranges give each its own, and the key
// '0:0' is what an op with no range asks for - so a slab written before ranges renders byte-identically,
// which was checked on a real one at FNV 0x375c1a38 before this gate existed.
{
  const asm = SRC.slice(SRC.indexOf("const wkey = warpCacheKey("), SRC.indexOf("F.S = F.SG['0:0']") + 60);
  ok('the every-moon field is built unconditionally', /SG\['0:0'\] = glassWarp\(H, moons\);/.test(asm));
  ok('and it is what F.S still points at', /F\.S = F\.SG\['0:0'\]/.test(asm));
  ok('a range keys to from:to, so two stirs wanting the same moons share one lattice',
     /F\.SKEY = o => \(\(\+o\.from \|\| 0\) \+ ':' \+ \(\+o\.to \|\| 0\)\)/.test(SRC));
  ok('a field is built once per distinct range, not once per stir', /if \(!\(key in SG\)\)/.test(asm));

  const br = SRC.slice(SRC.indexOf("} else if (k === 'stir')"), SRC.indexOf("out[0] = x; out[1] = y"));
  ok('the op reads its own field', /F\.SG\[F\.SKEY\(op\)\]/.test(br));
  ok('and a missing one is skipped rather than thrown', /if \(S\) \{/.test(br));

  // ABLATION: drop the fallback and the backward-compatible case stops existing.
  const broken = SRC.replace("SG['0:0'] = glassWarp(H, moons);", '');
  ok('ablation: without the every-moon field the default has nothing to point at',
     broken !== SRC && !/SG\['0:0'\] = glassWarp/.test(broken));
}

// ---- the field is built once per RENDER, and the key is what makes that safe -------------------------
// paintGlassContent is the per-tile painter, and it was building every lattice on every tile -
// docs/stir-fields.md had required otherwise since it was written. Measured at a 256 px tile, where
// almost nothing is painted: 1,542 ms before, 132 ms after.
{
  const key = SRC.slice(SRC.indexOf('function warpCacheKey('), SRC.indexOf('function paintGlassContent('));
  ok('the memo is keyed, not flagged', key.length > 0 && /_WM\.m\.key !== wkey/.test(SRC));

  // A FALSE MISS COSTS ONE REBUILD; A FALSE HIT IS A WRONG PICTURE. Each of these is something the
  // field reads, so each must reach the key - and removing any one of them turns this red.
  for (const [what, re] of [
    ['the pane height',            /\bn\(H\)/],
    ['the fbm ocean dials',        /n\(G\.warp\); n\(G\.cloudScale\); n\(G\.cloudX\); n\(G\.cloudY\)/],
    ['the family seed',            /t\(fam\)/],
    ['each moon reach + strength', /n\(P\.moonReach\); n\(P\.moonStrength\)/],
    ['every drawn sample',         /n\(sm\[i\]\[0\]\); n\(sm\[i\]\[1\]\)/],
    ['the mask list',              /const MK = _wmask \|\| \[\]/],
    ['the ranges the ops ask for', /if \(o && o\.k === 'stir'\) \{ n\(\+o\.from \|\| 0\); n\(\+o\.to \|\| 0\); \}/],
  ]) ok('the key covers ' + what, re.test(key));

  ok('and hashes the IEEE bits rather than a decimal rendering', /_wkF\[0\] = \+v \|\| 0;/.test(key) &&
     /_wkI\[0\]/.test(key) && /_wkI\[1\]/.test(key));

  // THE MEMO LIVES ON A PROPERTY, NOT IN A REBINDABLE BINDING, and that is a measurement rather than
  // a style. Held as `let _warpMemo` - written from inside paintGlassContent - V8 context-allocates
  // the binding and deoptimises the whole painter: the SAME memo, same output hash 1b55d053, took
  // 46,941 ms for a 4096 tile against 25,503 ms on a const object's property, with the baseline at
  // 28,048. A 20-second regression bought by one keyword, invisible to every correctness test.
  ok('the memo is a property of a const, not a captured let', /const _WM = \{ m: null \}/.test(SRC));
  ok('nothing rebinds it', !/\b_WM =/.test(SRC.replace(/const _WM = /g, '')));
  // ABLATION: the obvious spelling is the slow one, so this has to be able to see it.
  {
    const asLet = SRC.replace('const _WM = { m: null };', 'let _warpMemo = null;');
    ok('ablation: turning it back into a let is visible from here',
       asLet !== SRC && !/const _WM = \{ m: null \}/.test(asLet));
  }
  ok('and the worker carries its own, so no invalidation crosses the wire',
     /var marks=\[\],_wmask=null,_WM=\{m:null\};/.test(SRC));
}

// ---- the author can see when a range drags nothing ---------------------------------------------------
{
  ok('the count of moons a range covers is shown', SRC.includes("TR('op.moons-used'"));
  ok('and it is marked when that count is zero', /'op-count' \+ \(used \? '' : ' bad'\)/.test(SRC));
}

// ---- one sample per pixel is the render that always was ----------------------------------------------
// Supersampling averages the COLOUR after the label lookup, which is what a sensor does over its own
// area and leaves the material's rule untouched - nothing mixes in the field, only in the pixel. At one
// sample it has to vanish, and does: the offset (k + 0.5)/N - 0.5 is 0 at N = 1, adding 0.0 changes no
// double, and the average divides by 1. Checked on a real slab at FNV 0x6d79a5ba on both builds.
{
  const g = SRC.slice(SRC.indexOf('function paintGlassContent('), SRC.indexOf('function paintWoodContent('));
  ok('the sample grid is declared and clamped', /const SS = Math\.max\(1, Math\.min\(4, \(GLASS\.ss \| 0\) \|\| 1\)\)/.test(g));
  ok('the offsets centre on the pixel, so one sample sits where it always sat',
     /SSO\.push\(\(k \+ 0\.5\) \/ SS - 0\.5\)/.test(g));
  ok('the average is a reciprocal fixed with the grid, not a divide per pixel', /SSN = 1 \/ \(SS \* SS\)/.test(g));
  ok('the sub-position goes through the same inverse affine as the centre',
     /const ssu = su \+ B\.iv\.a \* SSO\[jx\] \+ B\.iv\.c \* SSO\[jy\]/.test(g));
  ok('colour is what is averaged, after the lookup', /accR \+= r; accG \+= g; accB \+= b;/.test(g));
  // ABLATION: a grid that does not centre would move every pixel of every existing slab.
  const broken = SRC.replace('(k + 0.5) / SS - 0.5', '(k + 1) / SS - 0.5');
  ok('ablation: an off-centre grid is visible from here',
     broken !== SRC && !/SSO\.push\(\(k \+ 0\.5\) \/ SS - 0\.5\)/.test(broken));
}

// ---- and the warning keeps asking the same question --------------------------------------------------
{
  const cp = SRC.slice(SRC.indexOf('function carryPatch('), SRC.indexOf('function carryCorr('));
  ok('the chaos-limit check always measures at one sample', /GLASS\.ss = 1;/.test(cp));
  ok('and puts the slab back afterwards', /finally \{ GLASS\.ss = keep; \}/.test(cp));
}

// ---- where a new moon goes, said rather than inferred --------------------------------------------------
// Moons are appended and a range is a window on that list, so the only stir that CAN take the next one
// is the one whose window has no end. Measured on the shipped build: a stir at (0,0) or (5,0) or (1,12)
// picks up a newly drawn moon; one at (1,3) or (1,11) does not. The tick says which, and ticking one
// pins the others - without that, ticking a 1-3 stir would widen it to 1-13 and swallow 4-12 on the way.
{
  const d = SRC.slice(SRC.indexOf('function drawOps()'), SRC.indexOf('function drawCells()'));
  ok('a stir row offers the tick', /op-tick/.test(d) && /TR\('op\.takes-new'\)/.test(d));
  ok('ticked means the window has no end', /cb\.checked = !\(\+op\.to > 0\)/.test(d));
  ok('ticking one pins every other open stir where it stands',
     /for \(const other of ops\)[\s\S]{0,140}?other\.k === 'stir'[\s\S]{0,60}?other\.to = tot;/.test(d));
  ok('and unticking pins this one', /\} else op\.to = tot;/.test(d));
  // ABLATION: without the pinning pass two stirs could be open at once, and a new moon would join both.
  const broken = d.replace(/for \(const other of ops\)[\s\S]{0,200}?other\.to = tot;/, '');
  ok('ablation: dropping the pinning pass is visible from here',
     broken !== d && !/for \(const other of ops\)/.test(broken));
}

console.log('');
if (fails) { console.error('check-op-origin: ' + fails + ' FAILED'); process.exit(1); }
console.log('check-op-origin: an op without a centre is the op it always was, bit for bit, and one');
console.log('                 with a centre is a different map.');
