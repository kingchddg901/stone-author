// i18n gate. Fails the build on the four ways a translated UI silently rots:
//
//   1. a user-facing string in the markup that never got a key   (it can never be translated)
//   2. a key referenced by the studio that no pack defines        (the UI renders the key name)
//   3. a pack that has drifted from English — missing or extra    (a half-translated screen)
//   4. a translation whose placeholders differ from English       (the value is silently dropped)
//
// (4) is the quiet one: "Deleted {name}" translated without {name} loses the layer name at runtime
// and nothing throws. Run:  node tools/check-i18n.mjs
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'app', 'stone-author.html'), 'utf8');
const fail = [];

// ---- pull the inlined English pack out of the app (it is the source of truth) -------------------
const at = src.indexOf('const PACKS = { en: ');
if (at < 0) { console.error('could not find the inlined English pack'); process.exit(1); }
let i = src.indexOf('{', at + 19), depth = 0, start = i;
for (;; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; if (depth === 0) break; }
const EN = JSON.parse(src.slice(start, i + 1));
const enKeys = new Set(Object.keys(EN));

const markup = src.slice(src.indexOf('<div class="wrap">'), src.indexOf('<script id="sa-i18n">'));
const js = src.slice(src.indexOf('<script>', src.indexOf('</script>', src.indexOf('<script id="sa-i18n">'))));

// ---- 1. every user-facing string in the markup carries a key ------------------------------------
const SYM = /^[\s\d]*(&[a-z]+;|[+\-—·×])?[\s\d]*$/;
const routedStripped = markup.replace(/<([a-z0-9]+)([^>]*\bdata-i18n(?:-html)?="[^"]*"[^>]*)>[\s\S]*?<\/\1>/g, '<x></x>');
for (const m of routedStripped.matchAll(/>([^<>]+)</g)) {
  const t = m[1].trim();
  if (t && !SYM.test(t)) fail.push(`unrouted markup text: ${JSON.stringify(t.slice(0, 60))}`);
}
for (const m of markup.matchAll(/<[a-z0-9]+((?:[^<>"]|"[^"]*")*?)>/g)) {
  const a = /(?:aria-label|title|alt|placeholder)="([^"]+)"/.exec(m[1]);
  if (a && !SYM.test(a[1]) && !m[1].includes('data-i18n-attr')) fail.push(`unrouted attribute: ${JSON.stringify(a[1].slice(0, 60))}`);
}

// ---- 1c. the pack is PLAIN TEXT, except where the markup says otherwise ------------------------
// A value bound with data-i18n is written with textContent, and one bound with data-i18n-attr goes
// through setAttribute: neither resolves HTML entities, so "&amp;" renders as the five characters
// &-a-m-p-;. It shipped that way on four section headings, and because .sec summaries are uppercased
// by CSS it reached the screen as "CLOUDS &AMP; WARP". Only data-i18n-html keys may carry markup.
{
  const htmlKeys = new Set([...markup.matchAll(/data-i18n-html="([^"]+)"/g)].map(m => m[1]));
  const ENT = /&(?:[a-zA-Z][a-zA-Z0-9]{1,9}|#\d{1,5}|#x[0-9a-fA-F]{1,5});/;
  for (const [k, v] of Object.entries(EN)) {
    if (htmlKeys.has(k)) continue;
    for (const form of (v && typeof v === 'object') ? Object.values(v) : [v]) {
      const hit = ENT.exec(String(form));
      if (hit) fail.push(`${k}: holds the HTML entity "${hit[0]}" but is written as text, so it renders literally — use the character itself`);
    }
  }
}

// ---- 2. every key the app asks for exists -------------------------------------------------------
const asked = new Set();
for (const m of markup.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) asked.add(m[1]);
for (const m of markup.matchAll(/data-i18n-attr="([^"]+)"/g))
  for (const pair of m[1].split(';')) { const j = pair.indexOf('='); if (j > 0) asked.add(pair.slice(j + 1).trim()); }
for (const m of js.matchAll(/(?<![\w.])TR\('([^']+)'/g)) asked.add(m[1]);
// A key built by concatenation — TR('cal.phase.' + ph) — reaches here as its literal prefix. That is not
// a missing key, but it is not nothing either: the prefix must have at least one entry, or every lookup
// through it renders the key name. Check the family instead of the literal.
for (const k of asked) {
  if (enKeys.has(k)) continue;
  if (k.endsWith('.')) {
    if (![...enKeys].some(e => e.startsWith(k))) fail.push(`dynamic key prefix "${k}…" matches no entry in the English pack`);
    continue;
  }
  fail.push(`key used but not in the English pack: ${k}`);
}

// ---- 3 + 4. every other pack matches English, key for key and placeholder for placeholder --------
const holes = v => new Set([...String(v).matchAll(/\{(\w+)\}/g)].map(m => m[1]));
const forms = v => (v && typeof v === 'object') ? Object.values(v) : [v];
const allHoles = v => { const s = new Set(); for (const f of forms(v)) for (const h of holes(f)) s.add(h); return s; };

const dir = join(root, 'i18n');
// `_`-prefixed files are translator apparatus (_glossary, _context), not packs — they hold different
// shapes and would fail every key comparison below.
const packs = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_')) : [];
for (const file of packs) {
  const lang = file.replace(/\.json$/, '');
  const pack = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  for (const k of enKeys) if (!(k in pack)) fail.push(`${lang}: missing key ${k}`);
  for (const k of Object.keys(pack)) if (!enKeys.has(k)) fail.push(`${lang}: stale key not in English: ${k}`);
  for (const k of Object.keys(pack)) {
    if (!enKeys.has(k)) continue;
    const want = allHoles(EN[k]), got = allHoles(pack[k]);
    for (const h of want) if (!got.has(h)) fail.push(`${lang}: ${k} drops the {${h}} placeholder — that value vanishes at runtime`);
    for (const h of got) if (!want.has(h)) fail.push(`${lang}: ${k} invents a {${h}} placeholder English does not supply`);
  }
}

// ---- 2b. prose sitting in the JS that never reaches a pack ----------------------------------------
// The markup check above cannot see a user-facing string that lives in a JS table. Exactly that happened:
// a `HINTS` object held fourteen tool descriptions, every one of them on screen, none of them routed,
// and the gate said OK. So walk the studio's own script for literals that read like prose and are not
// keys. Comments are skipped, since an apostrophe in one would otherwise open a phantom string.
{
  const src2 = js;
  const lits = [];
  for (let k = 0; k < src2.length; k++) {
    const c = src2[k];
    if (c === '/' && src2[k + 1] === '/') { k = src2.indexOf('\n', k); if (k < 0) break; continue; }
    if (c === '/' && src2[k + 1] === '*') { k = src2.indexOf('*/', k) + 1; if (k < 1) break; continue; }
    if (c !== "'" && c !== '"') continue;
    let e = k + 1;
    for (; e < src2.length; e++) { if (src2[e] === '\\') { e++; continue; } if (src2[e] === c) break; }
    lits.push(src2.slice(k + 1, e)); k = e;
  }
  const PROSE = /^(?=.*[a-z]{3})[^<>{}]*$/;             // sentence-ish, not markup and not a template
  for (const t of lits) {
    if (t.length < 34) continue;                        // short labels are caught by other checks
    if ((t.match(/ /g) || []).length < 5) continue;      // needs to read like a sentence
    if (!PROSE.test(t)) continue;
    if (/^[a-z0-9.\-_/]+$/.test(t)) continue;           // a key or a path
    // CSS font shorthands: '11px "IBM Plex Mono", …' whole, or 'px "IBM Plex Sans", …' when the size was
    // concatenated on. A generic family keyword is the unambiguous tell and cannot appear in real prose.
    if (/^\d/.test(t)) continue;
    if (/\b(sans-serif|ui-monospace|monospace|system-ui)\b/.test(t)) continue;
    if (enKeys.has(t)) continue;                        // it IS a key
    fail.push(`prose literal in the studio script, not routed through a pack: ${JSON.stringify(t.slice(0, 62))}…`);
  }
}

// ---- 4b. the source English is BRITISH ------------------------------------------------------------
// Measured, not assumed: the user-facing prose runs 25 "colour" to 0 "color". A stray American spelling
// is therefore an inconsistency a reader notices, and it is cheapest to catch before it is translated
// 18 times. Deliberately NOT on this list: "artifact", which the studio uses throughout as the rendering
// term of art, and "-ize" endings, which are valid British (Oxford) spelling.
const AMERICANISMS = [
  [/\bcolors?\b/i, 'colour'], [/\bcolou?rize\b/i, 'colourise'], [/\bgray(s|ish)?\b/i, 'grey'],
  [/\bcenters?\b/i, 'centre'], [/\bcentered\b/i, 'centred'], [/\bfibers?\b/i, 'fibre'],
  [/\bneighbou?r\b/i, 'neighbour'], [/\bbehaviors?\b/i, 'behaviour'], [/\bcatalogs?\b/i, 'catalogue'],
  [/\banalyze[ds]?\b/i, 'analyse'], [/\bmodeling\b/i, 'modelling'], [/\bmodeled\b/i, 'modelled'],
  [/\btraveling\b/i, 'travelling'], [/\bdefense\b/i, 'defence'], [/\bgeologic\b/i, 'geological'],
  [/\bmeters?\b/i, 'metre'], [/\bliters?\b/i, 'litre'], [/\bjewelry\b/i, 'jewellery'],
];
for (const [k, v] of Object.entries(EN)) {
  for (const form of (v && typeof v === 'object') ? Object.values(v) : [v]) {
    for (const [re, want] of AMERICANISMS) {
      const hit = re.exec(String(form));
      if (hit) fail.push(`${k}: American spelling "${hit[0]}" — this UI is British English, use "${want}"`);
    }
  }
}

// ---- 4c. the layout must mirror, because two of the languages read right to left -----------------
// Arabic and Hebrew are in the pack set. The i18n core sets dir="rtl" on the root for those, which only
// works if the CSS asks for inline-start/end rather than left/right. A single margin-left is enough to
// strand one control on the wrong side, and it is invisible to anyone testing in English.
{
  const style = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
  const inline = [...src.matchAll(/style="([^"]*)"/g)].map(m => m[1]).join(' ; ');
  const PHYSICAL = [
    [/margin-(left|right)\s*:/g, 'margin-inline-start / margin-inline-end'],
    [/padding-(left|right)\s*:/g, 'padding-inline-start / padding-inline-end'],
    [/border-(left|right)(-\w+)?\s*:/g, 'border-inline-start / border-inline-end'],
    [/text-align\s*:\s*(left|right)(?![-\w])/g, 'text-align: start / end'],
    [/(?<![\w-])(left|right)\s*:\s*(?!auto\s*;?\s*\/\/)/g, 'inset-inline-start / inset-inline-end'],
  ];
  for (const [where, blob] of [['the style block', style], ['an inline style attribute', inline]])
    for (const [re, want] of PHYSICAL)
      for (const hit of blob.matchAll(re))
        fail.push(`${where} uses "${hit[0].trim()}" — the UI ships Arabic and Hebrew, so use ${want}`);
  if (!/documentElement/.test(src) || !/\.dir\s*=/.test(src))
    fail.push('nothing sets the document direction — an RTL pack would translate the words and leave the layout mirrored wrong');
}

// ---- 4d. a plural key must carry the forms ITS OWN language has -----------------------------------
// English has one/other. Polish, Czech and Russian have one/few/many/other; Arabic has six; Japanese,
// Korean, Chinese and Indonesian have only other. T() falls back to `other` when the category it needs
// is absent, so a pack carrying English's two forms does not break — it just quietly says "5 files" with
// the wrong ending for ever, in the four languages where anyone would notice. ICU is the authority here,
// not a table I typed: Intl.PluralRules tells us what each language actually requires.
for (const file of packs) {
  const lang = file.replace(/\.json$/, '');
  const pack = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  let want;
  try { want = new Intl.PluralRules(lang).resolvedOptions().pluralCategories; }
  catch (_) { fail.push(`${lang}: not a language tag Intl understands, so its plural forms cannot be checked`); continue; }
  const need = [...want].sort().join(',');
  for (const k of enKeys) {
    if (!EN[k] || typeof EN[k] !== 'object') continue;          // not a count string
    const got = pack[k];
    if (got == null) continue;                                   // already reported as a missing key
    if (typeof got !== 'object') { fail.push(`${lang}: ${k} is a count string in English but a single string here — it can never agree with {n}`); continue; }
    const have = Object.keys(got).sort().join(',');
    if (have !== need) fail.push(`${lang}: ${k} has forms [${have}] but ${lang} takes [${need}]`);
  }
}

// ---- 4e. and the same plain-text rule applies to every pack, not only to English -----------------
// A translator reaching for "&amp;" in a section heading gets the same literal five characters, and the
// English pack has no business being the only one protected. Same allowance: data-i18n-html keys only.
{
  const htmlKeys = new Set([...markup.matchAll(/data-i18n-html="([^"]+)"/g)].map(m => m[1]));
  const ENT = /&(?:[a-zA-Z][a-zA-Z0-9]{1,9}|#\d{1,5}|#x[0-9a-fA-F]{1,5});/;
  for (const file of packs) {
    const lang = file.replace(/\.json$/, '');
    const pack = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const [k, v] of Object.entries(pack)) {
      if (htmlKeys.has(k)) continue;
      for (const form of (v && typeof v === 'object') ? Object.values(v) : [v]) {
        const hit = ENT.exec(String(form));
        if (hit) fail.push(`${lang}: ${k} holds the HTML entity "${hit[0]}" but is written as text, so it renders literally — use the character itself`);
      }
    }
  }
}

// ---- 4f. the catalogue and the folder must agree --------------------------------------------------
// The studio learns which languages exist from i18n/_index.json. A pack missing from it is unreachable —
// it cannot be listed in the menu, matched by ?lang=, or picked from the browser's preferences — and an
// entry with no pack file offers the reader a language that 404s and silently falls back to English.
{
  const idxPath = join(dir, '_index.json');
  if (!existsSync(idxPath)) {
    if (packs.length) fail.push('i18n/_index.json is missing, so none of the packs beside it can be reached');
  } else {
    const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
    if (idx.en) fail.push('_index.json lists "en" — English ships inline and must not be fetched');
    for (const lang of Object.keys(idx))
      if (!packs.includes(lang + '.json')) fail.push(`_index.json offers "${lang}" but i18n/${lang}.json does not exist — the menu would offer a language that 404s`);
    for (const file of packs) {
      const lang = file.replace(/\.json$/, '');
      if (!(lang in idx)) fail.push(`i18n/${file} exists but _index.json does not list it — nothing can reach that pack`);
      else if (!String(idx[lang]).trim()) fail.push(`_index.json gives "${lang}" no name, so the menu would show a blank row`);
    }
  }
}

// ---- 5. translator context: every key explained, every placeholder named, no stale entries ---------
// These words are mostly ordinary English carrying a domain meaning (gauge, family, ground, matrix,
// island, warp, moon, web), so a translator without context picks the wrong sense and the result reads
// fine. Context is therefore part of the source, not a nicety — and it has to be kept honest.
let ctx = null, glossary = null;
const ctxPath = join(dir, '_context.json'), glPath = join(dir, '_glossary.json');
if (existsSync(ctxPath)) ctx = JSON.parse(readFileSync(ctxPath, 'utf8'));
if (existsSync(glPath)) glossary = JSON.parse(readFileSync(glPath, 'utf8'));
let terms = new Set();
if (glossary) for (const group of ['homographs', 'termsOfArt']) for (const t of Object.keys(glossary[group] || {})) terms.add(t);

if (ctx) {
  const holesOf = v => new Set([...String(v).matchAll(/\{(\w+)\}/g)].map(m => m[1]));
  for (const k of enKeys) {
    const e = ctx[k];
    if (!e) { fail.push(`no translator context for ${k} — add it to i18n/_context.json`); continue; }
    if (!e.where) fail.push(`${k}: context has no "where" — a translator cannot see the screen`);
    const want = new Set();
    for (const f of (EN[k] && typeof EN[k] === 'object') ? Object.values(EN[k]) : [EN[k]]) for (const h of holesOf(f)) want.add(h);
    for (const h of want) {
      if (!e.placeholders || !e.placeholders[h]) fail.push(`${k}: placeholder {${h}} is not described in _context.json`);
      else if (!String(e.placeholders[h]).trim()) fail.push(`${k}: placeholder {${h}} has an empty description`);
    }
    for (const t of (e.terms || [])) if (!terms.has(t)) fail.push(`${k}: context cites "${t}", which is not in _glossary.json`);
  }
  for (const k of Object.keys(ctx)) if (!enKeys.has(k)) fail.push(`stale context entry for a key that no longer exists: ${k}`);
} else {
  fail.push('i18n/_context.json is missing — translators would be working blind');
}

const flagged = ctx ? Object.values(ctx).filter(e => e.terms).length : 0;
console.log(`i18n: ${enKeys.size} English keys · ${asked.size} referenced · ${packs.length} translation pack(s)`);
console.log(`i18n: ${ctx ? Object.keys(ctx).length : 0} context entries · ${terms.size} glossary terms · ${flagged} strings carrying one`);
if (fail.length) {
  console.error(`\n${fail.length} problem(s):`);
  for (const f of fail.slice(0, 40)) console.error('  - ' + f);
  if (fail.length > 40) console.error(`  ... and ${fail.length - 40} more`);
  process.exit(1);
}
console.log('i18n: OK');
