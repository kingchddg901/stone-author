// DOES THE PACKER CARRY EVERYTHING `shade` SUBSCRIPTS?
//
// THIS GATE EXISTS BECAUSE I GOT IT WRONG. The first wood packer read woodField's return statement
// and the feature record's, saw `ginv, zoff, urel, rwl, fzw, fsp, fcz, fchar, fwl` listed among the
// scalars, and packed them as uniform floats. They are ARRAYS - shade indexes every one of them by
// ring or by slice - and `al` and `zw` are arrays per feature, not numbers. A return statement says
// what comes back; only the CONSUMER says what shape it is.
//
// AND THE FIRST GATE COULD NOT SEE IT, which is the part worth keeping. check-wood-pack builds a
// synthetic field and asserts the packer flattens it - but I wrote that fixture from the same wrong
// reading, so it agreed with the mistake instead of the app. A fixture derived from the author's
// belief tests the author's belief.
//
// So nothing here is written down by hand. The alias map comes out of woodSampler's own
// declarations, the subscripted set comes out of shade's own body, and the packer has to account for
// every name that survives the join. If the app grows a tenth array, this goes red without anybody
// remembering to update it.
//
//   node tools/check-wood-inputs.mjs
import { readFileSync } from 'fs';
import { FIELD_PARTS, PART_NAMES } from './lib/wood-real.mjs';

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('  ok    ' + name); return; }
  fails++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

const APP = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');
const body = (sig) => {
  const k = APP.indexOf(sig);
  if (k < 0) return null;
  let i = APP.indexOf('{', k), d = 0;
  for (;; i++) { if (APP[i] === '{') d++; else if (APP[i] === '}' && --d === 0) break; }
  return APP.slice(k, i + 1);
};
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

const sampler = body('function woodSampler()');
const shade = body('const shade = (ddx');
ok('woodSampler is where this gate looks', !!sampler);
ok('and shade with it', !!shade);
if (!sampler || !shade) { console.error('check-wood-inputs: cannot read the app'); process.exit(1); }

// ---- the alias map, out of woodSampler's own declarations -------------------------------------------
// `const FSP = F.fsp, FCZ = F.fcz, ...` - shade reads the alias, the packer reads the property.
const alias = new Map();
for (const m of strip(sampler).matchAll(/\b([A-Z][A-Z0-9_]*)\s*=\s*F\.([A-Za-z_]\w*)/g)) alias.set(m[1], m[2]);
ok('the alias map is read, not written down', alias.size >= 8, alias.size + ' aliases');

// ---- what shade subscripts --------------------------------------------------------------------------
const subs = new Set();
for (const m of strip(shade).matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_]\w*)?)\s*\[/g)) subs.add(m[1]);

// names that are shade's own locals or its output, not field data
const LOCAL = new Set(['out', 'sq', 'pn', 'zc', 'zs', 'wl', 'W', 'f', 'd']);

const needed = new Map();                       // field property -> how shade reached it
for (const n of subs) {
  if (LOCAL.has(n)) continue;
  if (alias.has(n)) { needed.set(alias.get(n), n); continue; }
  const dot = n.match(/^(F|GF)\.([A-Za-z_]\w*)$/);
  if (dot) { needed.set((dot[1] === 'GF' ? 'graft:' : '') + dot[2], n); continue; }
  const feat = n.match(/^f\.([A-Za-z_]\w*)$/);
  if (feat) { needed.set('feature:' + feat[1], n); continue; }
  const wave = n.match(/^W\.([A-Za-z_]\w*)$/);
  if (wave) { needed.set('wave:' + wave[1], n); continue; }
  needed.set(n, n);                             // an alias to something other than F, or a bare name
}

console.log('');
console.log('  shade subscripts ' + needed.size + ' things the packer must carry as ARRAYS:');
let line = '   ';
for (const k of [...needed.keys()].sort()) { const s = k + ' '; if (line.length + s.length > 94) { console.log(line); line = '   '; } line += s; }
console.log(line);
console.log('');

// ---- and the packer accounts for every one -----------------------------------------------------------
const missing = [...needed.keys()].filter(k => !FIELD_PARTS[k]);
ok('every subscripted input has a part in the packer', missing.length === 0,
   'NOT PACKED AS ARRAYS: ' + missing.join(', '));

const bogus = Object.entries(FIELD_PARTS).filter(([, p]) => !PART_NAMES.includes(p));
ok('and every mapping names a real part', bogus.length === 0, bogus.map(x => x.join('->')).join(', '));

// ---- the ablation ------------------------------------------------------------------------------------
// If `ginv` were a scalar this gate must go red, because that is the defect it was written for.
{
  const without = { ...FIELD_PARTS }; delete without.ginv;
  const wouldMiss = [...needed.keys()].filter(k => !without[k]);
  ok('ABLATION dropping ginv from the map is caught', wouldMiss.includes('ginv'),
     'ginv is not in the needed set at all - the extraction is broken');
}

console.log('');
if (fails) { console.error('check-wood-inputs: ' + fails + ' FAILED'); process.exit(1); }
console.log('check-wood-inputs: every array shade indexes is packed as one, derived from the app');
console.log('                   rather than from what the packer’s author believed.');
