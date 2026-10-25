// A WORKER THREAD THAT TURNS FOUR SOURCE TILES INTO ONE REDUCED TILE.
//
// Measured on the terapixel master, one output tile costs 222 ms: four reads and inflates at 13.3 ms
// each, four reductions at 25.2 ms each, one deflate at 68.1 ms. None of it touches the file's
// structure and the tiles are independent, so the only serial part left is the write - which the main
// thread does, in index order, through runPool.
//
// IT READS THE FILE ITSELF rather than being handed pixels: the four source tiles are ~800 KB
// compressed and ~50 MB inflated, so posting them in would cost more than the read does.
//
// THE GENERATION NUMBER IS THE LEVEL. Level L+1 reads tiles the main thread wrote while building
// level L, so a read handle opened before those writes is a handle onto a shorter file. Rather than
// reason about when a second descriptor sees an append, each task carries the level it belongs to and
// the worker reopens whenever that changes - one open per level per worker, against 54,617 tiles.
import { parentPort, workerData } from 'worker_threads';
import { openSync, readSync, closeSync } from 'fs';
import { loadReducer } from './pyramid.mjs';
import { tileFromQuads } from './pyramid-tile.mjs';

const { path, TW, SPP } = workerData;
const reduce2 = loadReducer();
let fd = null, gen = -1;

parentPort.on('message', m => {
  if (m.bye) { if (fd !== null) closeSync(fd); process.exit(0); }
  try {
    if (m.gen !== gen) {
      if (fd !== null) closeSync(fd);
      fd = openSync(path, 'r');
      gen = m.gen;
    }
    const quads = m.quads.map(q => {
      if (!q) return null;
      const b = Buffer.alloc(q.cnt);
      readSync(fd, b, 0, q.cnt, q.off);
      return b;
    });
    const z = tileFromQuads(quads, TW, SPP, reduce2);
    const ab = z.buffer.slice(z.byteOffset, z.byteOffset + z.length);
    parentPort.postMessage({ i: m.i, z: ab }, [ab]);
  } catch (e) {
    parentPort.postMessage({ i: m.i, err: String((e && e.stack) || e) });
  }
});
