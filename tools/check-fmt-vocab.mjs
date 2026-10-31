// A SLIDER READOUT MAY NOT INVENT ITS OWN ENGLISH.
//
// Most readouts print a number. Sixteen of them print a WORD instead, because a number would say
// nothing: a trunk with no taper is a "cylinder", a branch nobody grafted is "own wood", glass with
// no bubbles is "clear". Those words are user-facing strings and have to route through TR like every
// other one - and for a long time none of them did. Five formatter tables, eighteen words, eight
// locales reading them in English.
//
// WHY check-i18n CANNOT DO THIS. Its prose rule calls a literal user-facing at 34 characters AND
// five spaces, which is the right shape for a sentence and blind to a vocabulary: "clean" is five
// characters and no spaces, "never" the same, "alive" the same. The rule is not wrong, it is aimed
// at a different thing. Nothing was watching this axis at all, which is why the leak at the island
// hint survived in three places and was found by eye in a render rather than by a gate.
//
// WHAT IS DELIBERATELY STILL ENGLISH, and why no allowlist carries it: 'gain' is the BOOST state
// token - '' or 'gain' - and it goes into renderSig and a master's own record, so translating it
// would move the signature of every picture rendered after. It lives in COAT_TOKENS, not in a
// formatter table, so scoping this gate to *FMT bodies excludes it by construction. An allowlist
// entry would have been an off switch; a scope boundary cannot be widened by accident.
//
//   node tools/check-fmt-vocab.mjs
//   node tools/check-fmt-vocab.mjs --ablate
import { readFileSync } from 'fs';

const APP = 'app/stone-author.html';
const ABLATE = process.argv.includes('--ablate');
const app0 = readFileSync(APP, 'utf8');

// The FLOOR, not an expectation. Five tables exist today; a sixth is fine and needs no edit here,
// but FOUR means the scan stopped seeing one and every other claim below would pass vacuously on
// whatever was left. A gate whose subject can quietly become the empty set is not a gate.
const MIN_TABLES = 5;

// Walk from the `{` of a declaration to its matching `}`, skipping anything inside a string, a
// template or a comment. A regex cannot do this: these tables contain `}` inside `${...}` on nearly
// every line, and an earlier version of this scan read a body that ended at the first one.
function tableBody(s, open) {
  let depth = 0, mode = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i], p = s[i - 1];
    if (mode) {
      if (mode === '//' && c === '\n') mode = null;
      else if (mode === '/*' && p === '*' && c === '/') mode = null;
      else if ((mode === "'" || mode === '"' || mode === '`') && c === mode && p !== '\\') mode = null;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') mode = '//';
    else if (c === '/' && s[i + 1] === '*') mode = '/*';
    else if (c === "'" || c === '"' || c === '`') mode = c;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(open, i + 1); }
  }
  return null;
}

function tables(s) {
  const out = [];
  for (const m of s.matchAll(/const (\w*FMT) = \{/g)) {
    out.push({ name: m[1], body: tableBody(s, m.index + m[0].length - 1) });
  }
  return out;
}

// Collect the string literals in a body, IGNORING comments, with the same state machine the brace
// walk uses. Two things made the first version of this wrong on the real app, and both are the kind
// of wrong that reads as a defect in the code rather than in the gate:
//
//   - it scanned the raw body, so a comment counted. GLFMT explains itself with "1 is not 'a bit'
//     of anything, it is a ribbon with nothing left to give" and the gate reported 'a bit'.
//   - it stripped `TR('key')` by shape, and lightTemp does not have that shape: it picks its key
//     with a ternary INSIDE the call - TR(v < 0 ? 'ui.temp-warm' : 'ui.temp-cool', {...}) - so two
//     keys read as bare words.
//
// So: gather every literal, then PARTITION by shape rather than by call syntax. A key has a dot and
// no spaces; no readout word in any language has a dot. That covers a key wherever it sits - as a
// direct argument, inside a ternary, or in a lookup - and it hands every key to formatter-keys-exist
// instead of quietly discarding it.
function scan(body) {
  const lits = [];
  let mode = null, start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i], p = body[i - 1];
    if (mode) {
      if (mode === '//' && c === '\n') mode = null;
      else if (mode === '/*' && p === '*' && c === '/') mode = null;
      else if ((mode === "'" || mode === '"') && c === mode && p !== '\\') { lits.push(body.slice(start, i)); mode = null; }
      else if (mode === '`' && c === '`' && p !== '\\') mode = null;
      continue;
    }
    if (c === '/' && body[i + 1] === '/') mode = '//';
    else if (c === '/' && body[i + 1] === '*') mode = '/*';
    else if (c === "'" || c === '"') { mode = c; start = i + 1; }
    else if (c === '`') mode = '`';
  }
  return lits;
}
const KEY_SHAPED = /^[a-z0-9]+\.[A-Za-z0-9._-]+$/;
// Two or more consecutive letters is a word. One letter is an axis or a flag ('x', 'v'); a symbol,
// a unit written in a template, or a punctuation string is not a word and is not this gate's business.
const wordLike = v => /[A-Za-z]{2,}/.test(v) && !KEY_SHAPED.test(v);

// the English pack, so a TR key a formatter names can be checked to exist
function enKeys(s) {
  const k = new Set();
  for (const m of s.matchAll(/^  "([a-z0-9]+\.[A-Za-z0-9._-]+)":/gm)) k.add(m[1]);
  return k;
}

const CHECKS = {

  'tables-are-found': app => {
    const t = tables(app);
    if (t.length < MIN_TABLES) {
      return 'found ' + t.length + ' *FMT table(s), floor is ' + MIN_TABLES + ' - the scan has stopped '
           + 'seeing at least one, so the vocabulary checks below would pass on what is left rather '
           + 'than on the whole app (found: ' + (t.map(x => x.name).join(' ') || 'none') + ')';
    }
    return null;
  },

  'every-body-parses': app => {
    const bad = tables(app).filter(t => !t.body || t.body.length < 40);
    if (bad.length) {
      return bad.map(b => b.name + (b.body ? ' parsed to only ' + b.body.length + ' chars' : ' did not parse'))
                .join('; ') + ' - a body that ends early hides every entry after the cut';
    }
    return null;
  },

  'no-bare-vocabulary': app => {
    const bad = [];
    for (const t of tables(app)) {
      if (!t.body) continue;                                 // every-body-parses owns that failure
      for (const v of scan(t.body)) if (wordLike(v)) bad.push(t.name + ' says ' + JSON.stringify(v));
    }
    if (bad.length) {
      return bad.join('; ') + ' - a readout word must go through TR, or eight locales read it in '
           + 'English. check-i18n cannot see this: its prose rule needs 34 characters and five spaces';
    }
    return null;
  },

  'formatter-keys-exist': app => {
    const en = enKeys(app);
    if (en.size < 500) return 'only ' + en.size + ' English keys parsed out of the app - the pack scan is broken, so this check cannot speak';
    const bad = [];
    let seen = 0;
    for (const t of tables(app)) {
      if (!t.body) continue;
      // every key-SHAPED literal, not only the ones that sit directly after `TR(` - lightTemp picks
      // its key inside a ternary, and a scan keyed on call syntax never sees those two at all
      for (const v of scan(t.body)) {
        if (!KEY_SHAPED.test(v)) continue;
        seen++;
        if (!en.has(v)) bad.push(t.name + ' -> ' + v);
      }
    }
    if (!seen) return 'no i18n key appears in any formatter table - either every readout word went back to being English, or the literal scan is broken; either way this check has nothing to stand on';
    if (bad.length) {
      return bad.join('; ') + ' - a formatter names a key the English pack does not define, so that '
           + 'readout renders the key text or nothing at all';
    }
    return null;
  },
};

const run = app => {
  const fail = [];
  for (const [name, fn] of Object.entries(CHECKS)) {
    let why = null;
    try { why = fn(app); } catch (e) { why = 'the check itself threw: ' + (e && e.message); }
    if (why) fail.push({ name, why });
  }
  return fail;
};

if (!ABLATE) {
  const fail = run(app0);
  if (fail.length) {
    console.error('fmt vocab: ' + fail.length + ' problem(s)');
    for (const f of fail) console.error('  ' + f.name + ': ' + f.why);
    process.exit(1);
  }
  const t = tables(app0);
  const words = t.reduce((n, x) => n + (x.body ? scan(x.body).filter(v => KEY_SHAPED.test(v)).length : 0), 0);
  console.log('fmt vocab: OK - ' + Object.keys(CHECKS).length + ' claims hold across ' + t.length
    + ' tables (' + t.map(x => x.name).join(' ') + '),');
  console.log('           ' + words + ' routed readout word(s) and no bare English left in any of them.');
  console.log('           Run --ablate to see each claim go red.');
  process.exit(0);
}

// ABLATIONS. Each breaks the app text one way and names the check that must catch it. A break that
// NO check catches prints as a BLIND SPOT rather than passing quietly, which is the whole point of
// keeping the table: it measures what the gate cannot see, not only what it can.
const ABLATIONS = [
  ['a bare word returns to GFMT', 'no-bare-vocabulary',
   a => a.replace("lightTemp: v => (+v == 0 ? TR('ui.temp-neutral')", "lightTemp: v => (+v == 0 ? 'neutral'")],
  ['a bare word returns to WDFMT', 'no-bare-vocabulary',
   a => a.replace("taper: v => +v === 0 ? TR('ui.taper-cylinder')", "taper: v => +v === 0 ? 'cylinder'")],
  ['a bare word returns to GLFMT', 'no-bare-vocabulary',
   a => a.replace("incl: v => +v === 0 ? TR('ui.incl-none')", "incl: v => +v === 0 ? 'none'")],
  ['a bare word returns to FMT', 'no-bare-vocabulary',
   a => a.replace("maskSpec: v => (+v === 0 ? TR('hint.daylight')", "maskSpec: v => (+v === 0 ? 'daylight'")],
  ['a formatter names a key that does not exist', 'formatter-keys-exist',
   a => a.replace("TR('ui.taper-cylinder')", "TR('ui.taper-cylindre')")],
  // THE SHAPE THAT DEFEATED THE FIRST VERSION of this gate. lightTemp selects its key inside the
  // call, so a scan keyed on `TR('...` sees neither key - it reported both as bare English on the
  // real app, and a typo in one would have gone unnoticed. Pinned so it cannot regress to that.
  ['a key chosen inside a ternary is misspelled', 'formatter-keys-exist',
   a => a.replace("'ui.temp-warm' : 'ui.temp-cool'", "'ui.temp-warmer' : 'ui.temp-cool'")],
  // INVERTED on purpose, which is why its owner is STAYS-GREEN: a comment is prose ABOUT the code,
  // not a string the code renders, so planting words in one must NOT trip the gate. The first
  // version of this scan read comments and reported GLFMT's own "1 is not 'a bit' of anything" as a
  // leak. A false positive here is worse than a miss: it would fail CI on a sentence.
  ['words planted in a comment, which must NOT trip it', 'STAYS-GREEN',
   a => a.replace('const GLFMT = {', "const GLFMT = {   // a comment that says 'bare wood' and 'never'\n")],
  // every-body-parses earns its place by this one: a body the walk cannot read is SKIPPED by
  // no-bare-vocabulary rather than failing it, so a table that collapses takes its own coverage with
  // it and every other claim still passes. Emptying one is the cheapest way to produce that state.
  ['a table body collapses to nothing', 'every-body-parses',
   a => { const t = tables(a).find(x => x.name === 'TFMT' && x.body); return t ? a.replace('const TFMT = ' + t.body, 'const TFMT = {}') : a; }],
  ['a table is renamed out of the scan', 'tables-are-found',
   a => a.replace('const WDFMT = {', 'const WOODFORMAT = {')],
  ['every table is renamed out of the scan', 'tables-are-found',
   a => a.replace(/const (\w*)FMT = \{/g, 'const $1FORMAT = {')],
];

let bad = 0;
console.log('fmt vocab --ablate: ' + ABLATIONS.length + ' break(s), each must be caught by the named claim');
for (const [what, owner, mutate] of ABLATIONS) {
  const mutated = mutate(app0);
  if (mutated === app0) { console.error('  INERT   ' + what + ' - the mutation changed nothing, so this ablation proves nothing'); bad++; continue; }
  const fail = run(mutated);
  const names = fail.map(f => f.name);
  if (owner === 'STAYS-GREEN') {
    if (fail.length) { console.error('  FALSE+  ' + what + ' - tripped ' + names.join(', ') + ', and it must not'); bad++; }
    else console.log('  green   ' + what);
    continue;
  }
  if (!fail.length) { console.error('  BLIND   ' + what + ' - no claim caught it'); bad++; }
  else if (!names.includes(owner)) { console.error('  WRONG   ' + what + ' - caught by ' + names.join(', ') + ', expected ' + owner); bad++; }
  else console.log('  red     ' + what + '  ->  ' + owner);
}
if (bad) { console.error('fmt vocab --ablate: ' + bad + ' ablation(s) did not behave'); process.exit(1); }
console.log('fmt vocab --ablate: every claim can go red, and each is caught by the one that owns it');
