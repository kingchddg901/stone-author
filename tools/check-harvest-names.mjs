// CAN THE HARVESTER SEE THE MASTERS THIS APP ACTUALLY WRITES?
//
// `watch-harvest.mjs` deletes files, so what it matches is deliberately narrow - a looser rule over a
// Downloads folder would start deleting things this project never wrote, and the folder in question
// holds 22 Baen CD archives to prove the point. But a narrow rule has a failure mode with no symptom:
// a slab renamed in the app produces masters the regex does not match, and a name that does not match
// is indistinguishable from a directory with nothing in it.
//
// IT HAS HAPPENED TWICE. 2026-09-30: `HERO-MASTER-sealkey.json` renamed the output and 21 masters,
// 52.5 GiPx and 15.2 GB accumulated unseen for an hour. 2026-10-24: the supersample ladder exported
// 20 masters as `Glass Master Source-...` and every one was invisible; their sidecars exist only
// because somebody made them by hand. The second time, the first time was already written down in a
// comment four lines above the regex.
//
// WHAT THIS HAS TO PROVE:
//   1  every prefix in the list matches a correctly-named master from that slab
//   2  the warning net is WIDER than the delete net - anything deletable is also shaped
//   3  neither net touches the unrelated files that share that folder
//   4  a slab the list has never heard of is still SEEN, which is the fix for the symptomless failure
//   5  prefixes are escaped, so a name a person typed cannot act as a pattern
//   6  only the narrow net can reach the delete path
//
//   node tools/check-harvest-names.mjs
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('./watch-harvest.mjs', import.meta.url), 'utf8');
let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('  ok    ' + name); return; }
  fails++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

// LIFTED, NOT COPIED. The declarations are pulled out of the tool and evaluated, the way the overview
// reducer is pulled out of the app - a second copy of this regex here would pass while the real one
// was wrong, which is the only way this gate could lie.
const grab = (re, what) => {
  const m = SRC.match(re);
  if (!m) { console.log('  FAIL  cannot find ' + what + ' in watch-harvest.mjs - this gate is stale'); fails++; return null; }
  return m[0];
};
const dPREFIX = grab(/const PREFIX = \[[^\]]*\];/, 'PREFIX');
const dESC = grab(/const esc = [^;]*;/, 'esc');
const dSHAPED = grab(/const SHAPED = \/.*\/i;/, 'SHAPED');
const dMASTER = grab(/const MASTER = new RegExp\([^;]*\);/, 'MASTER');
if (fails) { console.error('check-harvest-names: cannot read the tool'); process.exit(1); }

const lift = prefixDecl => new Function(
  (prefixDecl || dPREFIX) + '\n' + dESC + '\n' + dSHAPED + '\n' + dMASTER +
  '\nreturn { PREFIX, esc, SHAPED, MASTER };')();
const { PREFIX, esc, SHAPED, MASTER } = lift();
// PREFIX is a const in the tool, so an ablation REPLACES ITS DECLARATION rather than reassigning it.
const withPrefixes = list => lift('const PREFIX = ' + JSON.stringify(list) + ';');

// A REAL TAIL, from a master that is in the archive today. The gate is self-contained because
// .claude/ is not committed, so these are fixtures - but they are fixtures copied off real files
// rather than invented, which is the difference between a sample and a guess.
const TAILS = ['-1048576-day-win-chrome-1024-195959.tif', '-8192-uv-ios-safari-0927-034222.tif',
               '-2048-day-win-chrome-1024-165329.png', '-65535-uv-win-firefox-0928-180008.tif'];

// ---- 1: every prefix matches its own slab's masters ------------------------------------------------
console.log('  PREFIX = ' + JSON.stringify(PREFIX));
for (const p of PREFIX) {
  const names = TAILS.map(t => p + t);
  ok('"' + p + '" matches its masters', names.every(n => MASTER.test(n)),
     names.find(n => !MASTER.test(n)));
}

// ---- 2: the warning net is wider than the delete net ----------------------------------------------
// If something can be DELETED but is not SHAPED, then the thing that only warns is not a superset of
// the thing that acts, and a slab could slip past both.
{
  const all = PREFIX.flatMap(p => TAILS.map(t => p + t));
  const gap = all.filter(n => MASTER.test(n) && !SHAPED.test(n));
  ok('anything the delete net matches, the warning net matches too', gap.length === 0, gap[0]);
  // It holds BY CONSTRUCTION now - MASTER is built from SHAPED.source - and the claim stays because
  // the thing it guards against is somebody writing the two independently again, which is how
  // `stone-author-main.zip` became deletable in the first place.
  ok('and the delete net is built FROM the warning net, not beside it',
     /SHAPED\.source/.test(SRC), dMASTER);
}

// ---- 3: neither net touches what else lives in that folder -----------------------------------------
{
  const BYSTANDERS = [
    'Baen01-HonorverseCD.zip', 'Baen13-The Best of Jim Baen\'s UniverseCD.zip',
    'PGSFCD-032007.zip', 'vipsdisp-x64-4.2.0-1.zip',
    'Glass Master Source-glass.json', 'Wood Master.json',
    'universal master all three materials.json',
    'screenshot.png', 'invoice-2024.pdf', 'stone.txt',
    'stone-author-main.zip',                     // a source download, not a master
  ];
  const hitM = BYSTANDERS.filter(n => MASTER.test(n));
  const hitS = BYSTANDERS.filter(n => SHAPED.test(n));
  ok('the delete net takes none of the folder\'s other files', hitM.length === 0, hitM.join(', '));
  ok('and the warning net does not cry about them either', hitS.length === 0, hitS.join(', '));
}

// ---- 4: THE FIX - an unknown slab is still SEEN ----------------------------------------------------
// This is claim 1's ablation and the point of the whole change: drop a prefix and its masters become
// undeletable, which is safe, AND still shaped, which is why they no longer vanish silently.
{
  const dropped = withPrefixes(PREFIX.filter(s => s !== PREFIX[2]));
  const name = PREFIX[2] + TAILS[0];
  ok('ABLATION dropping "' + PREFIX[2] + '" makes its master unmatched',
     !dropped.MASTER.test(name) && MASTER.test(name));
  ok('and the warning net catches it anyway - the failure now has a symptom',
     dropped.SHAPED.test(name));
  const slab = name.replace(dropped.SHAPED, '');
  ok('and names the slab to add, exactly', slab === PREFIX[2], JSON.stringify(slab));
}

// ---- 5: a typed name is not a pattern ---------------------------------------------------------------
{
  const odd = withPrefixes(['g.ass', 'glass (v2)']);
  ok('a prefix with a dot matches that dot literally', odd.MASTER.test('g.ass' + TAILS[0]));
  ok('and NOT the name it would match as a pattern', !odd.MASTER.test('glass' + TAILS[0]));
  ok('a prefix with brackets builds a valid regex at all', odd.MASTER.test('glass (v2)' + TAILS[0]));
  ok('ABLATION unescaped, the dot would have matched "glass"',
     new RegExp('^(g.ass)' + SHAPED.source, 'i').test('glass' + TAILS[0]));
}

// ---- 6: only the narrow net reaches the delete path -------------------------------------------------
// Structural, because there is no input that proves a negative here: every path that becomes a
// candidate for deletion must be pushed under a MASTER guard.
{
  const pushes = [...SRC.matchAll(/^.*\bout\.push\(/gm)].map(m => m[0]);
  ok('every candidate is pushed under a MASTER guard', pushes.length > 0 &&
     pushes.every(l => /MASTER\.test\(/.test(l)), pushes.length + ' push site(s): ' + pushes.join(' | '));
  const shapedUses = [...SRC.matchAll(/^.*\bSHAPED\.test\(/gm)].map(m => m[0]);
  ok('SHAPED is only ever tested on the way to a log line', shapedUses.length > 0 &&
     shapedUses.every(l => !/out\.push|unlinkSync|renameSync/.test(l)), shapedUses.join(' | '));
  ok('and the only delete in the file is still the one that was there',
     (SRC.match(/unlinkSync\(/g) || []).length === 1);
}

console.log('');
if (fails) { console.error('check-harvest-names: ' + fails + ' FAILED'); process.exit(1); }
console.log('check-harvest-names: the harvester matches the slabs this app writes, says so when it');
console.log('                     meets one it does not, and still deletes only what it recognises.');
