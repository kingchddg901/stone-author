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
      // BRACE-MATCH THE END, do not guess it. This used to walk a cut DOWN from 64 KB and try to parse
      // each prefix, which silently failed on any block bigger than that - and `perTile` is ~9.2 bytes
      // per tile, so the cap was reached at about 6,950 tiles. A 65,535 px master at a 1024 tile has
      // 2,560 and reads fine; at a 512 tile it has 10,240, the block is 96,151 bytes, and the whole
      // file became invisible to the evidence pipeline. Nothing said so: findMeta just returned null,
      // which is indistinguishable from a file that carries no metadata at all.
      const text = m[0];
      let depth = 0, inStr = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inStr) { if (c === BACKSLASH) i++; else if (c === QUOTE) inStr = false; continue; }
        if (c === QUOTE) inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) { try { return JSON.parse(text.slice(0, i + 1)); } catch (_) { break; } }
        }
      }
    }
    return null;
  } finally { closeSync(fd); }
}
