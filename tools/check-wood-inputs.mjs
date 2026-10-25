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
// ALMOST nothing here is written down by hand, and the exception is where it failed a second time.
// The alias map comes out of woodSampler's own declarations and the subscripted set out of shade's
// own body - but the list of names to IGNORE was mine, and I put `wl` in it after seeing a bare
// `wl[` and calling it scratch. It is `FE[q].wl[gi]`, a per-feature table indexed by ring, and the
// packer went without it. A hand-written exemption is the hand-written part of a derived gate and
// it is where the next miss will come from, so every entry below now carries why it is there.
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
// AND A MEMBER OF AN INDEXED THING: `FE[q].wl[gi]` is a per-feature table and the pattern above
// sees only a bare `wl`. This is the shape that got missed.
for (const m of strip(shade).matchAll(/([A-Za-z_$][\w$]*)\s*\[[^\]]*\]\s*\.\s*([A-Za-z_]\w*)\s*\[/g))
  subs.add(m[1] + '[].' + m[2]);

// EXEMPT, WITH A REASON EACH. These are not field tables, and saying why is the only thing standing
// between this list and the mistake it already caused once.
const EXEMPT = new Map([
  ['out', 'the output triple, a parameter'],
  ['sq', 'scratch, one slot per feature, filled in this function'],
  ['pn', 'the face normal - three floats, and it rides in the uniform'],
  ['zc', 'reached as W.zc, counted there'],
  ['zs', 'reached as W.zs, counted there'],
  ['wl', 'reached as FE[].wl, counted there'],
  ['W', 'the loop variable over the wave family'],
  ['f', 'the loop variable over the features'],
  ['d', 'a local'],
]);

const needed = new Map();                       // field property -> how shade reached it
for (const n of subs) {
  if (EXEMPT.has(n)) continue;
  if (alias.has(n)) { needed.set(alias.get(n), n); continue; }
  const dot = n.match(/^(F|GF)\.([A-Za-z_]\w*)$/);
  if (dot) { needed.set((dot[1] === 'GF' ? 'graft:' : '') + dot[2], n); continue; }
  const feat = n.match(/^f\.([A-Za-z_]\w*)$/) || n.match(/^FE\[\]\.([A-Za-z_]\w*)$/);
  if (feat) { needed.set('feature:' + feat[1], n); continue; }
  const wave2 = n.match(/^WV\[\]\.([A-Za-z_]\w*)$/);
  if (wave2) { needed.set('wave:' + wave2[1], n); continue; }
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

// ---- THE BRIDGE: does the app hand packWood what packWood reads? -------------------------------------
// woodSampler computes every one of these for the CPU painter already; the scene only stops them
// being private to the closure. Both halves are read from source - the keys packWood asks for, and
// the keys the app's scene literal supplies - so neither can be satisfied by a list I maintain.
{
  const PACK = readFileSync(new URL('./lib/wood-real.mjs', import.meta.url), 'utf8');
  const wantS = new Set([...PACK.matchAll(/[^A-Za-z0-9_]S[.]([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]));
  const wantC = new Set([...PACK.matchAll(/col[(]'([A-Za-z][A-Za-z0-9_]*)'/g)].map(m => m[1]));

  const sc = APP.indexOf('const scene = {');
  ok('the app builds a scene for the packer', sc >= 0);
  let i = APP.indexOf('{', sc), d = 0;
  for (;; i++) { if (APP[i] === '{') d++; else if (APP[i] === '}' && --d === 0) break; }
  const scene = APP.slice(sc, i + 1);
  const sBlock = scene.slice(scene.indexOf('sampler: {'), scene.indexOf('colours: {'));
  const cBlock = scene.slice(scene.indexOf('colours: {'));

  const haveS = new Set([...sBlock.matchAll(/([A-Za-z_]\w*)\s*[:,}]/g)].map(m => m[1]));
  const haveC = new Set([...cBlock.matchAll(/([A-Za-z]\w*)\s*:/g)].map(m => m[1]));

  const missS = [...wantS].filter(k => !haveS.has(k));
  const missC = [...wantC].filter(k => !haveC.has(k));
  ok('the scene carries every sampler value the packer reads', missS.length === 0,
     'missing ' + missS.join(', '));
  ok('and every colour it resolves', missC.length === 0, 'missing ' + missC.join(', '));
  ok('it passes the graft through as its own field', /graft:\s*GF/.test(scene));
  ok('and names which feature carries the knot', /KNI:\s*FE\.findIndex/.test(scene));
  // ABLATION: a sampler key the packer reads but the scene drops must be seen
  ok('ABLATION a dropped key is caught', [...wantS].filter(k => !new Set([...haveS].filter(x => x !== 'KS')).has(k)).includes('KS'));
}

console.log('');
if (fails) { console.error('check-wood-inputs: ' + fails + ' FAILED'); process.exit(1); }
console.log('check-wood-inputs: every array shade indexes is packed as one, derived from the app');
console.log('                   rather than from what the packer’s author believed.');
