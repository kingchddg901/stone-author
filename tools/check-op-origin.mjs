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

console.log('');
if (fails) { console.error('check-op-origin: ' + fails + ' FAILED'); process.exit(1); }
console.log('check-op-origin: an op without a centre is the op it always was, bit for bit, and one');
console.log('                 with a centre is a different map.');
