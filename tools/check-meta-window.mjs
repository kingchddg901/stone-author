// THE BLOCK IS FOUND HOWEVER FAR BACK IT SITS. This exists because the same bug landed twice.
//
// First as a brace-match cap: findMeta walked a cut DOWN from 64 KB and parsed each prefix, so any
// block over that was invisible - reached at about 6,950 tiles, which a 65,535 master at a 512 tile
// passes. Fixed. The fix left a 4 MB READ window behind it, and on 2026-10-20 a 1,048,576 master at a
// 2048 pass wrote its block 4.20 MB from the end and missed by 7,512 bytes. Both times the symptom was
// the same and it is the dangerous one: findMeta returned null, which is indistinguishable from a file
// that carries no metadata at all. The sweep refuses what it cannot parse, so nothing was deleted -
// but nothing could be harvested either, and a 76-minute render read as empty.
//
// WHY A FIXED WINDOW IS ALWAYS WRONG HERE: perTile and the trace each carry one entry per PASS, so the
// block grows with the pass count and any constant is an unstated pass-count ceiling. 163,840 passes
// crossed 4 MB. A 1024 pass at the same width would be 655,360.
//
// So the claim is behavioural, not a constant: a block placed well beyond one window must still be
// read. ABLATE by restoring a single-window scan in locateMeta - case B must go red.
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findMeta } from './lib/find-meta.mjs';

let failed = 0;
const claim = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + what + (ok ? '' : '   got ' + JSON.stringify(got)));
};

const dir = mkdtempSync(join(tmpdir(), 'meta-window-'));
try {
  // A MASTER IS NOT A BLOCK AT THE END. There is image data before it and TIFF structure after it, and
  // it is the trailing structure that pushed the real file past the window - the block itself started
  // 4.20 MB from the end while being only 1.58 MB long.
  const block = o => Buffer.from(JSON.stringify(o), 'latin1');
  const make = (name, before, meta, after) => {
    const p = join(dir, name);
    writeFileSync(p, Buffer.concat([Buffer.alloc(before, 0x49), block(meta), Buffer.alloc(after, 0x00)]));
    return p;
  };
  const META = { tool: 'stone-author', w: 1048576, renders: 163840, workers: 8, ms: { render: 4573000 } };
  const MB = 1 << 20;

  console.log('\nA  a block inside the first window');
  {
    const p = make('near.tif', 2 * MB, META, 1 * MB);
    const m = findMeta(p);
    claim('it is read', m && m.w, 1048576);
    claim('and every field survives the scan', m && m.renders, 163840);
  }

  console.log('\nB  a block PAST one window, which is what shipped broken');
  {
    // 5 MB of trailing structure puts the block beyond a 4 MB tail read, the way the real master did.
    const p = make('far.tif', 8 * MB, META, 5 * MB);
    const m = findMeta(p);
    claim('it is still read', m && m.w, 1048576);
    claim('and the pass count is intact', m && m.renders, 163840);
    claim('and so is the width the pool ran at', m && m.workers, 8);
  }

  console.log('\nC  far enough back to need several steps, and out of the head fallback');
  {
    // THE LEADING FILLER IS LOAD-BEARING. At 2 MB this case passed the ablation - the tail scan missed
    // it and the HEAD window picked it up at offset 2 MB, so the claim went green without the backward
    // walk running at all. Past 4 MB the head cannot reach it either, and only the walk can answer.
    const p = make('further.tif', 8 * MB, META, 26 * MB);
    const m = findMeta(p);
    claim('the scan keeps walking back until it finds it', m && m.renders, 163840);
    claim('and it is beyond the head fallback, so only the walk could have', 8 * MB > (4 << 20), true);
  }

  console.log('\nD  and a file with no block is still NULL, not a false positive');
  {
    const p = join(dir, 'none.tif');
    writeFileSync(p, Buffer.alloc(6 * MB, 0x49));
    claim('nothing is invented', findMeta(p), null);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('');
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('meta-window: OK — the block is found however far back it sits');
