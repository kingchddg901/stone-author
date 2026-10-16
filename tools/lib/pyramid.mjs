// THE OVERVIEW REDUCER, LIFTED OUT OF THE APP BY TEXT.
//
// A retrofitted master and a freshly-built one must agree byte for byte, or the two paths have forked
// and `check-same-image` will say so about files that are supposed to be the same picture. So the tool
// that adds levels to an existing file runs the SAME function the app would have run, pulled from
// `app/stone-author.html` rather than reimplemented here.
//
// This repo has been bitten by that shape twice in one day: the export and the resume verification each
// preparing their own tile pixels, which refused every resume; and a cache key naming its inputs by
// hand, twice, which showed stale labels. One definition, lifted, is the answer that has held.
import { readFileSync } from 'fs';

export function loadReducer(appPath = new URL('../../app/stone-author.html', import.meta.url)) {
  const SRC = readFileSync(appPath, 'utf8');
  const needle = 'function reduce2(';
  const hits = [];
  for (let k = SRC.indexOf(needle); k >= 0; k = SRC.indexOf(needle, k + 1)) hits.push(k);
  if (!hits.length) throw new Error('cannot find reduce2 in the app - this tool is stale');
  if (hits.length > 1) throw new Error('reduce2 is defined ' + hits.length + ' times in the app');
  let i = SRC.indexOf('{', hits[0]), d = 0;
  for (;; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}' && --d === 0) break; }
  return new Function(SRC.slice(hits[0], i + 1) + '\nreturn reduce2;')();
}

// HOW MANY LEVELS, AND HOW BIG. Halve until the long edge fits a screen; a level smaller than one tile
// is not worth an IFD. Returned largest first, the order they are written in.
export function levels(W, H, tile, stopAt = 2048) {
  const out = [];
  let w = W, h = H;
  while (w > stopAt && w > tile && h > 1) {
    w = Math.ceil(w / 2); h = Math.ceil(h / 2);
    out.push({ w, h, across: Math.ceil(w / tile), down: Math.ceil(h / tile) });
  }
  return out;
}
