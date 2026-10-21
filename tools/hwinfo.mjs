// WHAT THE HARDWARE WAS DOING, from an HWiNFO CSV log.
//
// The render trace says how many workers were painting. It cannot say WHY a pass costs more when ten
// are painting than when one is - whether the cores clocked down, hit a power ceiling, got hot, or ran
// out of memory bandwidth. Those four have completely different remedies and the trace cannot tell them
// apart, so this reads the other instrument.
//
// IT ANSWERS SIX QUESTIONS AND NOT MORE:
//   1. did it throttle            HTC / PROCHOT flags, Thermal Limit %
//   2. was it power-limited       PPT against the PPT limit
//   3. how far did clocks fall    idle all-core against loaded all-core
//   4. did SMT actually work      T1 sibling usage against T0 - the one that decides whether a
//                                 12-thread cap on a 6-core part is honest
//   5. memory-bound?              DRAM bandwidth, AND system memory pressure - different questions
//   6. did it reach steady state  were temps and clocks still moving at the end - because a render
//                                 that ends before plateau under-reports what a longer one costs
//   7. was the GPU the ceiling    utilisation, clock and power against their own limits - and whether
//                                 that utilisation is SUSTAINED or BURSTY, which are different answers
//
// QUESTION 7 EXISTS BECAUSE EVERY OTHER ANSWER CAME BACK NEGATIVE. A five-hour 687-gigapixel render
// moved the CPU by 0.7 W and 1.4 C, asserted no throttling flag in 9,083 samples, and left four of six
// cores under 12%. The remaining suspect was the GPU, since canvas 2D rasterises there and every
// worker's OffscreenCanvas shares one GPU process - and it was WRONG: 33.8% mean utilisation, 1026 MHz
// of a 2929 MHz peak, 17.9% of its power limit. Neither device was the ceiling. That is a finding
// rather than a gap, but only because the log was read for it.
//
// THE MEAN IS THE TRAP. GPU utilisation averaged 33.8% while its median was 5% and its p95 was 99%:
// flat out in short bursts, near idle between them. The mean alone reads as a third-loaded device with
// headroom; what it actually shows is a device never asked for two things at once, which is the
// signature of a pipeline bound by its hand-offs rather than by any stage. So this prints the spread.
//
// NOT ALIGNED TO THE RENDER TRACE BY TIMESTAMP. HWiNFO logs wall clock, the trace logs
// performance.now() offsets, and reconciling those arithmetically is where alignment heuristics
// mislead. Instead the log is read for its own PHASES - idle, one core busy, all cores busy, idle again
// - which are unmistakable and ordered, and the trace knows those same instants independently.
//
//   node tools/hwinfo.mjs <log.CSV>
import { readFileSync } from 'fs';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/hwinfo.mjs <log.CSV>'); process.exit(2); }

// HWiNFO writes cp1252 (the degree sign in temperature headers is not valid UTF-8), quotes every
// header, and appends a trailing empty field per row. It also writes a final summary-ish row and can
// leave a short row if logging was stopped by killing the process rather than through its own control.
const raw = readFileSync(file, 'latin1').split(/\r?\n/).filter(l => l.trim().length);
const split = l => l.split(',').map(s => s.replace(/^"|"$/g, '').trim());
const head = split(raw[0]);
const rows = raw.slice(1).map(split).filter(r => r.length >= head.length - 2 && /\d/.test(r[1] || ''));
const short = raw.length - 1 - rows.length;

const col = (needle) => {
  const i = head.findIndex(h => h.toLowerCase() === needle.toLowerCase());
  return i >= 0 ? i : head.findIndex(h => h.toLowerCase().includes(needle.toLowerCase()));
};
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const series = (needle) => { const i = col(needle); return i < 0 ? null : rows.map(r => num(r[i])); };
const last = a => a[a.length - 1];
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const fx = (v, d = 0) => v === null || v === undefined ? '-' : v.toFixed(d);

console.log('');
console.log('  ' + file.replace(/\\/g, '/').split('/').pop());
console.log('  ' + rows.length + ' samples' + (short ? '   (' + short + ' row(s) skipped as short or non-numeric)' : ''));

// ---- the sample interval, read rather than assumed --------------------------------------------------
const tIdx = col('Time');
const secOf = s => { const m = String(s).match(/(\d+):(\d+):(\d+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };
const t0 = secOf(rows[0][tIdx]), t1 = secOf(last(rows)[tIdx]);
const span = t0 !== null && t1 !== null ? (t1 < t0 ? t1 + 86400 - t0 : t1 - t0) : null;
const dt = span && rows.length > 1 ? span / (rows.length - 1) : null;
if (span !== null) console.log('  span ' + (span / 60).toFixed(1) + ' min, every ' + fx(dt, 1) + ' s   (' +
  rows[0][tIdx] + ' -> ' + last(rows)[tIdx] + ')');

// ---- PHASES, found by load rather than by clock ----------------------------------------------------
// Total CPU Usage is the cheapest honest discriminator: idle sits near zero, the solo baseline pass
// shows roughly one thread of twelve (~8%), and the full pool pins everything.
const use = series('Total CPU Usage [%]') || series('Total CPU Usage');
let busyFrom = -1, busyTo = -1, runsFound = 0;
if (use) {
  // 25, NOT 60. A render that is bound by its hand-offs does not hold a high CPU figure - the stone
  // 1,048,576 of 2026-10-21 oscillated between 22% and 100% for 82 minutes, so a 60% threshold found
  // 24 separate "loaded stretches", took the longest at 10.6 min, and put the other 76 minutes in the
  // IDLE baseline. Every figure in this report was then the average of a render against itself.
  // Idle on this machine is 7-15%, so 25 separates the two without needing the render to behave.
  const HOT = 25;
  // THE LONGEST RUN, NOT FIRST-TO-LAST. This took the first hot sample and the last one, so a log that
  // caught a cancelled render before the real one spanned BOTH plus the idle gap between them - the
  // gap averaged into the loaded figures and the pre-idle baseline shrank to whatever preceded the
  // false start. A log is a record of a session, not of one render, and sessions have false starts.
  //
  // GAP TOLERANCE because a render is not hot in every sample: the solo calibration pass, the gaps
  // between rows and the final encode all dip below the threshold without the render having stopped.
  // 15 samples is 30 s at the usual 2 s interval - longer than any dip seen, far shorter than the
  // pause between two deliberate runs.
  const GAP = 60;
  let i = 0;
  while (i < use.length) {
    if (use[i] === null || use[i] < HOT) { i++; continue; }
    let start = i, end = i, j = i;
    while (j < use.length) {
      if (use[j] !== null && use[j] >= HOT) { end = j; j++; continue; }
      if (j - end > GAP) break;
      j++;
    }
    runsFound++;
    if (end - start > busyTo - busyFrom) { busyFrom = start; busyTo = end; }
    i = end + 1;
  }
}
const inLoad = (a) => busyFrom >= 0 ? a.slice(busyFrom, busyTo + 1).filter(v => v !== null) : a.filter(v => v !== null);
const preIdle = (a) => busyFrom > 1 ? a.slice(0, busyFrom).filter(v => v !== null) : [];
const postIdle = (a) => busyTo >= 0 && busyTo < a.length - 2 ? a.slice(busyTo + 1).filter(v => v !== null) : [];

if (use && busyFrom >= 0) {
  if (runsFound > 1) console.log('  ' + runsFound + ' loaded stretches in this log — reading the LONGEST and ignoring the rest');
  console.log('  phases: idle ' + busyFrom + ' samples -> LOADED ' + (busyTo - busyFrom + 1) +
              ' samples (' + fx((busyTo - busyFrom + 1) * (dt || 0) / 60, 1) + ' min) -> idle ' +
              (use.length - busyTo - 1));
  if (!preIdle(use).length) console.log('     !! no idle samples BEFORE the load: there is no quiescent baseline to compare against');
  if (!postIdle(use).length) console.log('     !! no idle samples AFTER the load: the decay and the steady-state check are unavailable');
} else {
  console.log('  could not find a loaded phase - is this the right log?');
}

const lane = (q, label, a, b, c, note) =>
  console.log('  ' + String(q).padStart(2) + '  ' + label.padEnd(30) +
              String(a).padStart(11) + String(b).padStart(13) + String(c).padStart(13) + (note ? '   ' + note : ''));

console.log('');
console.log('  ' + ' '.repeat(36) + 'pre-idle'.padStart(11) + 'LOADED'.padStart(13) + 'post-idle'.padStart(13));
console.log('  ' + '-'.repeat(74));

// ---- 1. did it throttle ---------------------------------------------------------------------------
{
  const flags = ['Thermal Throttling (HTC)', 'Thermal Throttling (PROCHOT CPU)', 'Thermal Throttling (PROCHOT EXT)'];
  const hits = [];
  for (const f of flags) {
    const i = col(f);
    if (i < 0) continue;
    const n = rows.filter(r => /yes/i.test(r[i] || '')).length;
    if (n) hits.push(f.replace('Thermal Throttling ', '') + ' x' + n);
  }
  const tl = series('Thermal Limit [%]');
  const temp = series('Core Temperatures (avg)') || series('CPU (Tctl/Tdie)');
  lane(1, 'core temperature avg (C)', fx(mean(preIdle(temp || [])), 1), fx(mean(inLoad(temp || [])), 1),
       fx(mean(postIdle(temp || [])), 1), temp ? 'peak ' + fx(Math.max(...inLoad(temp)), 1) : '');
  // NOT "how often it throttled". HWiNFO's own normalisation for this sensor is not stated in the log
  // and it reads 47% at 34 C idle, which no throttle count would. The FLAGS are the authoritative
  // answer and they are printed beneath; this row is a trend, not a verdict.
  if (tl) lane(1, 'thermal limit sensor (%)', fx(mean(preIdle(tl)), 0), fx(mean(inLoad(tl)), 0), fx(mean(postIdle(tl)), 0),
               'peak ' + fx(Math.max(...inLoad(tl)), 0) + '% - trend only');
  console.log('      throttling flags: ' + (hits.length ? 'FIRED - ' + hits.join(', ') : 'never asserted in any sample'));
}

// ---- 2. power ceiling ------------------------------------------------------------------------------
{
  const ppt = series('CPU PPT [W]'), pkg = series('CPU Package Power [W]'), lim = series('CPU PPT Limit [%]');
  lane(2, 'package power (W)', fx(mean(preIdle(pkg || [])), 1), fx(mean(inLoad(pkg || [])), 1), fx(mean(postIdle(pkg || [])), 1),
       pkg ? 'peak ' + fx(Math.max(...inLoad(pkg)), 1) : '');
  if (ppt) lane(2, 'PPT (W)', fx(mean(preIdle(ppt)), 1), fx(mean(inLoad(ppt)), 1), fx(mean(postIdle(ppt)), 1));
  if (lim) {
    const l = inLoad(lim);
    lane(2, 'PPT limit reached (%)', fx(mean(preIdle(lim)), 0), fx(mean(l), 0), fx(mean(postIdle(lim)), 0),
         'peak ' + fx(Math.max(...l), 0) + '%');
    const pinned = l.filter(v => v >= 95).length;
    console.log('      ' + (pinned > l.length * 0.5
      ? 'POWER-LIMITED: at or above 95% of PPT in ' + (100 * pinned / l.length).toFixed(0) + '% of loaded samples'
      : 'not power-limited: above 95% of PPT in only ' + (100 * pinned / l.length).toFixed(0) + '% of loaded samples'));
  }
}

// ---- 3. how far clocks fell -----------------------------------------------------------------------
{
  const eff = series('Core Effective Clocks (avg)'), ck = series('Core Clocks (avg)');
  const pi = mean(preIdle(ck || [])), ld = mean(inLoad(ck || []));
  // SIGN, STATED RATHER THAN ASSUMED. This read `(1 - ld/pi)` and labelled the result "lower under
  // load", which printed "-12.4% lower" for a clock that went UP. Idle cores are parked and
  // downclocked, so a boosting part reads HIGHER under load, and a measurement whose label contradicts
  // its own number is worse than no measurement.
  lane(3, 'core clock avg (MHz)', fx(pi, 0), fx(ld, 0), fx(mean(postIdle(ck || [])), 0),
       pi && ld ? Math.abs(100 * (ld / pi - 1)).toFixed(1) + '% ' + (ld >= pi ? 'HIGHER' : 'lower') + ' under load' : '');
  lane(3, 'effective clock avg (MHz)', fx(mean(preIdle(eff || [])), 0), fx(mean(inLoad(eff || [])), 0),
       fx(mean(postIdle(eff || [])), 0), 'effective = clock x residency');
  const fcl = series('Infinity Fabric Clock');
  if (fcl) lane(3, 'fabric clock (MHz)', fx(mean(preIdle(fcl)), 0), fx(mean(inLoad(fcl)), 0), fx(mean(postIdle(fcl)), 0));
}

// ---- 4. DID SMT ACTUALLY WORK ----------------------------------------------------------------------
// The question a 6-core/12-thread part forces: when the pool runs ten workers, are ten SIBLING threads
// carrying real work, or are six cores timeslicing ten jobs? T1 usage is the direct read.
{
  const t0s = [], t1s = [];
  for (let c = 0; c < 6; c++) {
    const a = series('Core ' + c + ' T0 Usage'), b = series('Core ' + c + ' T1 Usage');
    if (a) t0s.push(mean(inLoad(a)));
    if (b) t1s.push(mean(inLoad(b)));
  }
  if (t0s.length && t1s.length) {
    const mt0 = mean(t0s), mt1 = mean(t1s);
    lane(4, 'T0 usage, mean of 6 (%)', '-', fx(mt0, 1), '-');
    lane(4, 'T1 usage, mean of 6 (%)', '-', fx(mt1, 1), '-', 'the SMT siblings');
    console.log('      T1/T0 = ' + (mt1 / mt0).toFixed(2) + '   ' + (mt1 > 40
      ? '-> the siblings carried real work, so 12 threads is not a fiction on this load'
      : '-> the siblings were largely idle, so the extra workers were timeslicing 6 cores'));
    console.log('      per-core T0/T1: ' + t0s.map((v, i) => 'c' + i + ' ' + fx(v, 0) + '/' + fx(t1s[i], 0)).join('  '));
  }
}

// ---- 5. memory bandwidth ---------------------------------------------------------------------------
{
  const rd = series('DRAM Read Bandwidth'), wr = series('DRAM Write Bandwidth');
  if (rd) lane(5, 'DRAM read (Gbps)', fx(mean(preIdle(rd)), 1), fx(mean(inLoad(rd)), 1), fx(mean(postIdle(rd)), 1),
               'peak ' + fx(Math.max(...inLoad(rd)), 1));
  if (wr) lane(5, 'DRAM write (Gbps)', fx(mean(preIdle(wr)), 1), fx(mean(inLoad(wr)), 1), fx(mean(postIdle(wr)), 1),
               'peak ' + fx(Math.max(...inLoad(wr)), 1));
  const mc = series('Memory Clock [MHz]');
  if (mc) lane(5, 'memory clock (MHz)', fx(mean(preIdle(mc)), 0), fx(mean(inLoad(mc)), 0), fx(mean(postIdle(mc)), 0));

  // SYSTEM MEMORY, WHICH BANDWIDTH DOES NOT ANSWER. The 10-worker glass log read 1.4 GB/s of DRAM - a
  // couple of percent of a dual-channel budget - and sat at 85-90% PHYSICAL MEMORY LOAD throughout, on
  // 16 GB. Those are different questions and only the first was being asked. A ceiling that is
  // insensitive to tile size and worker count, which is what two 1,048,576 renders at 2048x8 and
  // 4096x8 produced to within 0.1%, is the shape a memory-pressure ceiling makes and not the shape a
  // bandwidth or compute one makes.
  //
  // AVAILABLE IS THE ONE THAT BITES, not used: Windows will sit near full with cache it releases on
  // demand, so a high load figure alone proves nothing. What matters is whether the floor of available
  // memory FALLS as the render proceeds, and whether it keeps falling - printed as a trend for that
  // reason rather than as a mean.
  const pu = series('Physical Memory Used [MB]'), pa = series('Physical Memory Available [MB]');
  const pl = series('Physical Memory Load [%]');
  if (pl) lane(5, 'physical memory load (%)', fx(mean(preIdle(pl)), 0), fx(mean(inLoad(pl)), 0), fx(mean(postIdle(pl)), 0),
               'peak ' + fx(Math.max(...inLoad(pl)), 0) + '%');
  if (pu) lane(5, 'physical memory used (MB)', fx(mean(preIdle(pu)), 0), fx(mean(inLoad(pu)), 0), fx(mean(postIdle(pu)), 0),
               'peak ' + fx(Math.max(...inLoad(pu)), 0));
  if (pa) {
    const L = inLoad(pa), lo = Math.min(...L);
    lane(5, 'physical memory free (MB)', fx(mean(preIdle(pa)), 0), fx(mean(L), 0), fx(mean(postIdle(pa)), 0),
         'LOWEST ' + fx(lo, 0) + ' MB');
    const a = L.slice(0, Math.floor(L.length / 3)), z = L.slice(-Math.floor(L.length / 3));
    const ma = mean(a), mz = mean(z);
    console.log('      free memory ' + fx(ma, 0) + ' -> ' + fx(mz, 0) + ' MB over the render'
      + (mz < ma * 0.9 ? '   <- STILL FALLING: the render is taking memory it does not give back'
         : (lo < 1024 ? '   <- under 1 GB free at the floor, which is where paging starts'
            : '   (held)')));
  }
  // THE PAGE FILE IS THE ONLY DIRECT EVIDENCE OF PAGING, and everything above is circumstantial without
  // it. Free memory falling can be a working set; free memory falling WHILE the page file grows is the
  // system moving something to disk to make room, which is the mechanism the three-hour 8192 incident
  // was blamed on and which has never actually been observed. A figure that does not move settles the
  // question in the other direction just as firmly.
  const pf = series('Page File Used [MB]');
  if (pf) {
    const L = inLoad(pf), a = L.slice(0, Math.floor(L.length / 3)), z = L.slice(-Math.floor(L.length / 3));
    const ma = mean(a), mz = mean(z), hi = Math.max(...L);
    lane(5, 'page file used (MB)', fx(mean(preIdle(pf)), 0), fx(mean(L), 0), fx(mean(postIdle(pf)), 0),
         'peak ' + fx(hi, 0));
    console.log('      page file ' + fx(ma, 0) + ' -> ' + fx(mz, 0) + ' MB across the render'
      + (mz > ma + 200 ? '   <- PAGING: it grew by ' + fx(mz - ma, 0) + ' MB while the render ran'
         : '   (flat - nothing was pushed to disk)'));
  }

  const dyn = series('GPU D3D Memory Dynamic [MB]'), ded = series('GPU D3D Memory Dedicated [MB]');
  // DYNAMIC IS VRAM THAT IS NOT VRAM: surfaces spilled to system memory across the PCIe link. On a
  // card with four lanes that spill is the difference between fast and unusable, so it is worth seeing
  // even when dedicated has room. The glass log never spilled - 2,378 MB of 4,096 at peak, dynamic
  // flat at ~200 MB - which ruled the link out there and says nothing about a heavier footprint.
  if (ded) lane(5, 'VRAM dedicated (MB)', fx(mean(preIdle(ded)), 0), fx(mean(inLoad(ded)), 0), fx(mean(postIdle(ded)), 0),
                'peak ' + fx(Math.max(...inLoad(ded)), 0));
  if (dyn) lane(5, 'VRAM spilled to system (MB)', fx(mean(preIdle(dyn)), 0), fx(mean(inLoad(dyn)), 0), fx(mean(postIdle(dyn)), 0),
                'peak ' + fx(Math.max(...inLoad(dyn)), 0));
}

// ---- 6. STEADY STATE, which decides whether any of this generalises --------------------------------
// A 12-minute render that never plateaued under-reports a 95-minute one. Compared as the first third of
// the loaded phase against the last third: if they differ, the figures above are a transient.
{
  const temp = series('Core Temperatures (avg)');
  const ck = series('Core Clocks (avg)');
  const thirds = a => {
    const l = inLoad(a); if (l.length < 9) return null;
    const k = Math.floor(l.length / 3);
    return [mean(l.slice(0, k)), mean(l.slice(-k))];
  };
  console.log('');
  console.log('  6   STEADY STATE - first third of the load against the last third');
  for (const [label, arr, d, unit] of [['core temperature', temp, 1, 'C'], ['core clock', ck, 0, 'MHz']]) {
    const t = arr && thirds(arr);
    if (!t) continue;
    const drift = t[0] ? 100 * (t[1] - t[0]) / t[0] : 0;
    console.log('      ' + label.padEnd(20) + fx(t[0], d) + ' -> ' + fx(t[1], d) + ' ' + unit +
                '   ' + (drift >= 0 ? '+' : '') + drift.toFixed(1) + '%' +
                (Math.abs(drift) > 3 ? '   <- STILL MOVING: this render did not reach steady state' : '   (settled)'));
  }
}

// ---- 7. was the GPU the ceiling --------------------------------------------------------------------
// Canvas 2D rasterises on the GPU and every worker's OffscreenCanvas shares one GPU process, so a pool
// that shows an idle CPU has one obvious suspect left. Reported against the GPU's OWN limits - a clock
// means nothing without the peak it could have reached - and with the spread beside the mean, because
// a bursty device and a loaded one average the same and mean opposite things.
{
  const util = series('GPU Utilization'), d3d = series('GPU D3D Usage');
  const clk = series('GPU Clock [MHz]'), tgp = series('Total Graphics Power');
  const ppt = series('GPU PPT Limit [%]'), mc = series('GPU Memory Controller Utilization');
  const comp = series('GPU Computing (Compute 0) Usage');
  console.log('');
  if (!util && !clk && !tgp) {
    console.log('  7   no GPU sensors in this log - HWiNFO was not logging the graphics adapter');
  } else {
    const pct = (a, q) => { const v = inLoad(a).slice().sort((x, y) => x - y);
                            return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * q))] : null; };
    if (util) lane(7, 'GPU utilisation (%)', fx(mean(preIdle(util)), 1), fx(mean(inLoad(util)), 1), fx(mean(postIdle(util)), 1),
                   'p50 ' + fx(pct(util, 0.5), 0) + '  p95 ' + fx(pct(util, 0.95), 0) + '  peak ' + fx(Math.max(...inLoad(util)), 0));
    if (d3d) lane(7, 'GPU D3D usage (%)', fx(mean(preIdle(d3d)), 1), fx(mean(inLoad(d3d)), 1), fx(mean(postIdle(d3d)), 1));
    if (clk) { const pk = Math.max(...inLoad(clk)), ld = mean(inLoad(clk));
      lane(7, 'GPU clock (MHz)', fx(mean(preIdle(clk)), 0), fx(ld, 0), fx(mean(postIdle(clk)), 0),
           'peak ' + fx(pk, 0) + ' -> ran at ' + fx(100 * ld / (pk || 1), 0) + '% of it'); }
    if (tgp) lane(7, 'graphics power (W)', fx(mean(preIdle(tgp)), 1), fx(mean(inLoad(tgp)), 1), fx(mean(postIdle(tgp)), 1),
                  'peak ' + fx(Math.max(...inLoad(tgp)), 1));
    if (ppt) lane(7, 'GPU PPT limit reached (%)', fx(mean(preIdle(ppt)), 0), fx(mean(inLoad(ppt)), 0), fx(mean(postIdle(ppt)), 0),
                  'peak ' + fx(Math.max(...inLoad(ppt)), 0) + '%');
    if (mc) lane(7, 'GPU memory controller (%)', fx(mean(preIdle(mc)), 1), fx(mean(inLoad(mc)), 1), fx(mean(postIdle(mc)), 1));
    if (comp && inLoad(comp).length && Math.max(...inLoad(comp)) === 0)
      console.log('      compute usage is zero throughout: all raster, no compute shaders');
    // THE VERDICT IS ABOUT SHAPE, not level. A device averaging a third with a p95 near 100 is not a
    // third-loaded device with headroom; it is one that is never asked for two things at once, which
    // points at the hand-offs between stages rather than at any stage.
    if (util) {
      const m = mean(inLoad(util)), p95 = pct(util, 0.95);
      const pk = clk ? Math.max(...inLoad(clk)) : 0, ldc = clk ? mean(inLoad(clk)) : 0;
      console.log('      ' + ((m > 85 || (ppt && mean(inLoad(ppt)) > 90))
        ? '-> the GPU WAS the ceiling: sustained utilisation with no headroom left'
        : (p95 > 90 && m < 60)
          ? '-> BURSTY, not saturated (mean ' + fx(m, 0) + '%, p95 ' + fx(p95, 0) + '%'
            + (pk ? ', clock ' + fx(100 * ldc / pk, 0) + '% of peak' : '')
            + '). Flat out in bursts, idle between them: the cost is in the hand-offs, not the work'
          : '-> the GPU had headroom throughout and was not the limit'));
    }
  }
}

// ---- 8. the drive, and the save, which are two different measurements -------------------------------
// THE SAVE IS THE CONTROL FOR THE RENDER. A render writing slowly proves nothing on its own - the drive
// might be incapable. But a 1,048,576 writes its master to OPFS as it goes and then copies the whole
// thing out afterwards, so the same log contains the render's rate AND the same drive's rate when
// something actually asks it for throughput. Measured 2026-10-21: 5.4 MB/s at 3.6% busy for 82 minutes,
// then 84.6 MB/s with peaks past 340 for the 4.6-minute save. Fifteen times faster, on demand, straight
// afterwards. That turns "storage was not the bottleneck" from an assumption into a comparison.
//
// AND THE TOTAL IS ITS OWN NUMBER. ~26 GB written during the render plus ~22.8 GB on the save is about
// 49 GB of writes for a 23 GB file. Free space decides whether a render can start; total writes is what
// a drive accumulates over a hundred of them, and they are not the same question.
{
  const wr = series('Write Rate'), rd = series('Read Rate');
  const act = series('Total Activity'), dtemp = series('Drive Temperature');
  if (wr || act) {
    console.log('');
    console.log('   8  THE DRIVE - and the tail, where the master is copied out');
    // ITS OWN PERCENTILE, because the one in section 7 takes a SERIES and slices inLoad itself - this
    // needs the p95 of an already-sliced window, since the save lives in postIdle rather than in load.
    const p95of = (v) => { const s = v.slice().sort((x, y) => x - y); return s[Math.floor(s.length * 0.95)] || 0; };
    const gb = (a) => (a.reduce((x, y) => x + y, 0) * (dt || 2) / 1024).toFixed(1);
    const line = (tag, set) => {
      if (!wr) return;
      const W = set(wr);
      if (!W.length) return;
      const A = act ? set(act) : [];
      console.log('      ' + tag.padEnd(18) + 'write ' + fx(mean(W), 1).padStart(7) + ' MB/s'
        + '   p95 ' + fx(p95of(W), 1).padStart(7)
        + '   peak ' + fx(Math.max(...W), 1).padStart(7)
        + (A.length ? '   busy ' + fx(mean(A), 1).padStart(5) + '%' : '')
        + '   ~' + gb(W) + ' GB');
    };
    // THESE ARE NOT "RENDER" AND "SAVE", and labelling them that way was wrong. A 1,048,576 copies its
    // master out afterwards at 85 MB/s, which keeps the CPU well above the threshold - so the save sits
    // INSIDE the loaded phase and the tail is only whatever idles after it. The 320 MB/s peak below is
    // the save, reported as part of the render.
    //
    // Nothing in a hardware log can find that boundary: both are busy. Splitting them needs the
    // master's own `ms.render` against its `at`, which is what tools/lib/find-meta.mjs reads - and done
    // that way the same render was 5.4 MB/s at 3.6% busy for 82 minutes, then 84.6 MB/s for a 4.6-minute
    // save. Fifteen times faster on demand, immediately afterwards.
    line('loaded phase', inLoad);
    line('after it', postIdle);
    if (dtemp) lane(8, 'drive temperature (C)', fx(mean(preIdle(dtemp)), 1), fx(mean(inLoad(dtemp)), 1),
                    fx(mean(postIdle(dtemp)), 1), 'peak ' + fx(Math.max(...inLoad(dtemp)), 1));
    if (wr) {
      const L = inLoad(wr), P = postIdle(wr);
      if (L.length && P.length) {
        const r = mean(P) / Math.max(0.01, mean(L));
        const peak = Math.max(...L.concat(P));
        // THE COMPARISON THAT SURVIVES not knowing where the save begins: the PEAK against the MEAN.
        // Whichever window the copy landed in, some sample in this log shows the drive at its real rate,
        // and if the mean sits far below that peak then the work was never asking for throughput. A
        // ratio of the two windows cannot say that when one of them contains both activities.
        console.log('      ' + (peak > mean(L) * 5
          ? '-> this drive reached ' + fx(peak, 0) + ' MB/s in this log against a loaded mean of '
            + fx(mean(L), 1) + ' - it had ' + fx(peak / Math.max(0.01, mean(L)), 0)
            + 'x the throughput the render asked for, so storage was not the ceiling'
          : '-> the loaded mean is close to the best this drive did here: it may be the limit, look further')
          + (r > 1.5 ? '   (tail ' + fx(r, 1) + 'x the loaded rate)' : ''));
      }
    }
  }
}
console.log('');
