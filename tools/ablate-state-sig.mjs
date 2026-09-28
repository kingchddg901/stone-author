// PROOF THAT state-sig.mjs CAN BITE, and that it bites only where it should.
//
// A signature that moves when anything changes is no more use than one that never moves: it would fail
// every rename and every panel tweak, and get switched off in a week. So this runs the check in both
// directions against test-slabs/default-state.json - 4 marks, 11 layers, the state the app opens in.
//
//   MUST MOVE    a real change to the picture or the light, and the two shapes a refactor produces:
//                a number that became a string, and a key a default filled in.
//   MUST NOT     bookkeeping the picture does not depend on. These are the load-bearing half. Each one
//                asserts something the app actually promises, so a failure here is a finding about the
//                APP, not about this script.
//
//   node tools/ablate-state-sig.mjs
import { readFileSync } from 'fs';
import { stateSig } from './state-sig.mjs';

const NEWLINE = String.fromCharCode(10);

const PATH = 'test-slabs/default-state.json';
const base = JSON.parse(readFileSync(PATH, 'utf8'));
const clone = () => JSON.parse(JSON.stringify(base));
const sig = s => stateSig(s, -1, true, false) + '/' + stateSig(s, 0, false, false);
const BASE = sig(base);

// MUST MOVE. Drawing, hiding and deleting are three different operations on marks and the app treats
// them differently - hide is reversible and keeps the mark, Undo pops it, deleting a layer takes every
// mark in it. All three change the picture, so all three must move.
const mustMove = [
  ['one more mark drawn (a 5th vein)', s => {
    const m = JSON.parse(JSON.stringify(s.marks[0]));
    m.id = s.nextId; m.seed = 9901; s.marks.push(m); s.nextId++;
  }],
  ['one mark hidden (Tune, then hide)', s => { s.hidden.push(3); }],
  ['the last mark undone (marks.pop)', s => { s.marks.pop(); }],
  ['a layer deleted with its marks', s => {
    s.layers = s.layers.filter(L => L.key !== 'web');
    s.marks = s.marks.filter(m => m.kind !== 'web');
  }],
  ['one sample moved by 0.001', s => { s.marks[0].samples[30][1] += 0.001; }],
  ['a number became a string', s => { s.G.subsurface = String(s.G.subsurface); }],
  ['a key a default filled in', s => { s.G.newTokenDefault = 0; }],
  ['one G value nudged', s => { s.G.lightAngle = 136; }],
  ['a layer label translated', s => { s.layers[0].label = 'Fond / sol'; }],
  ['key order in G reversed', s => {
    const o = {}; for (const k of Object.keys(s.G).reverse()) o[k] = s.G[k]; s.G = o;
  }],
  ['a layer switched off', s => { s.layers[5].on = false; }],
  ['the family changed', s => { s.fam = 'granite'; }],
];

// MUST NOT MOVE. Each of these is a claim the app makes out loud.
const mustNot = [
  ['the slab NAME', s => { s.name = 'a private twin'; },
    'the name is user-editable, which is why the device seal strips it: a published slab must open a\n    master sealed under a privately-named copy of the same stone.'],
  ['nextId', s => { s.nextId += 40; },
    'bookkeeping for the next id to mint. Two slabs with the same marks are the same picture however\n    many were drawn and undone getting there.'],
  ['NEXT, the next-stroke settings', s => { s.NEXT.gauge = 3; s.NEXT.variant = 'wild'; },
    'THE FORWARD-ONLY RULE, as an assertion: "settings apply to your next line, never the last one".\n    Every mark carries its own copy of p, so NEXT cannot reach a line already down. If this one ever\n    moves the hash, the rule the whole interface is built on is false.'],
  ['activeLayer', s => { s.activeLayer.major = 'minor'; },
    'which bucket the NEXT mark lands in. A mark records its own layer.'],
  ['the current tool', s => { s.tool = 'vein'; },
    'a load disarms the brush to Move on purpose; that must not make it a different picture.'],
  ['the view', s => { s.view = 'floor'; },
    'stone or floor is what you are looking at, not what was drawn.'],
  ['folders', s => { s.folders = [{ name: 'veins', open: true }]; },
    'organising the layer list is housekeeping.'],
  ['guidesOn', s => { s.guidesOn = !s.guidesOn; },
    'guides are an editing aid. If this moved the hash they would be in the render, which would be a\n    defect in the RENDERER, not here.'],
];

console.log(PATH + '   baseline ' + BASE + '   (black light / daylight)');
let bad = 0;

console.log('\nMUST MOVE');
for (const [label, mutate] of mustMove) {
  const s = clone(); mutate(s);
  const moved = sig(s) !== BASE;
  if (!moved) bad++;
  console.log('  ' + (moved ? 'caught ' : 'MISSED ') + label);
}

console.log('\nMUST NOT MOVE');
for (const [label, mutate, why] of mustNot) {
  const s = clone(); mutate(s);
  const moved = sig(s) !== BASE;
  if (moved) bad++;
  console.log('  ' + (moved ? 'MOVED  ' : 'held   ') + label);
  if (moved) console.log('    ' + why);
}

// THE LIGHT, WHICH IS NOT IN THE SLAB. Found by ablating THIS SCRIPT rather than the app: deleting the
// light from the hash entirely left every case above GREEN, because all of them perturb the slab and
// the slab still moved the hash. Nothing asserted that two LIGHTS differ from each other - and that is
// the one distinction the published set rests on. It is fourteen masters of ONE stone, told apart only
// by the light they were written under. Collapse that and the two halves become a single signature.
console.log(NEWLINE + "THE LIGHT (one slab, six lights - no two may hash alike)");
const LIGHTS = [
  ['daylight', [0, false, false]],
  ['black light', [-1, true, false]],
  ['black light + spotlight', [-1, true, true]],
  ['daylight + spotlight', [0, false, true]],
  ['half a sweep of the spectrum', [0.5, false, false]],
  ['uv mode at spectrum 0', [0, true, false]],
];
const seen = new Map();
for (const [label, args] of LIGHTS) {
  const h = stateSig(base, args[0], args[1], args[2]);
  const twin = seen.get(h);
  if (twin) { bad++; console.log("  COLLIDES " + label + "   hashes as " + twin + " does (" + h + ")"); }
  else { seen.set(h, label); console.log("  distinct  " + label + "   " + h); }
}

console.log('\n' + (bad === 0
  ? 'moves on all ' + mustMove.length + ' picture changes, holds on all ' + mustNot.length + ' bookkeeping ones, tells ' + LIGHTS.length + ' lights apart'
  : bad + ' of ' + (mustMove.length + mustNot.length + LIGHTS.length) + ' wrong'));
process.exit(bad === 0 ? 0 : 1);
