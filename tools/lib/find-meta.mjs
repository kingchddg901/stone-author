// THE ONE READER OF A MASTER'S SELF-DESCRIPTION. Every TIFF and PNG the studio writes carries a JSON
// block describing the render that made it, and this finds it without decoding a pixel. It works on a
// .tif or on the .zip an artifact runtime wraps one in, because the block is found by SCANNING rather
// than by parsing a container.
//
// It lives here rather than in tiff-meta.mjs because two tools need it now — tiff-meta prints it for a
// human, meta-index writes it as published evidence — and importing a script would have run that
// script's main. One parser, two consumers: a second reader would be a second answer to the same
// question, and the two would drift.
import { openSync, readSync, closeSync, statSync } from 'fs';

const QUOTE = String.fromCharCode(34), BACKSLASH = String.fromCharCode(92);
const WINDOW = 4 << 20;                                  // one read step, and the head fallback window
const TAIL_MAX = 1 << 30;                                // how far back from the end the marker may sit
const RE = /\{"tool":"stone-author"[\s\S]*/;

// findMeta answers WHAT the block says. locateMeta also answers WHERE it is, which is what a
// byte comparison of two masters needs: everything before `start` is image data, and everything from
// `start` on is the self-description, which MUST differ between two renders (it carries `at`,
// `ms.render` and 10,240 per-tile timings). Two functions, ONE scanner - the header above is explicit
// that a second reader would be a second answer to the same question and the two would drift.
export function findMeta(path) {
  const loc = locateMeta(path);
  return loc ? loc.meta : null;
}

// Returns { meta, start, end } with absolute byte offsets, or null. Offsets are exact because the
// window is decoded as latin1, which is one byte per code unit, so a string index IS a byte offset.
export function locateMeta(path) {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    // THE SAME BUG TWICE, ONE LAYER APART. The note below records a 64 KB brace-match cap that made
    // large blocks invisible; fixing it left a fixed 4 MB READ window behind it, and on 2026-10-20 a
    // 1,048,576 master at a 2048 pass wrote a 4.20 MB block and missed that window by 7,512 BYTES. The
    // file read as carrying no metadata at all - the exact indistinguishability the note warns about.
    //
    // The block grows with the PASS COUNT, because perTile and the trace both carry one entry per pass,
    // so any fixed window is a pass-count ceiling nobody states. 163,840 passes crossed this one; the
    // next tile size down would be 655,360. So the tail scan now WALKS BACK until it finds the marker
    // instead of looking once: bounded memory per step, bounded total by TAIL_MAX, and no ceiling that
    // arrives silently.
    const starts = [];
    {
      const MARK = Buffer.from('{' + QUOTE + 'tool' + QUOTE + ':' + QUOTE + 'stone-author' + QUOTE, 'latin1');
      const OVERLAP = MARK.length + 8;                   // so a marker split across two steps is still seen
      for (let end = size; end > 0 && size - end < TAIL_MAX;) {
        const from = Math.max(0, end - WINDOW);
        const b = Buffer.alloc(end - from);
        readSync(fd, b, 0, b.length, from);
        const i = b.lastIndexOf(MARK);
        if (i >= 0) { starts.push(from + i); break; }
        if (from === 0) break;
        end = from + OVERLAP;
      }
    }
    starts.push(0);                                      // head is still the fallback, for PNG
    for (const off of starts) {
      const len = Math.min(off === 0 ? WINDOW : size - off, size - off);
      const b = Buffer.alloc(len);
      readSync(fd, b, 0, len, off);
      const m = RE.exec(b.toString('latin1'));
      if (!m) continue;
      // BRACE-MATCH THE END, do not guess it. This used to walk a cut DOWN from 64 KB and try to parse
      // each prefix, which silently failed on any block bigger than that - and `perTile` is ~9.2 bytes
      // per tile, so the cap was reached at about 6,950 tiles. A 65,535 px master at a 1024 tile has
      // 2,560 and reads fine; at a 512 tile it has 10,240, the block is 96,151 bytes, and the whole
      // file became invisible to the evidence pipeline. Nothing said so: findMeta just returned null,
      // which is indistinguishable from a file that carries no metadata at all.
      const text = m[0];
      const absStart = off + m.index;
      let depth = 0, inStr = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inStr) { if (c === BACKSLASH) i++; else if (c === QUOTE) inStr = false; continue; }
        if (c === QUOTE) inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            try {
              const meta = JSON.parse(text.slice(0, i + 1));
              return { meta, start: absStart, end: absStart + i + 1 };
            } catch (_) { break; }
          }
        }
      }
    }
    return null;
  } finally { closeSync(fd); }
}
