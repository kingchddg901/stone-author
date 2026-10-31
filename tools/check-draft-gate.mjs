// AN UNREVIEWED TRANSLATION IS OFFERED, NEVER IMPOSED — and this is the check that it stays that way.
//
// Every pack in i18n/ was written by a model and none has been read by somebody who speaks it, so
// i18n/_index.json tags each with its own word for "draft" and the menu shows it. The gate is the
// other half: a reader whose BROWSER happens to be set to one of those languages has chosen nothing
// and been told nothing, so `pick()` passes the draft over and tries the next preference. A reader
// who types ?lang= or uses the menu has been told, and reaches it freely.
//
// THE FUNCTIONS ARE LIFTED FROM THE APP, NOT RETYPED. A second copy of pick() in this file would
// agree with itself forever while the app drifted away from it, which is the failure a gate like this
// exists to prevent. The lift pulls the real text and runs it over a stubbed browser.
//
// WHAT MAKES THIS MORE THAN A SOURCE-SHAPE ASSERTION: the laundering case. An auto-detected language
// written to storage becomes a REMEMBERED one, and a remembered language is explicit — so a gate that
// forgets `remember` holds on the first load and waves the same draft through on the second. That is
// not visible in pick() alone; it is the call site in catalogue(), checked separately below.
//
//   node tools/check-draft-gate.mjs
//   node tools/check-draft-gate.mjs --ablate
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(root, 'app', 'stone-author.html');
const ABLATE = process.argv.includes('--ablate');
const src0 = readFileSync(APP, 'utf8');
const index = JSON.parse(readFileSync(join(root, 'i18n', '_index.json'), 'utf8'));

// ---- lifting --------------------------------------------------------------------------------------
// A declaration, brace-matched. Lifting a MENTION instead would pick up a call site and define nothing.
function liftFn(src, name) {
  const needle = 'function ' + name + '(';
  const i = src.indexOf(needle);
  if (i < 0) throw new Error('app has no function ' + name + ' — this check is stale');
  if (src.indexOf(needle, i + 1) >= 0) throw new Error(name + ' is declared more than once — the lift is ambiguous');
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
  throw new Error('unbalanced braces lifting ' + name);
}
// `const idxDraft = l => …;` — one line, so take it to its line end.
function liftConst(src, name) {
  const needle = '  const ' + name + ' ';
  const i = src.indexOf(needle);
  if (i < 0) throw new Error('app has no const ' + name + ' — this check is stale');
  const end = src.indexOf('\n', i);
  return src.slice(i, end);
}

function build(src) {
  const text = [liftConst(src, 'idxDraft'), liftFn(src, 'resolve'), liftFn(src, 'pick'), liftFn(src, 'store')].join('\n');
  return (PACKS, INDEX, search, stored, langs) => new Function(
    'PACKS', 'INDEX', 'KEY', 'location', 'navigator', 'localStorage',
    text + '\nreturn pick();'
  )(PACKS, INDEX, 'sa.lang',
    { search }, { languages: langs },
    { getItem: () => stored, setItem: () => {} });
}

// ---- the claims -----------------------------------------------------------------------------------
// INDEX is the REAL catalogue, so a language promoted to stable later changes what this asserts —
// deliberately. `stable` is a language the shipped index does not currently have, so it is synthesised
// for the cases that need one; if one is ever promoted, drop it and use the real thing.
const DRAFTS = Object.keys(index).filter(l => index[l] && typeof index[l] === 'object' && index[l].draft);
const IDX = { ...index, sv: 'Svenska' };            // a stable entry, to prove the gate is about DRAFTS
const PACKS = { en: {} };

const CASES = [
  // the browser's guess reaches a stable language, and does not reach a draft
  ['browser asks for a stable language', IDX, '', null, ['sv'], 'sv', false],
  ['browser asks for a draft', IDX, '', null, ['ja'], 'en', false],
  ['browser asks for two drafts', IDX, '', null, ['ja', 'de'], 'en', false],
  ['browser prefers a draft, then a stable one', IDX, '', null, ['ja', 'sv'], 'sv', false],
  ['browser asks for a regional tag of a draft', IDX, '', null, ['de-AT'], 'en', false],
  ['browser asks for Traditional Chinese', IDX, '', null, ['zh-TW'], 'en', false],
  ['browser asks for nothing we have', IDX, '', null, ['xx'], 'en', false],
  // the two explicit routes reach a draft
  ['?lang= names a draft', IDX, '?lang=ja', null, ['en'], 'ja', true],
  ['?lang= names a regional tag of a draft', IDX, '?lang=de-AT', null, ['en'], 'de', true],
  ['?lang=zh-TW', IDX, '?lang=zh-TW', null, ['en'], 'zh-Hant', true],
  ['a remembered choice is a draft', IDX, '', 'ko', ['en'], 'ko', true],
  ['?lang= beats a remembered choice', IDX, '?lang=ja', 'ko', ['en'], 'ja', true],
  // and the explicit routes do not invent a language we do not have
  ['?lang= names nothing we have, browser has a draft', IDX, '?lang=xx', null, ['ja'], 'en', false],
];

function run(src) {
  const bad = [];
  let pick;
  try { pick = build(src); } catch (e) { return ['the lift failed: ' + e.message]; }
  for (const [what, idx, search, stored, langs, wantLang, wantExplicit] of CASES) {
    let got;
    try { got = pick(PACKS, idx, search, stored, langs); } catch (e) { bad.push(what + ': threw ' + e.message); continue; }
    if (!got || typeof got !== 'object' || !('lang' in got) || !('explicit' in got))
      { bad.push(what + ': pick() must return { lang, explicit }, got ' + JSON.stringify(got)); continue; }
    if (got.lang !== wantLang) bad.push(what + ': got ' + got.lang + ', wanted ' + wantLang);
    else if (got.explicit !== wantExplicit) bad.push(what + ': ' + got.lang + ' marked explicit=' + got.explicit + ', wanted ' + wantExplicit);
  }
  // THE LAUNDERING CLAUSE. pick() can be perfect and the gate still leak, if the auto-detected answer
  // is written to storage: next load it comes back as a remembered choice, which is explicit.
  const call = /await setLang\(want\.lang,\s*want\.explicit\)/.test(src);
  if (!call) bad.push('catalogue() does not pass want.explicit to setLang — an auto-detected language '
    + 'would be remembered, and a remembered one is explicit, so the gate would hold for exactly one load');
  const signature = /async function setLang\(lang,\s*remember\s*=\s*true\)/.test(src);
  if (!signature) bad.push('setLang has no `remember` parameter, so it writes storage unconditionally');
  const guarded = /if \(remember\) \{ try \{ localStorage\.setItem/.test(src);
  if (!guarded) bad.push('setLang writes localStorage without consulting `remember`');
  return bad;
}

if (!ABLATE) {
  const bad = run(src0);
  if (bad.length) {
    console.error('draft gate: ' + bad.length + ' problem(s)');
    for (const b of bad) console.error('  ' + b);
    process.exit(1);
  }
  console.log('draft gate: OK — ' + CASES.length + ' case(s) over the app\'s own pick(), and the '
    + 'remembered-choice path cannot launder a guess.');
  console.log('            ' + DRAFTS.length + ' pack(s) are drafts and none of them auto-activates: '
    + DRAFTS.join(' '));
  console.log('            Run --ablate to see each claim go red.');
  process.exit(0);
}

// ---- ablation -------------------------------------------------------------------------------------
// Each break is a plausible way the gate gets undone — a reverted line, a "simplification", a merge.
const ABLATIONS = [
  ['the draft test is dropped from the browser loop',
   s => s.replace('if (hit && !idxDraft(hit)) return { lang: hit, explicit: false };',
                  'if (hit) return { lang: hit, explicit: false };')],
  ['the browser loop is merged back in with the explicit ones',
   s => s.replace('for (const c of [new URLSearchParams(location.search).get(\'lang\'), store()]) {',
                  'for (const c of [new URLSearchParams(location.search).get(\'lang\'), store(), ...(navigator.languages || [])]) {')],
  ['an explicit choice stops being marked explicit',
   s => s.replace('if (hit) return { lang: hit, explicit: true };',
                  'if (hit) return { lang: hit, explicit: false };')],
  ['catalogue() forgets to pass the flag',
   s => s.replace('await setLang(want.lang, want.explicit);', 'await setLang(want.lang);')],
  ['setLang loses its remember parameter',
   s => s.replace('async function setLang(lang, remember = true) {', 'async function setLang(lang) {')],
  ['setLang writes storage whatever it was told',
   s => s.replace('if (remember) { try { localStorage.setItem(KEY, LANG); } catch (e) {} }',
                  'try { localStorage.setItem(KEY, LANG); } catch (e) {}')],
];

let bad = 0;
console.log('draft gate --ablate: ' + ABLATIONS.length + ' break(s), each must be caught');
for (const [what, mutate] of ABLATIONS) {
  const m = mutate(src0);
  if (m === src0) { console.error('  INERT   ' + what + ' — the mutation changed nothing, so it proves nothing'); bad++; continue; }
  const fail = run(m);
  if (!fail.length) { console.error('  BLIND   ' + what + ' — the check did not notice'); bad++; }
  else console.log('  red     ' + what + '  ->  ' + fail[0].slice(0, 86));
}
if (bad) { console.error('draft gate --ablate: ' + bad + ' ablation(s) did not behave'); process.exit(1); }
console.log('draft gate --ablate: every claim can go red');
