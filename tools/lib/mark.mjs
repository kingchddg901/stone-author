// THE POSITIONAL MARK FORMAT, LIFTED OUT OF THE APP BY TEXT.
//
// Every tool that reads a mark runs the SAME functions that wrote it, pulled from
// `app/stone-author.html` rather than reimplemented here. A reader that agreed with a COPY of the
// writer would prove the copy and nothing else.
//
// This module exists because that lift was pasted into two tools and broke twice in one week, in
// opposite directions. Too NARROW first: it took only the `const MARK_CELL = ...` line, so MARK_MAGIC
// never arrived and the first stamp threw a ReferenceError. Too BROAD second: `const MARK_ON = (() =>`
// is also a `const MARK_` line, so sweeping them all handed `new Function` an unbalanced fragment and
// it died on end-of-input. A third tool wanting the same lift was the point to stop copying it.
import { readFileSync } from 'fs';

const NAMES = ['markPack', 'markUnpack', 'markStamp', 'markRead'];

export function loadMark(appPath = new URL('../../app/stone-author.html', import.meta.url)) {
  const SRC = readFileSync(appPath, 'utf8');
  const lift = name => {
    const needle = 'function ' + name + '(';
    const hits = [];
    for (let k = SRC.indexOf(needle); k >= 0; k = SRC.indexOf(needle, k + 1)) hits.push(k);
    if (!hits.length) throw new Error('cannot find ' + name + ' in the app - this tool is stale');
    if (hits.length > 1) throw new Error(name + ' is defined ' + hits.length + ' times in the app');
    let i = SRC.indexOf('{', hits[0]), d = 0;
    for (;; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}' && --d === 0) break; }
    return SRC.slice(hits[0], i + 1);
  };
  // Every `const MARK_` line EXCEPT the URL flag, which is an arrow IIFE and not a constant.
  const consts = (SRC.match(/^\s*const MARK_[^\n]*$/gm) || []).filter(l => l.indexOf('=>') < 0);
  if (!consts.length) throw new Error('cannot find the MARK_ constants in the app - this tool is stale');
  return new Function(consts.join('\n') + '\n' + NAMES.map(lift).join('\n') +
    '\nreturn { ' + NAMES.join(', ') +
    ', MARK_CELL, MARK_BITS, MARK_COPIES, MARK_VER, MARK_MAGIC };')();
}

// How many pixels of a cell's bottom row the mark occupies, counting leftwards from its right edge.
export const markSpan = m => m.MARK_BITS * m.MARK_COPIES;

// Does an absolute picture pixel sit under a mark? The lattice is anchored to the PICTURE, so this
// needs no tile size and gives the same answer whatever the tiling.
export function onMark(m, x, y) {
  if (y % m.MARK_CELL !== m.MARK_CELL - 1) return false;
  const right = (((x / m.MARK_CELL) | 0) + 1) * m.MARK_CELL - 1;
  return right - x < markSpan(m);
}
