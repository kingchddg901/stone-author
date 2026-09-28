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

const WINDOW = 4 << 20;                                  // the block sits in the IFD tail; head is a fallback
const RE = /\{"tool":"stone-author"[\s\S]*/;

export function findMeta(path) {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    for (const off of [Math.max(0, size - WINDOW), 0]) {
      const len = Math.min(WINDOW, size - off);
      const b = Buffer.alloc(len);
      readSync(fd, b, 0, len, off);
      const m = RE.exec(b.toString('latin1'));
      if (!m) continue;
      for (let cut = Math.min(m[0].length, 1 << 16); cut > 40; cut--) {   // the block is not delimited
        try { return JSON.parse(m[0].slice(0, cut)); } catch (_) {}
      }
    }
    return null;
  } finally { closeSync(fd); }
}
