// ONE HWiNFO LOG, MANY RENDERS - cut it by what the masters say, not by what the log looks like.
//
// A log left running collects several renders, the idle between them, and whatever else the machine
// was doing. Reading it as one span averages a render against itself; reading it by CPU alone cannot
// tell a render from a download. The masters know exactly when they ran - `at` is the finish in UTC
// and `ms.render` is the duration - so the cut comes from them and the log is only asked what the
// hardware was doing between those two instants.
//
// AND IT FLAGS WHAT ELSE WAS HAPPENING, which is the part that keeps being needed. Three runs on
// 2026-10-21/22 each carried a different confound - a desk in use, a video, and 5.67 GB of downloads
// arriving mid-render - and each was found by hand, after the fact, by noticing a figure that did not
// fit. A render writes its master at a rate its own metadata predicts (bytes / duration). Sustained
// writing well above that is somebody else's, and the log can say so without being told.
//
// THE IDLE IS A MEASUREMENT TOO. Six hours of it on 2026-10-22 put this machine's true floor at 0.57
// threads of 12 - against the 1.49 and 1.04 that ten- and thirty-minute windows beside two renders
// had suggested, which had been subtracted from both and understated every per-worker figure.
//
//   node tools/split-hwinfo.mjs <log.csv>              what is in it, and what else was running
//   node tools/split-hwinfo.mjs <log.csv> --write <dir>  also emit one CSV per render
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
const FILE = args.find(a => !a.startsWith('--'));
const OUT = (() => { const i = args.indexOf('--write'); return i >= 0 ? args[i + 1] : null; })();
if (!FILE) { console.error('usage: split-hwinfo.mjs <log.csv> [--write <dir>]'); process.exit(1); }

const META = new URL('../.claude/master-meta/', import.meta.url);

// HWiNFO stamps LOCAL time. The offset is DERIVED from the masters - a filename carries the local
// finish and `at` the same instant in UTC - rather than assumed from a zone name, because the rule
// changes twice a year and the data does not.
function deriveOffset(masters) {
  const votes = {};
  for (const m of masters) {
    const g = m.file.match(/-(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/);
    if (!g) continue;
    const d = new Date(m.end);
    const loc = Date.UTC(d.getUTCFullYear(), +g[1] - 1, +g[2], +g[3], +g[4], +g[5]);
    const h = Math.round((m.end - loc) / 3600000);
    votes[h] = (votes[h] || 0) + 1;
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return best ? { hours: +best[0], agree: best[1], total: Object.values(votes).reduce((a, b) => a + b, 0) } : null;
}

const masters = [];
for (const f of readdirSync(META)) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  let o; try { o = JSON.parse(readFileSync(new URL(f, META), 'utf8')); } catch (_) { continue; }
  if (!o.at || !o.ms || !o.ms.render) continue;
  const end = Date.parse(o.at);
  masters.push({ file: f, name: f.replace(/\.json$/, ''), o, end, start: end - o.ms.render });
}
const off = deriveOffset(masters);
if (!off) { console.error('cannot derive the local offset from any master'); process.exit(1); }
const OFFMS = off.hours * 3600000;

const lines = readFileSync(FILE, 'latin1').split(/\r?\n/);
const header = lines[0];
const hdr = header.split(',').map(s => s.replace(/^"|"$/g, ''));
const I = re => hdr.findIndex(h => re.test(h));
const C = {
  cpu: I(/^Total CPU Usage/), free: I(/^Physical Memory Available/), load: I(/^Physical Memory Load/),
  pf: I(/^Page File Used/), wr: I(/^Write Rate/), rd: I(/^Read Rate/), act: I(/^Total Activity/),
  temp: I(/^Core Temperatures \(avg\)/), pw: I(/^CPU Package Power/),
};
const THREADS = [];
for (let c = 0; c < 6; c++) for (const t of ['T0', 'T1']) {
  const i = hdr.findIndex(h => h === 'Core ' + c + ' ' + t + ' Usage [%]');
  if (i >= 0) THREADS.push(i);
}
const stamp = s => {
  const m = s.match(/^(\d+)\.(\d+)\.(\d+),(\d+):(\d+):(\d+)\.(\d+)/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6], +m[7]) + OFFMS : null;
};
const rows = [];
for (const l of lines) if (/^\d+\.\d+\.\d+,/.test(l)) { const t = stamp(l); if (t !== null) rows.push({ l, c: l.split(','), t }); }
if (!rows.length) { console.error('no timestamped rows in ' + FILE); process.exit(1); }

const num = (r, i) => { const v = parseFloat((r.c[i] || '').replace(/"/g, '')); return isNaN(v) ? null : v; };
const mean = (set, i) => { let s = 0, n = 0; for (const r of set) { const v = num(r, i); if (v !== null) { s += v; n++; } } return n ? s / n : null; };
const fx = (v, d) => v === null ? '   -' : v.toFixed(d);
const threadsOf = set => { let s = 0; for (const i of THREADS) { const m = mean(set, i); if (m !== null) s += m; } return s / 100; };

const t0 = rows[0].t, t1 = rows[rows.length - 1].t;
const hit = masters.filter(m => m.start < t1 && m.end > t0).sort((a, b) => a.start - b.start);
const hhmm = t => new Date(t - OFFMS).toISOString().slice(11, 19);

console.log('');
console.log('  ' + FILE.replace(/.*[\\/]/, ''));
console.log('  ' + rows.length.toLocaleString() + ' samples, ' + ((t1 - t0) / 3600000).toFixed(1) + ' h, '
  + hhmm(t0) + ' -> ' + hhmm(t1) + ' local   (offset UTC' + (off.hours >= 0 ? '-' : '+') + Math.abs(off.hours)
  + ', ' + off.agree + '/' + off.total + ' masters agree)');
console.log('  ' + hit.length + ' render' + (hit.length === 1 ? '' : 's') + ' in this window');

// ---- the idle floor, from everything no render was using ----------------------------------------
const inAny = r => hit.some(m => r.t >= m.start - 60000 && r.t <= m.end + 300000);
const idle = rows.filter(r => !inAny(r));
// OUTSIDE A RENDER IS NOT THE SAME AS IDLE, and on this machine the gap reached 8 threads of 12.
// A render that is KILLED writes no master, so nothing marks its hours as a render and every one of
// its samples lands in this set. On 2026-10-23 a 1,048,576 glass render was killed after seven hours
// of an 8.2 h log; the floor came out at 8.336 threads, that figure was then taken off both of the
// real renders in the window, and one of them was reported as using -0.03 threads. A render cannot
// use fewer threads than the floor it runs above, so a non-positive "render alone" is never a quiet
// machine - it is this.
//
// The floor is therefore the QUIET DECILE of these samples rather than their mean, and both are
// printed. A mean well above the decile means this window holds work no master accounts for, and
// then nothing is subtracted at all: a missing figure costs one reading, a wrong one silently
// corrupts every per-worker number taken from it, which is what happened above.
const occOf = r => { let s = 0; for (const i of THREADS) { const v = num(r, i); if (v !== null) s += v; } return s / 100; };
const pctl = (v, p) => { const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]; };
let FLOOR = null;
if (idle.length > 300) {
  const occ = idle.map(occOf);
  const quiet = pctl(occ, 10), mid = pctl(occ, 50), avg = threadsOf(idle);
  const over = occ.filter(x => x > quiet + 1).length / occ.length;
  // TWO WAYS FOR THIS WINDOW NOT TO BE IDLE, and the shape test only catches one. A killed render
  // that stopped partway leaves a BIMODAL window - busy, then quiet - and its mean sits well above
  // its quiet decile, which is the test below. A log that was started for one long render and
  // stopped with it leaves a window that is busy THROUGHOUT, and there the decile is as high as the
  // mean and the shape test passes it: "1m res stress test.CSV" reported a floor of 8.457 threads
  // of 12 that way. So the decile is also held to an absolute bound, because an idle desktop does
  // not keep a quarter of its threads busy - if it does, something is running that this log cannot
  // name, and that is the same refusal for a different reason.
  const tooHigh = quiet > THREADS.length / 4;
  console.log('');
  console.log('  OUTSIDE EVERY RENDER, from ' + idle.length.toLocaleString() + ' samples ('
    + (idle.length * 2 / 3600).toFixed(1) + ' h)');
  console.log('    quiet decile ' + quiet.toFixed(3) + '   median ' + mid.toFixed(3) + '   mean '
    + avg.toFixed(3) + ' threads of ' + THREADS.length);
  console.log('    ' + fx(mean(idle, C.cpu), 2) + '% cpu   ' + fx(mean(idle, C.free), 0)
    + ' MB free   ' + fx(mean(idle, C.pf), 0) + ' MB page file');
  if (avg > quiet + 1 || tooHigh) {
    if (tooHigh) {
      console.log('    NOT IDLE - the quiet decile is itself ' + quiet.toFixed(3) + ' of ' + THREADS.length
        + ' threads, which is a load and');
      console.log('    not a floor. This window is busy throughout, so no part of it measures an idle machine.');
    } else {
      console.log('    NOT IDLE - ' + (100 * over).toFixed(0) + '% of this window sits more than a thread above');
      console.log('    its own quiet decile, so it holds work no master in this log accounts for. A killed or');
      console.log('    unsaved render is the usual cause.');
    }
    console.log('    Nothing is subtracted below, and no per-worker figure is offered.');
  } else {
    FLOOR = quiet;
    console.log('    IDLE FLOOR ' + quiet.toFixed(3) + ' threads, subtracted below. Take it from a window this');
    console.log('    long, never from ten minutes beside one render: such a baseline taken while the desk was');
    console.log('    in use read 1.49 threads against a true floor of 0.57, on this machine.');
  }
}

// ---- each render --------------------------------------------------------------------------------
for (const m of hit) {
  const win = rows.filter(r => r.t >= m.start && r.t <= m.end);
  if (!win.length) continue;
  const o = m.o, px = o.w * (+o.h || Math.round(o.w * 0.625));
  const v = o.trace && (o.trace.busy || o.trace.v);
  const busy = v && v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  const thr = threadsOf(win);
  console.log('');
  console.log('  ' + m.name);
  console.log('    ' + hhmm(m.start) + ' -> ' + hhmm(m.end) + ' local   ' + (o.ms.render / 60000).toFixed(1)
    + ' min   ' + win.length.toLocaleString() + ' samples');
  console.log('    pass ' + o.render + '   workers ' + (o.workers === undefined ? 'absent' : o.workers)
    + (busy !== null ? '   busy ' + busy.toFixed(2) : '') + '   ' + (px / (o.ms.render / 1000) / 1e6).toFixed(1) + ' Mpx/s');
  console.log('    cpu ' + fx(mean(win, C.cpu), 1) + '%   threads ' + thr.toFixed(2) + ' of ' + THREADS.length
    + (FLOOR !== null && busy
      ? (thr - FLOOR > 0
        ? '   render alone ' + (thr - FLOOR).toFixed(2) + ' = ' + ((thr - FLOOR) / busy).toFixed(2) + ' per busy worker'
        : '   render alone ' + (thr - FLOOR).toFixed(2) + ' - IMPOSSIBLE, the floor sits above this render')
      : ''));
  console.log('    memory ' + fx(mean(win, C.load), 0) + '%, ' + fx(mean(win, C.free), 0) + ' MB free'
    + '   page file ' + fx(mean(win, C.pf), 0) + ' MB   ' + fx(mean(win, C.temp), 1) + ' C   ' + fx(mean(win, C.pw), 1) + ' W');

  // FOREIGN I/O. A render writes its own master at a rate its metadata predicts. Sustained writing
  // far above that belongs to something else, and that something else is what makes a comparison
  // between two runs invalid without anybody noticing.
  // WHOSE BYTES ARE IN o.bytes. On every path but one it is the compressed payload, so it predicts the
  // disk. On the STREAMED path it is the count of uncompressed scanline bytes fed to the encoder - the
  // write-completeness check - which runs about 6x the real file. Predicting disk from it would hand
  // this check an 11 GB allowance on a 65535 master and the check would never fire again. The formula
  // is the signature (w*h*4 + h, to the byte), so a master that lost the flag is caught too. See
  // docs/master-size.md.
  const RH = +o.h || Math.round(o.w * 0.625);
  const inputBytes = !!o.streamed || o.bytes === o.w * RH * 4 + RH;
  if (o.bytes && C.wr >= 0 && inputBytes) {
    let total = 0;
    const dt = rows.length > 1 ? (rows[1].t - rows[0].t) / 1000 : 2;
    for (const r of win) { const w = num(r, C.wr); if (w !== null) total += w * dt / 1024; }
    console.log('    disk: ' + total.toFixed(1) + ' GB written — ' + fx(mean(win, C.wr), 1)
      + ' MB/s mean, ' + fx(mean(win, C.act), 1) + '% busy');
    console.log('    streamed master: its `bytes` is encoder INPUT, not file size, so nothing here can');
    console.log('    say what share of those GB was this render. Foreign I/O is UNCHECKED here, not absent.');
  } else if (o.bytes && C.wr >= 0) {
    const own = o.bytes / (o.ms.render / 1000) / 1e6;      // MB/s this render accounts for
    // A RATE THRESHOLD CANNOT DO THIS. The render's own writing is bursty - a quiet 8-worker run had a
    // 5.4 MB/s mean, a 12.0 p95 and a 91 MB/s PEAK - so any trip low enough to catch a download also
    // catches the renderer flushing tiles, and 5.67 GB of zips read as 17.7 GB of "foreign".
    //
    // Integrate instead. Total bytes across the window is measured, the master's size is measured, and
    // the difference is whatever else used the disk. The one adjustment is that a render writes a
    // little more than its master - about 12% on the one run where both were counted - so that is
    // allowed for before anything is called foreign.
    const OVERHEAD = 1.15;
    const TRIP = Math.max(own * 4, 20);
    // COUNT THE EXCESS ON THE FLAGGED SAMPLES ONLY. A mean-based estimate attributes every byte above
    // `own` to somebody else, including the render's own bursts - which are real: this writer's p95 is
    // three times its mean. That over-read a 5.67 GB download burst as 23 GB. Sum (rate - own) across
    // the samples that actually tripped, times the sample interval, and the figure is bounded by what
    // was observed rather than by an average.
    const dt = rows.length > 1 ? (rows[1].t - rows[0].t) / 1000 : 2;
    let total = 0, overN = 0, first = null, last = null;
    for (const r of win) {
      const w = num(r, C.wr);
      if (w === null) continue;
      total += w * dt / 1024;                              // GB across the window
      if (w > TRIP) { overN++; if (first === null) first = r.t; last = r.t; }
    }
    const expect = o.bytes / 1e9 * OVERHEAD;
    const extra = total - expect;
    console.log('    disk: ' + total.toFixed(1) + ' GB written, master is ' + (o.bytes / 1e9).toFixed(1)
      + ' GB (+' + ((OVERHEAD - 1) * 100).toFixed(0) + '% expected) — ' + fx(mean(win, C.wr), 1)
      + ' MB/s mean, ' + fx(mean(win, C.act), 1) + '% busy');
    if (extra > 1) {
      console.log('    !! ' + extra.toFixed(1) + ' GB beyond what this render accounts for, in ' + overN
        + ' samples over ' + TRIP.toFixed(0) + ' MB/s between ' + hhmm(first) + ' and ' + hhmm(last));
      console.log('       something else was using the disk: this run is not comparable to a quiet one'
        + ' without saying so.');
    }
  }

  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    const p = join(OUT, m.name + '.csv');
    writeFileSync(p, [header, ...win.map(r => r.l)].join('\n'), 'latin1');
    console.log('    wrote ' + p + '   (' + (statSync(p).size / 1e6).toFixed(2) + ' MB)');
  }
}

if (!hit.length) {
  console.log('');
  console.log('  No render in this window. The log is a record of a session, not of a render - an idle');
  console.log('  stretch is a measurement and this one is ' + ((t1 - t0) / 3600000).toFixed(1) + ' h of it.');
}
console.log('');
