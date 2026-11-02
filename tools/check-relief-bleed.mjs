// THE EMBOSS OFFSET BELONGS ON THE TRANSFORM, AND THE PICTURE LOOKS RIGHT EITHER WAY.
//
// The specular glint used to find its features by high-passing the picture - difference against a
// blur of itself - and that blur was the last thing on a daylight slab still asking for bleed: 6,292
// px of it at 1,048,576, where a forced 2048 tile becomes an 857 MB canvas that is 86% margin. The
// features were never a mystery; geo holds every one of them. So the glint is drawn from the
// geometry now, as an emboss: the coverage twice, once nudged toward the light and once away, so the
// near rim lights and the far rim darkens.
//
// WHERE THE NUDGE GOES IS THE WHOLE QUESTION, and it is invisible in the output.
//
//   tx.drawImage(scratch, dx, dy)    shifts the RENDERED PICTURE. It reads pixels from outside the
//                                    tile, so the tile has to carry them - 1,875 px at 1,048,576,
//                                    for a rim 23 px wide.
//   setTransform(..., e + dx, f + dy)  shifts the GEOMETRY. drawLayerArtifacts walks every feature in
//                                    the layer with no spatial culling and the canvas clips, so a
//                                    vein lying outside this tile still puts its rim inside it -
//                                    exactly why the drawn glow is owed no margin either.
//
// Both draw the same rim. One of them quietly costs a 7,396 px canvas instead of a 3,392 px one, and
// nothing in the picture says which you got. That is what this gate is for.
//
// It also holds the two things the stage is NOT allowed to forget: that `relief` defaults to 0, so
// every slab written before it renders byte for byte as it did (measured: BUILD 313 and BUILD 316
// with the token unset produce the same PNG hash), and that the fog is not drawn - haze in a stone
// does not reflect.
//
//   node tools/check-relief-bleed.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const APP = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'stone-author.html'), 'utf8');
let bad = 0;
const fail = (m) => { console.log('  FAIL  ' + m); bad++; };
const ok = (m) => console.log('  ok    ' + m);

const iF = APP.indexOf('function reliefGlint(');
if (iF < 0) { console.log('  FAIL  reliefGlint is gone'); process.exit(1); }
const iE = APP.indexOf('\n  function ', iF + 10);
const FN = APP.slice(iF, iE < 0 ? APP.length : iE);

// 1. THE NUDGE IS ON THE TRANSFORM.
if (!/setTransform\(C\.a, C\.b, C\.c, C\.d, C\.e \+ off \* Lx \* d, C\.f \+ off \* Ly \* d\)/.test(FN))
  fail('the coverage is not drawn through an OFFSET transform - the rim is a shifted picture, and the tile now owes bleed for what the shift reads');
else ok('the offset rides on setTransform, so the geometry moves and not the picture');

// 2. AND NOWHERE ELSE. Every composite of the scratch must be at the origin; an offset here is the
// same defect wearing the same output.
const draws = [...FN.matchAll(/drawImage\(ssC[^)]*\)/g)].map(m => m[0]);
if (!draws.length) fail('nothing composites the coverage - the stage draws no rim at all');
else {
  const shifted = draws.filter(d => !/drawImage\(ssC, 0, 0\)/.test(d));
  if (shifted.length) fail(`the coverage is composited at an offset (${shifted[0]}) - that reads outside the tile`);
  else ok(`all ${draws.length} composite(s) of the coverage sit at the origin`);
}

// 3. TWO WALKS, ONE PER SIDE. The sides are at different offsets, so one coverage cannot serve both -
// and the cheap "fix" is to draw it once and shift the other copy, which is defect 1 again.
if (!/for \(const side of \[0, 1\]\)/.test(FN))
  fail('the two rims are not drawn as two passes - one coverage cannot sit at two offsets');
else ok('two passes, one per side, each with its own transform');

// 4. THE FOG IS NOT DRAWN. His ruling, 2026-11-02: a haze in a stone does not reflect, so a glint
// drawn from geometry that cannot light the ground is correct rather than partial.
if (/drawLayerArtifacts\(L, '#fff', /.test(FN))
  fail("drawLayerArtifacts is passed withFog - haze in a stone does not reflect");
else if (!/drawLayerArtifacts\(L, '#fff'\)/.test(FN)) fail('the coverage is not drawn by drawLayerArtifacts');
else ok('the coverage is features only, no fog');

// 5. RELIEF IS OWED NO MARGIN, which is the consequence the whole stage exists for. coatReach must
// not grow a relief term: if one comes back, the offset has gone back onto a composite.
// THE EXPRESSION, NOT THE PROSE. The first spelling tested the whole function text for the word
// `relief` and went red on the COMMENT that explains why there is no relief term in it - a gate
// reporting on its own documentation. Scoped to the returned Math.max and stripped of comments.
const iR = APP.indexOf('function coatReach(');
const iRet = APP.indexOf('return Math.max(', iR);
const REACH = iR < 0 || iRet < 0 ? '' : APP.slice(iRet, APP.indexOf(';', iRet)).replace(/^\s*\/\/.*$/gm, '');
if (!REACH) fail('cannot find the coatReach return');
else if (/relief/i.test(REACH)) fail('coatReach counts a relief term again - the stage has started reading outside its canvas');
else ok('coatReach asks for no relief margin');

// 6. ONE PREDICATE, TWO READERS - the shape check-coat-field holds for the subsurface field. One
// reader decides the bleed, the other decides the route; a second copy of the expression is how a
// stage reads no neighbours while the bleed still pays for them, or the reverse.
const iC = APP.indexOf('function coatRadius(');
const RAD = APP.slice(iC, APP.indexOf('\n  }', iC));
if (!/!glintGeo\(\) && Math\.max\(G\.specular, surfaceGloss\(\)\) > 0/.test(RAD))
  fail('coatRadius does not drop the specular blur on glintGeo() - the bleed is paid for a blur that no longer runs, or run without the margin');
else ok('coatRadius drops the specular clause on the one predicate');
if (!/const geoG = glintGeo\(\);/.test(APP))
  fail('applyCoat does not ask glintGeo() - the two halves can disagree about which glint ran');
else ok('applyCoat takes the route from the same predicate');
if ((APP.match(/glintGeo = \(\) =>/g) || []).length !== 1)
  fail('glintGeo is declared more than once');
else ok('glintGeo is declared exactly once');

// 7. THE DEFAULT IS DEAD FLAT. A non-zero default would silently re-render every slab ever written.
if (!/\{ n: 'relief', min: -1, max: 1, step: 0\.05, def: 0 \}/.test(APP))
  fail("the relief token is not { min: -1, max: 1, def: 0 } - a non-zero default changes every existing slab");
else ok('relief is signed, and defaults to flat');
if (!/const reliefOf = L => adjOf\(null, L\.key, L\.bucket, 'relief', 0\);/.test(APP))
  fail('relief does not resolve through adjOf - it needs the artifact/layer/bucket ladder every other per-target property uses');
else ok('relief resolves through the adjustment ladder');

console.log(bad ? `\nrelief-bleed: ${bad} FAILURE(S)` : '\nrelief-bleed: OK');
process.exit(bad ? 1 : 0);
