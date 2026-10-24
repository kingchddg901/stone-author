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
// The default moved into compileOps when the op list stopped being read once per pixel. Same rule,
// one place earlier: an absent centre is the ORIGIN, and must never become NaN.
{
  const comp = SRC.slice(SRC.indexOf('function compileOps('), SRC.indexOf('function glassUnform('));
  const dec = comp.match(/ox: ([^,]+), oy: ([^,]+),/);
  ok('the centre is compiled with a default', !!dec, dec ? dec[0] : 'no declaration');
  if (dec) {
    ok('across falls back to zero, not NaN', /\|\|\s*0\s*$/.test(dec[1].trim()), dec[1].trim());
    ok('and so does down', /\|\|\s*0\s*$/.test(dec[2].trim()), dec[2].trim());
  }
  ok('and the walk reads the compiled pair', /const ox = op\.ox, oy = op\.oy;/.test(body));
}

// ---- translate, transform, translate back ------------------------------------------------------------
// With ox = oy = 0 each of these is the identity on its own, which is why the absent case is exact
// rather than close. Checked numerically over 200,000 random points at zero deviation.
{
  const spin = body.slice(body.indexOf('if (k === 1)'), body.indexOf('} else if (k === 2)'));
  ok('spin measures its radius from the centre', /const px = x - ox, py = y - oy/.test(spin));
  // REPOINTED AT THE ROTATION FORM in build 2026.10.24.179, which dropped the angle round-trip. The
  // CLAIM is unchanged and is the only thing this line is for: both coordinates are rebuilt around
  // ox/oy, so an absent centre resolves to zero and `0 + v` returns v. What moved is the expression
  // between the translations, from r and an angle to a plain rotation by a*r.
  ok('spin puts the point back around the centre',
    /x = ox \+ px \* c1 \+ py \* s1; y = oy - px \* s1 \+ py \* c1/.test(spin));
  // A CALL, not a mention: the comment beside this code explains why woodAtan2 left, and matching
  // the name alone made this assertion fail on the explanation for its own existence.
  ok('and it no longer recovers the angle to do it', !/woodAtan2\(/.test(spin),
    'woodAtan2 is a polynomial approximation and r*epsilon made it positional — see renderer-determinism.md');
  const blow = body.slice(body.indexOf('} else if (k === 2)'), body.indexOf('} else if (k === 3)'));
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

  // The lattice is resolved at COMPILE time now, which is most of why change 2 was worth doing:
  // F.SKEY builds a string, and the walk was building one per pixel per stir.
  const comp2 = SRC.slice(SRC.indexOf('function compileOps('), SRC.indexOf('function glassUnform('));
  ok('the op resolves its own field, once',
     /S: k === 5 \? \(F\.SG \? F\.SG\[F\.SKEY\(op\)\] : F\.S\) : null/.test(comp2));
  const br = SRC.slice(SRC.indexOf('} else if (k === 5)'), SRC.indexOf('out[0] = x; out[1] = y'));
  ok('and the walk just reads it', /const S = op\.S;/.test(br));
  ok('a missing one is skipped rather than thrown', /if \(S\) \{/.test(br));
  ok('no string key is built per pixel any more', !/F\.SKEY\(op\)/.test(body));

  // ---- AND THE COMPILE MUST AGREE WITH THE WALK IT REPLACED, VALUE FOR VALUE ----------------------
  // Moving an expression out of a loop is only safe if it is the SAME expression. The field holds a
  // label, so a value that differs in the last place is a different picture, not a close one - and the
  // ways to get this wrong are all tidying: Math.max for a ternary, a dropped `|| 0` that lets NaN
  // through, a clamp applied in the wrong order. So compileOps is lifted and run, and each field is
  // compared against the expression the per-pixel walk used to evaluate, over inputs that include the
  // absent and the hostile.
  {
    const fn = SRC.match(/function compileOps\(F, OPS\) \{[\s\S]*?\n  \}/);
    ok('compileOps is extractable, so this runs the REAL one', !!fn);
    if (fn) {
      const compile = new Function('OPK', 'return ' + fn[0])({ spin: 1, blow: 2, roll: 3, press: 4, stir: 5 });
      const F = { RU0: [], ROLL: [], SG: null, S: null, SKEY: () => '0:0' };
      const ops = [
        { k: 'spin', a: 1.2197, cx: 0.5, cy: -0.3 },
        { k: 'spin' },                                   // every field absent
        { k: 'blow', a: 0.01 },                          // below the clamp
        { k: 'blow', a: -3 },                            // negative
        { k: 'blow', a: 'x' },                           // NaN through coercion
        { k: 'roll', a: 1.84, d: 37 },
        { k: 'roll', a: 2, d: 0 },                       // the no-rotation case
        { k: 'press', face: 0, bite: 0 },
        { k: 'press' },
        { k: 'stir' },
        { k: 'nonsense' },
      ];
      for (let i = 0; i < ops.length; i++) F.RU0.push(i * 0.5);
      const got = compile(F, ops);
      let bad = null;
      for (let i = 0; i < ops.length && !bad; i++) {
        const op = ops[i], c = got[i];
        const dr = (+op.d || 0) * Math.PI / 180;         // exactly as glassUnform spelled it
        const want = {
          a: +op.a || 0,
          s: +op.a > 0.05 ? +op.a : 0.05,
          ox: +op.cx || 0, oy: +op.cy || 0,
          rot: dr !== 0, cd: Math.cos(dr), sd: Math.sin(dr),
          u0: (F.RU0 && F.RU0[i]) || 0,
          face: Math.max(0.05, +op.face || 5) * 0.5,
          bite: +op.bite || 1,
        };
        for (const key of Object.keys(want))
          if (!Object.is(c[key], want[key])) bad = 'op ' + i + ' (' + op.k + ') ' + key + ': ' + c[key] + ' vs ' + want[key];
      }
      ok('every compiled value equals the expression it replaced', !bad, bad || ops.length + ' ops, all fields');
      ok('an unknown kind compiles to zero and is skipped, not misread', got[10].k === 0);
      ok('the original op travels for the stamp readers', got[0].raw === ops[0]);

      // ABLATION: the tidy spelling. Math.max lets NaN through where the ternary does not.
      const tidy = fn[0].replace('s: +op.a > 0.05 ? +op.a : 0.05,', 's: Math.max(0.05, +op.a),');
      const c2 = new Function('OPK', 'return ' + tidy)({ spin: 1, blow: 2, roll: 3, press: 4, stir: 5 })(F, ops);
      ok('ablation: tidying the clamp to Math.max is caught',
         !Object.is(c2[4].s, +ops[4].a > 0.05 ? +ops[4].a : 0.05),
         'NaN input gives ' + c2[4].s + ' instead of ' + (+ops[4].a > 0.05 ? +ops[4].a : 0.05));
    }
  }

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

  // A STYLE RULE WITH NO MEASUREMENT BEHIND IT IS NOT A GATE. This asserted that the memo must live
  // on a const object's property rather than in a `let`, on the strength of a 20-second difference
  // that turned out to be the benching renderer degrading across page loads - both spellings measure
  // the same on a fresh one. The assertion and its ablation are gone rather than rephrased: they
  // could only ever have enforced a preference, and a claim that cannot fail for the reason it gives
  // is worse than no claim.
  //
  // What is still worth asserting is that ONE memo exists and nothing rebinds it mid-render, which is
  // a correctness property rather than a performance one.
  ok('the memo has a single home', /const _WM = \{ m: null \}/.test(SRC));
  ok('and nothing rebinds it', !SRC.replace('const _WM = ', '').includes('_WM ='));
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
