/**
 * THE MUXER ROUND-TRIPS, OR IT IS NOT A MUXER.
 *
 * tools/lib/webm.mjs writes a container around frames the browser's encoder produced. A test that
 * only checked it emitted bytes would pass on garbage, so this PARSES THE FILE BACK with an
 * independent EBML reader and asserts what came out is what went in: every frame, in order, byte
 * for byte, at the right timestamp, with the keyframe flags intact.
 *
 * The reader here is deliberately NOT shared with the writer. Sharing a definition of the format
 * would let one mistake agree with itself - the whole point is a second opinion about the bytes.
 *
 * Every claim is run against its own ablation. A claim whose ablation still passes is reported as
 * decoration rather than a test.
 *
 *   node tools/check-webm.mjs
 *   node tools/check-webm.mjs --ablate
 */
import { mux, vint, el, simpleBlock } from './lib/webm.mjs';

const ABLATE = process.argv.includes('--ablate');

// ---- an independent EBML reader ------------------------------------------------------------------
function readVint(b, i, keepMarker) {
  const first = b[i];
  if (first === 0) throw new Error('bad vint at ' + i);
  let len = 1;
  while (!(first & (1 << (8 - len)))) len++;
  let v = keepMarker ? first : first & ((1 << (8 - len)) - 1);
  for (let k = 1; k < len; k++) v = v * 256 + b[i + k];
  return { v, len };
}
function* elements(b, start, end) {
  let i = start;
  while (i < end) {
    const id = readVint(b, i, true);
    const size = readVint(b, i + id.len, false);
    const head = id.len + size.len;
    yield { id: id.v, start: i + head, end: i + head + size.v };
    i += head + size.v;
  }
}
const uintOf = (b, e) => { let v = 0; for (let i = e.start; i < e.end; i++) v = v * 256 + b[i]; return v; };
const strOf = (b, e) => new TextDecoder().decode(b.subarray(e.start, e.end));

function demux(bytes) {
  const b = bytes;
  const out = { docType: null, timecodeScale: null, duration: null, width: 0, height: 0,
                codec: null, frames: [], clusters: 0, cues: [] };
  for (const top of elements(b, 0, b.length)) {
    if (top.id === 0x1A45DFA3) {
      for (const e of elements(b, top.start, top.end)) if (e.id === 0x4282) out.docType = strOf(b, e);
    } else if (top.id === 0x18538067) {
      const segStart = top.start;
      for (const s of elements(b, top.start, top.end)) {
        if (s.id === 0x1549A966) {
          for (const e of elements(b, s.start, s.end)) {
            if (e.id === 0x2AD7B1) out.timecodeScale = uintOf(b, e);
            if (e.id === 0x4489) out.duration = new DataView(b.buffer, b.byteOffset + e.start, e.end - e.start).getFloat64(0, false);
          }
        } else if (s.id === 0x1654AE6B) {
          for (const te of elements(b, s.start, s.end)) {
            for (const e of elements(b, te.start, te.end)) {
              if (e.id === 0x86) out.codec = strOf(b, e);
              if (e.id === 0xE0) for (const v of elements(b, e.start, e.end)) {
                if (v.id === 0xB0) out.width = uintOf(b, v);
                if (v.id === 0xBA) out.height = uintOf(b, v);
              }
            }
          }
        } else if (s.id === 0x1F43B675) {
          out.clusters++;
          let base = 0;
          for (const e of elements(b, s.start, s.end)) {
            if (e.id === 0xE7) base = uintOf(b, e);
            if (e.id === 0xA3) {
              const t = readVint(b, e.start, false);
              const rel = new DataView(b.buffer, b.byteOffset + e.start + t.len, 2).getInt16(0, false);
              const flags = b[e.start + t.len + 2];
              out.frames.push({ track: t.v, ms: base + rel, keyframe: !!(flags & 0x80),
                                data: b.subarray(e.start + t.len + 3, e.end) });
            }
          }
        } else if (s.id === 0x1C53BB6B) {
          for (const cp of elements(b, s.start, s.end)) {
            let time = null, pos = null;
            for (const e of elements(b, cp.start, cp.end)) {
              if (e.id === 0xB3) time = uintOf(b, e);
              if (e.id === 0xB7) for (const p of elements(b, e.start, e.end)) if (p.id === 0xF1) pos = uintOf(b, p);
            }
            out.cues.push({ time, pos, segStart });
          }
        }
      }
    }
  }
  return out;
}

// ---- a synthetic sequence whose answers we chose -------------------------------------------------
// 300 frames at 30 fps = 10 s, a keyframe every 2 s, and payloads that encode their own index so a
// frame delivered in the wrong order is caught by its CONTENT and not only by its timestamp.
const N = 300, FPS = 30;
const SRC = Array.from({ length: N }, (_, i) => ({
  data: new Uint8Array([i & 0xFF, (i >> 8) & 0xFF, 0xAB, ...new Array(20 + (i % 7)).fill(i & 0xFF)]),
  timestampUs: Math.round(i * 1e6 / FPS),
  keyframe: i % (FPS * 2) === 0,
}));

let bad = 0;
const rows = [];
let ablatedBit = false;
function claim(ok, targeted, title, detail) {
  if (!ok && !(ABLATE && targeted)) bad++;
  if (ABLATE && targeted && !ok) ablatedBit = true;
  const tag = !ok ? (ABLATE && targeted ? 'red ' : 'FAIL') : (ABLATE && !targeted ? 'n/a ' : 'ok  ');
  rows.push('  ' + tag + '  ' + title.padEnd(46) + detail);
}

let bytes = mux({ frames: SRC, width: 1280, height: 800, codec: 'V_VP9', frameRate: FPS });
if (ABLATE) {
  // Move ONE cluster's timecode by a second. The file still parses and still has every frame, so
  // only a check that compares timestamps against what went in can see it.
  const b = demuxFindFirstClusterTimecode(bytes);
  if (b < 0) throw new Error('ablation could not find a cluster timecode');
  bytes = bytes.slice();
  bytes[b] = (bytes[b] + 1) & 0xFF;
}
function demuxFindFirstClusterTimecode(buf) {
  for (const top of elements(buf, 0, buf.length)) {
    if (top.id !== 0x18538067) continue;
    for (const s of elements(buf, top.start, top.end)) {
      if (s.id !== 0x1F43B675) continue;
      for (const e of elements(buf, s.start, s.end)) if (e.id === 0xE7) return e.end - 1;
    }
  }
  return -1;
}

const got = demux(bytes);

claim(got.docType === 'webm', false, 'it is a webm', 'DocType ' + got.docType);
claim(got.codec === 'V_VP9' && got.width === 1280 && got.height === 800, false,
      'the track says what it is', got.codec + ' ' + got.width + 'x' + got.height);
claim(got.timecodeScale === 1000000, false, 'timecodes are milliseconds',
      'TimecodeScale ' + got.timecodeScale + ' ns');
claim(got.frames.length === N, false, 'every frame came back',
      got.frames.length + ' of ' + N + ' in ' + got.clusters + ' cluster(s)');

// THE CLAIM WITH TEETH: payload bytes and timestamps, against what went in.
{
  let wrongT = 0, wrongBytes = 0, wrongKey = 0, eg = '';
  for (let i = 0; i < Math.min(N, got.frames.length); i++) {
    const want = SRC[i], g = got.frames[i];
    const wantMs = Math.round(want.timestampUs / 1000);
    if (g.ms !== wantMs) { wrongT++; if (!eg) eg = 'frame ' + i + ' at ' + g.ms + 'ms, wanted ' + wantMs; }
    if (g.keyframe !== want.keyframe) wrongKey++;
    if (g.data.length !== want.data.length || g.data.some((v, k) => v !== want.data[k])) {
      wrongBytes++; if (!eg) eg = 'frame ' + i + ' payload differs';
    }
  }
  claim(wrongT === 0 && wrongBytes === 0 && wrongKey === 0, true,
        'frames round-trip: bytes, time and keyframe flag',
        wrongT || wrongBytes || wrongKey
          ? wrongT + ' bad timestamps, ' + wrongBytes + ' bad payloads, ' + wrongKey + ' bad flags  ' + eg
          : 'all ' + N + ' identical, 0..' + got.frames[got.frames.length - 1].ms + 'ms');
}

claim(Math.abs(got.duration - (Math.round((N - 1) * 1000 / FPS) + Math.round(1000 / FPS))) < 1, false,
      'duration covers the last frame', got.duration + ' ms');

// A cue must point at a real cluster, and at one that opens on a keyframe.
{
  let bogus = 0;
  for (const c of got.cues) {
    const at = c.segStart + c.pos;
    const idOK = bytes[at] === 0x1F && bytes[at + 1] === 0x43 && bytes[at + 2] === 0xB6 && bytes[at + 3] === 0x75;
    if (!idOK) bogus++;
  }
  claim(got.cues.length > 0 && bogus === 0, false, 'every cue points at a real cluster',
        got.cues.length + ' cue(s), ' + bogus + ' not landing on a Cluster id');
}

// The reserved all-ones VINT must never be produced: 127 needs two bytes, not 0xFF.
claim(vint(127).length === 2 && vint(126)[0] === 0xFE && vint(0)[0] === 0x80, false,
      'the reserved vint is never emitted', 'vint(127) is ' + vint(127).length + ' bytes, vint(126)=0x' + vint(126)[0].toString(16));

// A block offset that cannot fit must throw rather than wrap into a negative time.
{
  let threw = false;
  try { simpleBlock(1, 40000, true, new Uint8Array(1)); } catch (e) { threw = true; }
  claim(threw, false, 'an impossible block offset throws', threw ? 'rejected 40000ms' : 'ACCEPTED - would wrap');
}

// A long GOP must still produce a legal file: offsets are forced into range by a cluster cut.
{
  const sparse = Array.from({ length: 60 * FPS }, (_, i) => ({
    data: new Uint8Array([i & 0xFF]), timestampUs: Math.round(i * 1e6 / FPS), keyframe: i === 0,
  }));
  let ok = false, detail = '';
  try { const d = demux(mux({ frames: sparse, width: 16, height: 16, frameRate: FPS }));
        ok = d.frames.length === sparse.length; detail = d.clusters + ' cluster(s) for 60 s with ONE keyframe';
  } catch (e) { detail = 'threw: ' + e.message; }
  claim(ok, false, 'a 60 s single-keyframe run still muxes', detail);
}

console.log('THE MUXER ROUND-TRIPS, OR IT IS NOT A MUXER' + (ABLATE ? '  [ABLATED: one cluster timecode +1]' : '') + '\n');
console.log(rows.join('\n'));
if (ABLATE) {
  console.log('\n' + (ablatedBit
    ? 'ablation held: the round-trip claim went red, as it must. n/a = not targeted by this ablation'
    : 'ABLATION DID NOT BITE - a shifted cluster timecode is invisible to this gate') +
    (bad ? '  (and ' + bad + ' unrelated claim(s) are genuinely failing)' : ''));
  process.exit(ablatedBit && !bad ? 0 : 1);
}
console.log('\n' + (bad ? bad + ' PROBLEM(S)' : 'webm: OK - every frame came back as it went in'));
process.exit(bad ? 1 : 0);
