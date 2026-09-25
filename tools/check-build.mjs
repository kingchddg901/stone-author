// The build marker on screen must move whenever the app does.
//
// A version marker that lags is worse than no version marker: it states something untrue, and it does so
// exactly when someone is trying to work out which build produced a result. Cross-browser testing lives
// or dies on being able to say "Edge had this build" — so this fails the build if app/stone-author.html
// changed in this commit and BUILD did not.
//
// Needs history: the workflow checks out with fetch-depth 2.
//
//   node tools/check-build.mjs
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'app/stone-author.html';
const rx = /const BUILD = '([^']+)'/;

const here = rx.exec(readFileSync(join(root, APP), 'utf8'));
if (!here) { console.error(`no BUILD constant in ${APP}`); process.exit(1); }

let base = null;
try { base = execSync('git rev-parse HEAD~1', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
catch (_) { console.log(`build: ${here[1]} — no previous commit available, nothing to compare`); process.exit(0); }

const changed = execSync(`git diff --name-only ${base} HEAD`, { cwd: root }).toString().split('\n').map(s => s.trim());
if (!changed.includes(APP)) { console.log(`build: ${here[1]} — the app did not change in this commit`); process.exit(0); }

let before;
try { before = execSync(`git show ${base}:${APP}`, { cwd: root, maxBuffer: 1 << 28 }).toString(); }
catch (_) { console.log(`build: ${here[1]} — the app is new in this commit`); process.exit(0); }

const was = rx.exec(before);
if (was && was[1] === here[1]) {
  console.error(`${APP} changed but BUILD is still ${here[1]}.`);
  console.error('Bump it, or the version on screen will describe a build that no longer exists.');
  process.exit(1);
}
console.log(`build: ${was ? was[1] + ' -> ' : ''}${here[1]}`);
