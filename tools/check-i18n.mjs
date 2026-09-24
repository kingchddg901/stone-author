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

// ---- 2. every key the app asks for exists -------------------------------------------------------
const asked = new Set();
for (const m of markup.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) asked.add(m[1]);
for (const m of markup.matchAll(/data-i18n-attr="([^"]+)"/g))
  for (const pair of m[1].split(';')) { const j = pair.indexOf('='); if (j > 0) asked.add(pair.slice(j + 1).trim()); }
for (const m of js.matchAll(/(?<![\w.])TR\('([^']+)'/g)) asked.add(m[1]);
for (const k of asked) if (!enKeys.has(k)) fail.push(`key used but not in the English pack: ${k}`);

// ---- 3 + 4. every other pack matches English, key for key and placeholder for placeholder --------
const holes = v => new Set([...String(v).matchAll(/\{(\w+)\}/g)].map(m => m[1]));
const forms = v => (v && typeof v === 'object') ? Object.values(v) : [v];
const allHoles = v => { const s = new Set(); for (const f of forms(v)) for (const h of holes(f)) s.add(h); return s; };

const dir = join(root, 'i18n');
const packs = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')) : [];
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

console.log(`i18n: ${enKeys.size} English keys · ${asked.size} referenced · ${packs.length} translation pack(s)`);
if (fail.length) {
  console.error(`\n${fail.length} problem(s):`);
  for (const f of fail.slice(0, 40)) console.error('  - ' + f);
  if (fail.length > 40) console.error(`  ... and ${fail.length - 40} more`);
  process.exit(1);
}
console.log('i18n: OK');
