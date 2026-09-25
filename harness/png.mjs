// A minimal PNG writer, so the harness can save an image without a browser or a dependency.
//
// The engine gate used to build its difference image inside the page — an Image decode, a second canvas and
// a toDataURL, on top of a render the engine had just finished. WebKit took longer than 45 seconds over it
// and Chromium lost its execution context mid-call. Node has zlib, and a PNG is a signature plus three
// chunks, so the arithmetic belongs here where it costs nothing and can be tested without a browser.
import { deflateSync } from 'zlib';

const TAB = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TAB[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// rgba: w*h*4 bytes, row-major. Every scanline is written with filter type 0 (None) — the app's own streamed
// encoder does the same, and a reader that ignores the filter byte reads garbage either way.
export function encodePNG(w, h, rgba) {
  if (rgba.length !== w * h * 4) throw new Error(`expected ${w * h * 4} bytes for ${w}x${h}, got ${rgba.length}`);
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer || rgba, (rgba.byteOffset || 0) + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;                                  // 8 bits per channel, RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
