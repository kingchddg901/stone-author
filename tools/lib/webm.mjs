// A WEBM MUXER, AND NOTHING ELSE.
//
// The browser's VideoEncoder compresses the frames; this writes the container they go in. That
// split is the whole reason the app can emit a video and stay CC0: the codec is the browser's and
// imposes nothing, VP9 and AV1 are royalty-free, and a container is a few hundred lines of EBML
// rather than motion estimation and rate control. H.264 is deliberately not a default anywhere -
// it works, and it drags a patent pool in for no gain over VP9.
//
// EBML IN ONE PARAGRAPH, because every bug below came from getting one of these wrong. An element
// is an ID, then a size, then a payload. IDs are written as their literal bytes - they already
// carry their own length marker. Sizes are VINTs: the first set bit marks the length, so 0x81 is a
// 1-byte size of 1 and 0x4001 is a 2-byte size of 1. A size of all ones is RESERVED for "unknown"
// and must never be produced by rounding a real length up into it.
//
// TIMECODE SCALE IS 1,000,000 ns, so every timecode in this file is MILLISECONDS. Cluster timecodes
// are absolute; a SimpleBlock's is a SIGNED 16-bit offset from its own cluster, which is why
// clusters are cut before that offset can overflow rather than at a frame count.
//
// WHAT THIS DOES NOT DO, said plainly rather than left to look covered: no audio, no lacing, no
// seeking metadata beyond Cues at keyframes, no live/unknown-size segment. It writes a finished
// file from frames it has all of.

const ID = {
  EBML: [0x1A, 0x45, 0xDF, 0xA3],
  EBMLVersion: [0x42, 0x86], EBMLReadVersion: [0x42, 0xF7],
  EBMLMaxIDLength: [0x42, 0xF2], EBMLMaxSizeLength: [0x42, 0xF3],
  DocType: [0x42, 0x82], DocTypeVersion: [0x42, 0x87], DocTypeReadVersion: [0x42, 0x85],
  Segment: [0x18, 0x53, 0x80, 0x67],
  Info: [0x15, 0x49, 0xA9, 0x66],
  TimecodeScale: [0x2A, 0xD7, 0xB1], Duration: [0x44, 0x89],
  MuxingApp: [0x4D, 0x80], WritingApp: [0x57, 0x41],
  Tracks: [0x16, 0x54, 0xAE, 0x6B], TrackEntry: [0xAE],
  TrackNumber: [0xD7], TrackUID: [0x73, 0xC5], TrackType: [0x83],
  FlagLacing: [0x9C], CodecID: [0x86], CodecPrivate: [0x63, 0xA2],
  DefaultDuration: [0x23, 0xE3, 0x83],
  Video: [0xE0], PixelWidth: [0xB0], PixelHeight: [0xBA],
  Cluster: [0x1F, 0x43, 0xB6, 0x75], Timecode: [0xE7], SimpleBlock: [0xA3],
  Cues: [0x1C, 0x53, 0xBB, 0x6B], CuePoint: [0xBB], CueTime: [0xB3],
  CueTrackPositions: [0xB7], CueTrack: [0xF7], CueClusterPosition: [0xF1],
};

const u8 = a => (a instanceof Uint8Array ? a : new Uint8Array(a));

// A VINT size. Length is the smallest that FITS, and the all-ones value of that length is skipped
// because it means "unknown" - a size of 127 in one byte would be 0xFF, which is that reserved
// pattern, so it takes two bytes instead.
export function vint(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error('vint: ' + n);
  for (let len = 1; len <= 8; len++) {
    const max = Math.pow(2, 7 * len) - 1;              // the reserved all-ones value
    if (n < max) {
      const out = new Uint8Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) { out[i] = v & 0xFF; v = Math.floor(v / 256); }
      out[0] |= 1 << (8 - len);                        // the length marker
      return out;
    }
  }
  throw new Error('vint too large: ' + n);
}

const uintBytes = n => {
  const out = [];
  let v = Math.floor(n);
  do { out.unshift(v & 0xFF); v = Math.floor(v / 256); } while (v > 0);
  return new Uint8Array(out);
};

const f64 = n => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, n, false); return b; };

/** An element: id bytes, a VINT size, then the payload. */
export function el(id, payload) {
  const body = u8(payload);
  const idb = u8(id), size = vint(body.length);
  const out = new Uint8Array(idb.length + size.length + body.length);
  out.set(idb, 0); out.set(size, idb.length); out.set(body, idb.length + size.length);
  return out;
}
const elU = (id, n) => el(id, uintBytes(n));
const elS = (id, s) => el(id, new TextEncoder().encode(s));
const cat = parts => {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/**
 * A SimpleBlock: the track as a VINT, a SIGNED 16-bit offset from the cluster, a flags byte, then
 * the frame. 0x80 marks a keyframe - a file whose blocks all claim to be keyframes still plays and
 * seeks wrongly, which is the kind of wrong that looks like a player bug.
 */
export function simpleBlock(track, relMs, keyframe, data) {
  if (relMs < -32768 || relMs > 32767) throw new Error('block offset out of range: ' + relMs);
  const t = vint(track);
  const out = new Uint8Array(t.length + 3 + data.length);
  out.set(t, 0);
  new DataView(out.buffer).setInt16(t.length, relMs, false);
  out[t.length + 2] = keyframe ? 0x80 : 0;
  out.set(data, t.length + 3);
  return out;
}

const header = () => el(ID.EBML, cat([
  elU(ID.EBMLVersion, 1), elU(ID.EBMLReadVersion, 1),
  elU(ID.EBMLMaxIDLength, 4), elU(ID.EBMLMaxSizeLength, 8),
  elS(ID.DocType, 'webm'), elU(ID.DocTypeVersion, 2), elU(ID.DocTypeReadVersion, 2),
]));

/**
 * Mux encoded frames into a WebM.
 *
 *   frames   [{ data: Uint8Array, timestampUs: number, keyframe: boolean }], in order
 *   codec    'V_VP9' | 'V_VP8' | 'V_AV1'
 *
 * Returns a Uint8Array. The caller wraps it in a Blob; this module touches no DOM so the gate can
 * run it in node.
 */
export function mux({ frames, width, height, codec = 'V_VP9', codecPrivate = null,
                      frameRate = 30, writingApp = 'Material Author' }) {
  if (!frames.length) throw new Error('mux: no frames');
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].timestampUs < frames[i - 1].timestampUs) {
      throw new Error('mux: frame ' + i + ' goes backwards in time');
    }
  }
  if (!frames[0].keyframe) throw new Error('mux: the first frame must be a keyframe');

  const ms = us => Math.round(us / 1000);
  const TRACK = 1;

  // A CLUSTER IS CUT BY TIME, NOT BY COUNT, because a block's offset from its cluster is a signed
  // 16-bit millisecond value. Cutting every 2^15 ms would be exactly at the edge, so this cuts at
  // 1 s - which is also roughly what every other muxer does, and keeps Cues useful for seeking.
  // AND IT IS FORCED BEFORE THAT LIMIT WHETHER OR NOT A KEYFRAME ARRIVES. An encoder given a long
  // GOP can go tens of seconds without one - a 2:36 film at one keyframe per 10 s would overflow a
  // single cluster's offsets at 32.7 s. Cutting on a keyframe is preferred because a cue that lands
  // on one actually seeks; the forced cut is the floor that keeps the file legal regardless.
  const CLUSTER_MS = 1000, FORCE_MS = 30000;
  const clusters = [];
  let cur = null;
  for (const f of frames) {
    const t = ms(f.timestampUs);
    const want = !cur || (t - cur.t >= CLUSTER_MS && f.keyframe) || (t - cur.t >= FORCE_MS);
    if (want) {
      cur = { t, blocks: [], key: !!f.keyframe };
      clusters.push(cur);
    }
    // WRAPPED AS AN ELEMENT. simpleBlock returns the PAYLOAD - track, offset, flags, frame - and a
    // cluster holding those raw is a file whose first block reads as a corrupt element id. The
    // round-trip gate caught this on its first run, at the byte.
    cur.blocks.push(el(ID.SimpleBlock, simpleBlock(TRACK, t - cur.t, !!f.keyframe, f.data)));
  }

  const trackBody = [
    elU(ID.TrackNumber, TRACK), elU(ID.TrackUID, TRACK), elU(ID.TrackType, 1),
    elU(ID.FlagLacing, 0), elS(ID.CodecID, codec),
    elU(ID.DefaultDuration, Math.round(1e9 / frameRate)),
    el(ID.Video, cat([elU(ID.PixelWidth, width), elU(ID.PixelHeight, height)])),
  ];
  if (codecPrivate && codecPrivate.length) trackBody.push(el(ID.CodecPrivate, u8(codecPrivate)));
  const tracks = el(ID.Tracks, cat([el(ID.TrackEntry, cat(trackBody))]));

  const lastMs = ms(frames[frames.length - 1].timestampUs) + Math.round(1000 / frameRate);
  const info = el(ID.Info, cat([
    elU(ID.TimecodeScale, 1000000),                    // 1 ms, which every timecode here assumes
    el(ID.Duration, f64(lastMs)),
    elS(ID.MuxingApp, writingApp), elS(ID.WritingApp, writingApp),
  ]));

  // Clusters are built before Cues, because a cue points at a cluster's BYTE OFFSET from the start
  // of the segment's payload - so the sizes of Info and Tracks have to be known first.
  const clusterEls = clusters.map(c => el(ID.Cluster, cat([elU(ID.Timecode, c.t), ...c.blocks])));
  let off = info.length + tracks.length;
  const cuePoints = [];
  for (let i = 0; i < clusters.length; i++) {
    // ONLY A CLUSTER THAT OPENS ON A KEYFRAME GETS A CUE. A forced cut can open on a delta frame,
    // and seeking there lands the decoder on something it cannot decode - the player shows nothing
    // or tears until the next keyframe, which reads as a broken file rather than a bad index.
    if (clusters[i].key) {
      cuePoints.push(el(ID.CuePoint, cat([
        elU(ID.CueTime, clusters[i].t),
        el(ID.CueTrackPositions, cat([elU(ID.CueTrack, TRACK), elU(ID.CueClusterPosition, off)])),
      ])));
    }
    off += clusterEls[i].length;
  }
  const cues = el(ID.Cues, cat(cuePoints));

  return cat([header(), el(ID.Segment, cat([info, tracks, ...clusterEls, cues]))]);
}

export { ID };
