// A ROUTED ELEMENT'S INLINE TEXT MUST SAY WHAT THE DICTIONARY SAYS.
//
// Every `data-i18n` element carries its English inline, and `apply()` overwrites it at boot. So the
// user always sees the dictionary and a reader always sees the markup, and the two can drift apart
// indefinitely with nothing to notice. Four had: sl.rollD still said "Roller across" after its entry
// became "Roller diameter", and sl.wood-len still said "Plank length" - the same name its sibling
// sl.wood-plankLen holds, which is the board-against-plank collision this week closed everywhere
// else. One of the four was introduced the same afternoon by correcting the dictionary alone.
//
// WHY check-i18n CANNOT DO THIS. Its first rule strips the inner text of every routed element before
// hunting unrouted strings - correctly, because that text IS routed - and nothing afterwards compares
// it to the value that replaces it. The rule is right and this is the hole beside it.
//
// ENTITIES MUST DECODE FIRST, or this gate is noise. HTML source cannot hold a bare ampersand, so
// note.floor-planks writes `Tiles &amp; floor` where the dictionary holds `Tiles & floor`, and
// btn.fwd writes `&rsquo;` for `’`. Both are correct on both sides. Comparing raw text flags them,
// and a gate that cries about two keys nobody can fix gets switched off.
//
//   node tools/check-i18n-fallback.mjs
//   node tools/check-i18n-fallback.mjs --ablate
import { readFileSync } from 'fs';

const APP = 'app/stone-author.html';
const ABLATE = process.argv.includes('--ablate');
const app0 = readFileSync(APP, 'utf8');

// The FLOOR, not an expectation. 403 routed elements carry inline text today; more is fine and needs
// no edit here. Far fewer means the scan stopped matching and every claim below would pass on an
// almost empty set, which is the one way a gate like this fails silently.
const MIN_ELEMENTS = 350;

const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  mdash: '—', ndash: '–', minus: '−', times: '×',
  deg: '°', hellip: '…', middot: '·',
};
const decode = s => s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
  if (e[0] === '#') {
    const n = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  }
  return e in ENT ? ENT[e] : m;
});
// Whitespace is free: the markup wraps a long note across lines and the dictionary holds one line.
const norm = s => decode(s).replace(/\s+/g, ' ').trim();

function dictionary(app) {
  const EN = {};
  for (const m of app.matchAll(/^  "([a-z0-9]+\.[A-Za-z0-9._-]+)": (".*?"),?\s*$/gm)) {
    try { EN[m[1]] = JSON.parse(m[2]); } catch (e) {}
  }
  return EN;
}

// Every routed element with inline content. The closing tag is matched by name, so a nested element
// of the same name would end it early - none exist here, and `every-key-is-known` would catch the
// scan going wrong in a way that mattered.
function routed(app) {
  const out = [];
  for (const m of app.matchAll(/<([a-z0-9]+)[^>]*\bdata-i18n(-html)?="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    out.push({ key: m[3], html: !!m[2], inline: m[4] });
  }
  return out;
}

const CHECKS = {

  'elements-are-found': app => {
    const n = routed(app).length;
    if (n < MIN_ELEMENTS) {
      return 'found ' + n + ' routed element(s) with inline text, floor is ' + MIN_ELEMENTS
           + ' - the scan has stopped matching, so the comparison below would run on almost nothing';
    }
    return null;
  },

  // Without this, an unknown key is SKIPPED by the comparison rather than failing it - so renaming a
  // key in the markup alone would quietly remove that element from this gate's reach.
  'every-key-is-known': app => {
    const EN = dictionary(app);
    if (Object.keys(EN).length < 500) return 'only ' + Object.keys(EN).length + ' dictionary entries parsed - the pack scan is broken, so this gate cannot speak';
    const bad = routed(app).filter(r => !(r.key in EN)).map(r => r.key);
    if (bad.length) {
      return [...new Set(bad)].join(' ') + ' - routed in the markup but absent from the English pack, '
           + 'so the fallback comparison skips those elements entirely';
    }
    return null;
  },

  'fallback-matches-dictionary': app => {
    const EN = dictionary(app);
    const bad = [];
    for (const r of routed(app)) {
      if (!(r.key in EN)) continue;                      // every-key-is-known owns that failure
      const a = norm(r.inline), b = norm(String(EN[r.key]));
      if (a === b) continue;
      let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
      bad.push(r.key + ' differs at char ' + i + ': markup ' + JSON.stringify(a.slice(Math.max(0, i - 18), i + 24))
        + ' vs dictionary ' + JSON.stringify(b.slice(Math.max(0, i - 18), i + 24)));
    }
    if (bad.length) {
      return bad.join('; ') + ' - the user sees the dictionary and a reader sees the markup, so a '
           + 'stale fallback outlives the entry it was copied from';
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
    console.error('i18n fallback: ' + fail.length + ' problem(s)');
    for (const f of fail) console.error('  ' + f.name + ': ' + f.why);
    process.exit(1);
  }
  const r = routed(app0);
  console.log('i18n fallback: OK - ' + Object.keys(CHECKS).length + ' claims hold across ' + r.length
    + ' routed element(s) (' + r.filter(x => x.html).length + ' bound as HTML),');
  console.log('               every inline fallback says what its dictionary entry says, entities decoded.');
  console.log('               Run --ablate to see each claim go red.');
  process.exit(0);
}

const ABLATIONS = [
  ['a text fallback drifts from its entry', 'fallback-matches-dictionary',
   a => a.replace('data-i18n="sl.rollD">Roller diameter<', 'data-i18n="sl.rollD">Roller across<')],
  ['an HTML fallback drifts from its entry', 'fallback-matches-dictionary',
   a => a.replace('<b>Boards</b>, under Tiles &amp; floor', '<b>Planks</b>, under Tiles &amp; floor')],
  // the exact drift this gate was written for: typography, not words
  ['an em dash in a fallback becomes a hyphen', 'fallback-matches-dictionary',
   a => a.replace('for the whole run — that copy', 'for the whole run - that copy')],
  // and the thing it must NOT do, or it gets switched off
  ['an entity that decodes to the same character', 'STAYS-GREEN',
   a => a.replace('under Tiles &amp; floor', 'under Tiles &#38; floor')],
  ['a routed key is renamed in the markup only', 'every-key-is-known',
   a => a.replace('data-i18n="sl.rollD"', 'data-i18n="sl.rollDiameter"')],
  ['the scan stops matching routed elements', 'elements-are-found',
   a => a.split('data-i18n="').join('data-NOPE="')],
];

let bad = 0;
console.log('i18n fallback --ablate: ' + ABLATIONS.length + ' break(s), each must be caught by the named claim');
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
if (bad) { console.error('i18n fallback --ablate: ' + bad + ' ablation(s) did not behave'); process.exit(1); }
console.log('i18n fallback --ablate: every claim can go red, and an entity that decodes the same does not trip it');
