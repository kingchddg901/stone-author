/**
 * Emit a generated stone as JSON, for tools/stone_preview.py to draw.
 *
 * The generator deals in structure and never in pixels, so previewing it needs
 * something that rasterises - and that lives outside the panel on purpose. This
 * is the seam: veins and their resolved draw attributes go out as data, and what
 * turns them into an image is somebody else's problem.
 *
 *   node tools/stone-dump.mjs --stone carrara --seed 7 --footprint 400
 *
 * Anything else on the command line is applied to the stone as an override, so
 * a parameter can be tried without editing the table:
 *
 *   node tools/stone-dump.mjs --stone carrara --wander 0.4 --follow 0.8
 *   node tools/stone-dump.mjs --stone carrara --origin 0.25,1.5
 */
import { stoneArt, resolve, STONES } from "../panel/stone-art.js";

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 1) {
  if (!args[i].startsWith("--")) continue;
  const key = args[i].slice(2);
  const raw = args[i + 1];
  if (raw === undefined || raw.startsWith("--")) { opt[key] = true; continue; }
  opt[key] = raw.includes(",")
    ? raw.split(",").map(Number)
    : (Number.isNaN(Number(raw)) ? raw : Number(raw));
  i += 1;
}

const name = opt.stone || "carrara";
const seed = opt.seed ?? 7;
const footprint = opt.footprint ?? 400;

const RESERVED = new Set(["stone", "seed", "footprint", "out"]);
const overrides = Object.fromEntries(
  Object.entries(opt).filter(([k]) => !RESERVED.has(k)),
);

const base = STONES[name];
if (!base) {
  process.stderr.write(`unknown stone: ${name}\nknown: ${Object.keys(STONES).join(", ")}\n`);
  process.exit(2);
}

// The generator takes a definition as readily as a name, so an override is just
// a copy with the change on it. This used to borrow an existing table key,
// overwrite it, generate, and put it back - which worked, and was a landmine
// for anything that ever generated two stones at once.
const art = stoneArt({ seed, footprint,
  stone: Object.keys(overrides).length ? { ...base, ...overrides, name } : name });

process.stdout.write(JSON.stringify({
  stone: name, seed, footprint, overrides,
  veins: art.veins.map((v) => ({
    id: v.id, tier: v.tier, shape: v.shape || null, closed: !!v.closed,
    points: v.points, widths: v.widths,
    depth: v.depth, depth0: v.depth0, depth1: v.depth1, grade: v.grade,
    ...resolve(v, { footprint }),
  })),
}));
