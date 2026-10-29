// THE PREVIEW'S SHADER FACE: IS IT STILL THE FACE OF THIS FRAME?
//
// The preview blits a canvas the GPU filled. Everything that can go wrong with that is silent - the
// picture is simply a picture of something else, with no throw, no console line and nothing on
// screen to say so. Three ways it goes wrong, and one of them has already happened here:
//
//   1  THE GENERATION STOPS COUNTING. Every control reaches the face through redraw, which counts a
//      generation so a face made before an edit cannot be served after it. The harness hook had its
//      own entry that did NOT count, and a haze-removal ablation then measured mean 54.8 against a
//      face that still had the haze in it. The number looked exactly like a finding.
//   2  THE TWO SITES IN draw() DRIFT APART. The face replaces the backdrop AND the content, so both
//      have to read one answer. A backdrop that forgets it paints a CPU ground under a shader face;
//      a content site that forgets paints the veins twice.
//   3  THE SIZE CHECK GOES. The ResizeObserver calls size() and draw() without redraw, so the only
//      thing standing between a resize and a putImageData at the wrong size is prevFace's own
//      comparison of the face's dimensions against the canvas's.
//
// A source check, like check-material-fork: a tripwire against the accidental removal, not a proof.
// Every assertion below has been ablated - deleted from the app, and this gate run to watch it go
// red - which is the only thing that makes a passing line mean anything.
//
//   node tools/check-preview-face.mjs
import { readFileSync } from 'fs';

const NL = String.fromCharCode(10);
let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('  ok    ' + name); return; }
  fails++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

const app = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../harness/inject.mjs', import.meta.url), 'utf8');

// THE BODY OF A NAMED FUNCTION, by brace matching from its own declaration. Reading the whole file
// would let a match in some other function satisfy a claim about this one, which is the mistake a
// bare grep makes and the reason the extraction is here at all.
function bodyOf(src, decl) {
  const i = src.indexOf(decl);
  if (i < 0) return null;
  const open = src.indexOf('{', i);
  if (open < 0) return null;
  let d = 0;
  for (let p = open; p < src.length; p++) {
    const c = src[p];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) return src.slice(open + 1, p); }
  }
  return null;
}

const draw = bodyOf(app, 'function draw() {');
const redraw = bodyOf(app, 'function redraw(rebuild) {');
const face = bodyOf(app, 'function prevFace() {');
const fill = bodyOf(app, 'function prevFill() {');
const why = bodyOf(app, 'function prevWhyNot() {');
ok('the five functions are all findable', draw && redraw && face && fill && why,
   [['draw', draw], ['redraw', redraw], ['prevFace', face], ['prevFill', fill], ['prevWhyNot', why]]
     .filter(([, v]) => !v).map(([k]) => k).join(' '));
if (!draw || !redraw || !face || !fill || !why) { console.log(NL + 'check-preview-face: FAILED'); process.exit(1); }

// ---- 1  the generation counts, and it counts before the early return -------------------------
const bump = redraw.indexOf('prevGen++');
const early = redraw.indexOf('if (queued) return;');
ok('redraw counts a generation', bump >= 0);
ok('and counts it BEFORE the early return', bump >= 0 && early >= 0 && bump < early,
   'a change arriving while a frame is already queued must move the generation too');
// THE ARROW'S OWN BODY, not the file. The first version of this matched anywhere in inject.mjs and
// passed on the COMMENT that explains why the count is there - delete the count, keep the comment,
// still green. Found by ablating it, which is the only way a dead assertion is ever found.
ok('the harness render entry counts one as well',
   /render: \(\) => \{[^}]*prevGen\+\+[^}]*\}/.test(hook),
   'harness/inject.mjs render() bypasses redraw, so without this a gate mutates and is served the old face');

// ---- 2  draw() reads ONE answer and both sites use it ----------------------------------------
const reads = (draw.match(/prevFace\(\)/g) || []).length;
ok('draw() asks for the face exactly once', reads === 1, 'found ' + reads);
ok('and binds it to `face`', /const face = prevFace\(\);/.test(draw));
ok('the backdrop has a face branch, first', /if \(face\) ctx\.putImageData\(face, 0, 0\);/.test(draw));
// EVERY content call in draw() must sit behind the guard. Checked per line rather than per call, so
// a new painter added on its own line is caught rather than assumed.
const contentLines = draw.split(NL).filter(l => /paintContent\(|paintBacklit\(/.test(l));
ok('draw() still paints content somewhere', contentLines.length > 0);
const guarded = contentLines.every(l => /if \(!face\)/.test(l));
ok('every content call in draw() is behind `if (!face)`', guarded,
   contentLines.filter(l => !/if \(!face\)/.test(l)).map(l => l.trim()).join(' | '));

// ---- 3  the face is only used for the frame it belongs to ------------------------------------
ok('prevFace compares the key', /prevHave\.key !== prevWant/.test(face));
ok('prevFace compares the width', /prevHave\.img\.width !== cv\.width/.test(face));
ok('prevFace compares the height', /prevHave\.img\.height !== cv\.height/.test(face));

// ---- 4  a refusal clears the face rather than leaving it to be blitted ------------------------
ok('prevFill drops the face when the path refuses',
   /if \(prevWhyNot\(\)\) \{ prevWant = ''; prevHave = null; return null; \}/.test(fill));
ok('and drops it again when a render fails', /prevWant = ''; prevHave = null;/.test(fill.slice(fill.indexOf('catch'))),
   'a failed render must not leave the previous face current');

// ---- 5  every reason the preview can give has a string ---------------------------------------
// The keys are read out of prevWhyNot itself, so a clause added with a key nobody translated is
// caught here rather than showing the person a raw dotted token beside the switch.
// prevFill carries one of its own - the key a failed render falls back to - so both are read.
const keys = [...(why + fill).matchAll(/'(exp\.gpu\.[a-z.]+)'/g)].map(m => m[1]);
ok('prevWhyNot names at least one reason', keys.length > 0);
for (const k of keys) {
  ok('"' + k + '" has an English string', app.includes('"' + k + '":'));
}
// AND THE ROW BESIDE THE SWITCH SHOWS THEM. A refusal nobody can read is the state-and-behaviour
// disagreement the whole toggle exists to avoid.
const note = bodyOf(app, 'function prevNote() {');
ok('prevNote exists and reads prevWhyNot', !!note && /prevWhyNot\(\)/.test(note));
ok('and is called once a frame from stat()', /prevNote\(\);/.test(bodyOf(app, 'function stat() {') || ''));

console.log(NL + 'check-preview-face: ' + (fails ? 'FAILED ' + fails : 'all clear'));
process.exit(fails ? 1 : 0);
