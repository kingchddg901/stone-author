// THE TOKEN-PANEL DECLARATIONS, CHECKED AGAINST THE THINGS THEY CLAIM TO DESCRIBE.
//
// COAT_TOKENS moved this panel's bounds out of the HTML and its labels out of data-i18n attributes. Both
// moves cost a check that used to happen for free:
//
//   THE KEYS. A control used to be an <input id="lens">, and the binder that wired it looked the id up in
//   G. A token is a string in an array, so a key that does not exist in G now writes a NEW key into the
//   slab on the first change - which moves the render signature and orphans every master made before it.
//
//   THE STRINGS. The labels resolve through TR(t.labelKey), a DYNAMIC key. tools/check-i18n.mjs finds
//   strings by scanning for literal TR('...') calls, so it cannot see any of these - nine labels and
//   three notes became invisible to the gate that exists to keep them translated.
//
//   THE BOUNDS. The widget clamps to [min, max]. A default outside its own bounds would therefore be
//   clamped the first time anything on the panel moved, silently changing the picture from the default
//   the rest of the app believes in.
//
//   node tools/check-panel-tokens.mjs
import { readFileSync } from 'fs';

const NEWLINE = String.fromCharCode(10);

const app = readFileSync('app/stone-author.html', 'utf8');
const fail = [];

// The declaration, read out of the app rather than duplicated here.
const decl = app.slice(app.indexOf('const COAT_TOKENS = ['), app.indexOf('];', app.indexOf('const COAT_TOKENS = [')) + 2);
if (!decl) { console.error('COAT_TOKENS not found'); process.exit(2); }
const tokens = decl.split(NEWLINE).filter(L => L.indexOf("key:") >= 0).map(L => {
  const t = { session: L.indexOf("session: true") >= 0 };
  for (const part of L.replace("{", "").replace("},", "").split(",")) {
    const c = part.indexOf(":"); if (c < 0) continue;
    const name = part.slice(0, c).trim(), raw = part.slice(c + 1).trim();
    if (raw.charAt(0) === "'") t[name] = raw.slice(1, raw.lastIndexOf("'"));
    else if (raw !== "" && raw !== "true" && raw !== "false") t[name] = Number(raw);
  }
  return t;
});
if (tokens.length < 5) { console.error('parsed only ' + tokens.length + ' tokens; the declaration shape moved'); process.exit(2); }

// G's declared defaults, read from the literal the app initialises G with.
const gSrc = app.slice(app.indexOf('const G = {'), app.indexOf('};', app.indexOf('const G = {')) + 2);
const gKeys = new Map([...gSrc.matchAll(/(\w+):\s*(-?[\d.]+)/g)].map(m => [m[1], Number(m[2])]));

// The English pack: the one every other pack is checked against.
const has = k => app.indexOf('"' + k + '":') >= 0;   // the packs are inline; check-i18n proves they agree

for (const t of tokens) {
  const where = 'COAT_TOKENS.' + t.key;
  if (t.session) {
    if (gKeys.has(t.key)) fail.push(where + ' is marked session:true but G HAS this key - the adapter would route it to the light and never write the slab');
  } else if (!gKeys.has(t.key)) {
    fail.push(where + ' is not a key of G - the first change to it would ADD a key to the slab and move every render signature');
  } else {
    const def = gKeys.get(t.key);
    if (!(def >= t.min && def <= t.max)) fail.push(where + ' default ' + def + ' lies outside its own bounds [' + t.min + ', ' + t.max + '] - the widget clamps, so the panel would change the picture on first use');
  }
  if (!(t.min < t.max)) fail.push(where + ' has min ' + t.min + ' >= max ' + t.max);
  if (!(t.step > 0)) fail.push(where + ' has a step of ' + t.step);
  for (const [what, k] of [['labelKey', t.labelKey], ['helpKey', t.helpKey]]) {
    if (k === undefined) { if (what === 'labelKey') fail.push(where + ' has no labelKey, so its name cannot be translated'); continue; }
    if (!has(k)) fail.push(where + ' ' + what + ' "' + k + '" is not in the English pack - TR() would render the key itself');
  }
}

// The panel shows G. A load REPLACES G wholesale, so the panel has to be rebuilt or it shows the slab
// that was just thrown away - which is not a cosmetic fault: it reads as the values being lost.
const resetAt = app.indexOf('reset(G, G0, o.G)');
const mountCalls = []; for (let k = -1; (k = app.indexOf('mountCoat();', k + 1)) >= 0; ) mountCalls.push(k);
if (resetAt < 0) fail.push('the wholesale reset of G was not found - this check no longer knows where to look');
else if (!mountCalls.some(c => c > resetAt)) fail.push('the load path replaces G but never calls mountCoat() afterwards - the coat panel would keep showing the slab that was just thrown away');

// A language change must re-register the group, or every label freezes in whatever pack loaded first.
// `/onChange([^)]*registerCoatGroup/` could never match: [^)] stops at the ")" in "onChange(() =>".
const ocAt = app.indexOf('SA_I18N.onChange(');
const onChangeLine = ocAt < 0 ? '' : app.slice(ocAt, ocAt + 600);   // the handler, however it is wrapped
if (onChangeLine.indexOf('registerCoatGroup') < 0)
  fail.push('a language change does not re-register the coat group - the labels resolve at registration and would freeze');

// ---- LAYER_PANELS: the same declaration shape, against a target that MOVES -------------------
//
// These edit whichever layer is active in their slot, so the things that can be wrong are different
// from the coat panel's. A slot that is not a slot of activeLayer resolves to undefined forever and
// the panel silently writes nothing. A host id with no element means the panel never mounts at all,
// and nothing says so - it is the quietest failure here, because the section still renders its other
// rows and simply has a gap where the controls were.
const lpAt = app.indexOf('const LAYER_PANELS = [');
if (lpAt < 0) fail.push('LAYER_PANELS not found - the per-layer panels are declared somewhere else now');
else {
  const lpDecl = app.slice(lpAt, app.indexOf(NEWLINE + '  ];', lpAt));
  const slotSrc = app.slice(app.indexOf('activeLayer = {'), app.indexOf('}', app.indexOf('activeLayer = {')));
  const slots = new Set(slotSrc.split(',').map(p => p.split(':')[0].trim().split(' ').pop()).filter(Boolean));
  const panels = lpDecl.split(NEWLINE).filter(L => L.indexOf("{ id: '") >= 0).map(L => ({
    id: L.split("id: '")[1].split("'")[0],
    slot: L.split("slot: '")[1].split("'")[0],
  }));
  if (!panels.length) fail.push('LAYER_PANELS parsed as empty - its shape moved');
  for (const p of panels) {
    if (!slots.has(p.slot)) fail.push('LAYER_PANELS ' + p.id + ' has slot "' + p.slot + '", which is not a slot of activeLayer - the target resolves to undefined and the panel writes nothing, silently');
    if (app.indexOf('id="' + p.id + '"') < 0) fail.push('LAYER_PANELS ' + p.id + ' has no element with that id - the panel never mounts and the section renders a gap');
  }
  const lTokens = lpDecl.split(NEWLINE).filter(L => L.indexOf("key: '") >= 0 && L.indexOf("id: '") < 0);
  for (const L of lTokens) {
    const key = L.split("key: '")[1].split("'")[0];
    const num = n => { const p = L.split(n + ": ")[1]; return p === undefined ? undefined : Number(p.split(",")[0]); };
    const def = num('def'), min = num('min'), max = num('max'), step = num('step');
    const lk = L.indexOf("labelKey: '") >= 0 ? L.split("labelKey: '")[1].split("'")[0] : undefined;
    const where = 'LAYER_PANELS token ' + key;
    if (!(def >= min && def <= max)) fail.push(where + ' default ' + def + ' lies outside [' + min + ', ' + max + '] - the widget clamps, so the panel would change the layer on first use');
    if (!(min < max)) fail.push(where + ' has min ' + min + ' >= max ' + max);
    if (!(step > 0)) fail.push(where + ' has a step of ' + step);
    if (!lk) fail.push(where + ' has no labelKey');
    else if (!has(lk)) fail.push(where + ' labelKey "' + lk + '" is not in the English pack');
  }
  if (app.indexOf('mountLayerPanels()') < 0) fail.push('nothing ever remounts the layer panels wholesale - a slab load would leave them pointing at the previous slab');
  if (onChangeLine.indexOf('registerLayerGroup') < 0) fail.push('a language change does not re-register the layer groups - their labels would freeze');
  console.log('layer panels: ' + panels.length + ', ' + lTokens.length + ' tokens');
}

console.log('coat tokens: ' + tokens.length + ' (' + tokens.filter(t => t.session).length + ' session, ' + tokens.filter(t => !t.session).length + ' in G)');
if (fail.length) { for (const f of fail) console.error('  ' + f); process.exit(1); }
console.log('  every key is in G, every default is inside its own bounds, every string is in the pack,');
console.log('  the load path rebuilds the panel and a language change re-registers it');
