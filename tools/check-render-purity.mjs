// A render must be a pure function of the slab — so nothing that scales the coat may ask how big the
// window is.
//
// applyCoat's blur radii are written in units of a coat scale. Every export path used to derive that scale
// from the on-screen canvas width, which made the same slab export different pixels after a browser resize
// and made the strip path disagree with renderFull about the reality windows. COAT_REF fixed it; this gate
// is what stops it coming back, because nothing about the bug is visible in the app's behaviour until you
// render the same slab twice at two window sizes and compare the bytes.
//
// It reads the coat-scale argument of every applyCoat / compositeWindow / renderSlabTo call and insists it
// is expressed against COAT_REF. The live view is included on purpose: its scale is what makes the preview
// a proportional preview of the export.
//
//   node tools/check-render-purity.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'app/stone-author.html';

// position of the coat scale in each call's argument list
const CALLS = { applyCoat: 2, compositeWindow: 5, renderSlabTo: 3, paintBacklit: 1 };
// the window's own measurements: a coat scale built from any of these is the bug
const WINDOWY = /\bWc\b|\bHc\b|\bdpr\b|clientWidth|clientHeight|innerWidth|innerHeight/;

// split one call's arguments at top-level commas, so `Math.min(a, b)` and `[W, 0, 0, W, 0, 0]` stay whole
function args(src, open) {
  const out = []; let d = 0, start = open + 1, i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') { d--; if (d === 0) break; }
    else if (c === ',' && d === 1) { out.push(src.slice(start, i).trim()); start = i + 1; }
  }
  out.push(src.slice(start, i).trim());
  return out;
}

// Most call sites hand over a local — renderFull and the strip path both pass `bs` — so checking the
// argument text alone reads `bs` as innocent and misses the very line the bug lived on. Follow the name to
// every place it is assigned and check those expressions instead. A name with no assignment anywhere is
// itself a finding: it means the scale arrives from somewhere this gate cannot see.
const IDENT = /^[A-Za-z_$][\w$]*$/;
// a comment that describes the scale is not a scale: `// bs = blur scale (dpr live)` is prose
const inComment = (src, at) => /^\s*(\/\/|\*|<!--)/.test(src.slice(src.lastIndexOf('\n', at) + 1, at + 1));

function sources(src, name) {
  const rx = new RegExp(`(?<![\\w.])${name}\\s*=\\s*([^,;\\n]+)`, 'g');
  const out = []; let m;
  while ((m = rx.exec(src))) {
    if (inComment(src, m.index)) continue;
    out.push({ expr: m[1].trim(), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

// A name that is a parameter of the function doing the painting is forwarded, not chosen: it gets checked
// where the caller supplies it, which this gate already walks. Its own default (`bs = bs || …`) is an
// assignment, so it is still checked.
function params(src) {
  const rx = /function\s+[\w$]*\s*\(([^)]*)\)/g, out = new Set();
  let m;
  while ((m = rx.exec(src))) for (const p of m[1].split(',')) { const n = p.trim().split(/[\s=]/)[0]; if (n) out.add(n); }
  return out;
}

export function scan(src) {
  const bad = [], seen = [], forwarded = params(src);
  const windowy = (e) => !/COAT_REF/.test(e) && WINDOWY.test(e);
  for (const [fn, at] of Object.entries(CALLS)) {
    const rx = new RegExp(`(?<![\\w.])${fn}\\s*\\(`, 'g');
    let m;
    while ((m = rx.exec(src))) {
      const open = m.index + m[0].length - 1, line = src.slice(0, m.index).split('\n').length;
      // the declaration itself names parameters, not a scale to check
      if (/function\s+$/.test(src.slice(Math.max(0, m.index - 10), m.index))) continue;
      const a = args(src, open)[at];
      if (a == null) continue;            // an optional scale, left out: its default is checked at the definition
      seen.push({ fn, arg: a, line });
      if (windowy(a)) { bad.push({ fn, arg: a, line }); continue; }
      if (!IDENT.test(a) || /COAT_REF/.test(a)) continue;
      const defs = sources(src, a);
      if (!defs.length) {
        if (forwarded.has(a)) continue;   // a parameter, checked at the call that supplies it
        bad.push({ fn, arg: `${a} (never assigned and not a parameter — where does it come from?)`, line });
        continue;
      }
      for (const d of defs) if (windowy(d.expr)) bad.push({ fn, arg: `${a}, assigned \`${d.expr}\``, line: d.line });
    }
  }
  return { bad, seen };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { bad, seen } = scan(readFileSync(join(root, APP), 'utf8'));
  if (!seen.length) {                      // the gate found nothing to check, which is a broken gate
    console.error(`no coat-scale arguments found in ${APP} — this check has stopped checking anything.`);
    process.exit(1);
  }
  for (const b of bad) {
    console.error(`${APP}:${b.line}: ${b.fn} scales the coat by \`${b.arg}\`, which depends on the window size.`);
    console.error('Express it against COAT_REF, or the same slab exports different pixels after a resize.');
  }
  if (bad.length) process.exit(1);
  console.log(`render purity: ${seen.length} coat scale(s), all against COAT_REF`);
}
