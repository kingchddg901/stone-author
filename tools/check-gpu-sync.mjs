// THE APP'S COPY OF THE SHADER MUST BE THE ONE IN tools/lib.
//
// The exporter renders from a copy of glass-gpu.mjs and glass-real.mjs inlined into the app, because
// the app is a single HTML file and cannot import a module. Five probe pages verify the MODULE. If
// the two ever differ, every one of those probes goes on passing while the exporter draws something
// else - which is the worst shape a defect can have here, because the thing that would catch it is
// the thing that has been made blind.
//
// So: regenerate the block and compare. No tolerance, no normalising beyond line endings - a
// difference of any size means the copy was edited by hand or the module moved on without a sync.
//
//   node tools/check-gpu-sync.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generate, currentBlock, OPEN } from './sync-gpu.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NL = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + NL;
const src = readFileSync(join(ROOT, 'app', 'stone-author.html'), 'utf8').split(CRLF).join(NL);

const have = currentBlock(src);
if (have === null) {
  console.error('gpu-sync: the app has no GPU-SYNC block at all.');
  console.error('  The exporter cannot render on the GPU without it. Run: node tools/sync-gpu.mjs');
  process.exit(1);
}
const want = generate();
if (have === want) {
  console.log('gpu-sync: OK — the app’s shader and packer match tools/lib');
  process.exit(0);
}

// SAY WHERE, because "they differ" over six hundred lines is not actionable.
const a = have.split(NL), b = want.split(NL);
let i = 0;
while (i < a.length && i < b.length && a[i] === b[i]) i++;
console.error('gpu-sync: the app’s copy has DRIFTED from tools/lib.');
console.error('  app has    ' + a.length + ' lines, tools/lib generates ' + b.length);
console.error('  first difference at line ' + (i + 1) + ' of the block:');
console.error('    app:      ' + JSON.stringify((a[i] || '(end of block)').slice(0, 96)));
console.error('    tools/lib: ' + JSON.stringify((b[i] || '(end of block)').slice(0, 96)));
console.error('');
console.error('  tools/lib is the source. If the module is right:  node tools/sync-gpu.mjs');
console.error('  If the APP was edited by hand, that edit is not covered by any probe - move it');
console.error('  into tools/lib/ and sync, or it will be silently reverted by the next sync.');
process.exit(1);
