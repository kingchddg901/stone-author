// A concat list for ffmpeg that plays a frame sequence out and back, seamlessly.
//
// ffmpeg's `reverse` filter buffers the whole sequence in RAM — 3.3 GB for 120 frames at 4K — and is not
// needed: the concat demuxer will read the same files twice, in any order, at no cost. Both ends of the
// turn drop a frame (…118,119,120,119,118…) so nothing is held for two frames at the turn or at the loop
// point, which is what makes it play forever without a hitch.
//
//   node tools/make-loop-list.mjs 120 > loop.txt
//   ffmpeg -f concat -safe 0 -i loop.txt -r 24 -c:v libx264 -crf 16 -pix_fmt yuv420p out.mp4
//
// Forward only needs no list at all:
//   ffmpeg -framerate 24 -i f%03d.png -c:v libx264 -crf 16 -pix_fmt yuv420p out.mp4
const n = +(process.argv[2] || 120);
const fps = +(process.argv[3] || 24);
const pad = (i) => 'f' + String(i).padStart(3, '0') + '.png';
const out = [];
const put = (i) => out.push(`file '${pad(i)}'`, `duration ${(1 / fps).toFixed(7)}`);
for (let i = 1; i <= n; i++) put(i);
for (let i = n - 1; i >= 2; i--) put(i);
out.push(`file '${pad(2)}'`);                 // concat ignores the last duration; repeat the final file
process.stdout.write(out.join('\n') + '\n');
