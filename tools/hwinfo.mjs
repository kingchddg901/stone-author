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
//   5. memory-bound?              DRAM read+write bandwidth under load
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
let busyFrom = -1, busyTo = -1;
if (use) {
  const HOT = 60;
  busyFrom = use.findIndex(v => v !== null && v >= HOT);
  for (let i = use.length - 1; i >= 0; i--) if (use[i] !== null && use[i] >= HOT) { busyTo = i; break; }
}
const inLoad = (a) => busyFrom >= 0 ? a.slice(busyFrom, busyTo + 1).filter(v => v !== null) : a.filter(v => v !== null);
const preIdle = (a) => busyFrom > 1 ? a.slice(0, busyFrom).filter(v => v !== null) : [];
const postIdle = (a) => busyTo >= 0 && busyTo < a.length - 2 ? a.slice(busyTo + 1).filter(v => v !== null) : [];

if (use && busyFrom >= 0) {
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
console.log('');
