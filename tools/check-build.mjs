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
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'app/stone-author.html';
const rx = /const BUILD = '([^']+)'/;

const src = readFileSync(join(root, APP), 'utf8');
const here = rx.exec(src);
if (!here) { console.error(`no BUILD constant in ${APP}`); process.exit(1); }

// AND THE SCRIPT HAS TO PARSE. `node --check` cannot be pointed at a .html file at all - it rejects the
// extension before reading a byte - so for the whole life of this repo the app's only syntax check was
// the browser harness in CI, which runs after a push. That gap shipped a string literal broken across
// two lines while every local gate stayed green and the app would not load at all.
//
// So pull the inline scripts out and hand them to the real parser. Cheap, and it fails on the commit
// instead of on a phone. There is deliberately no backslash anywhere below: the defect this catches was
// made by a generator rewriting an escape, and a gate written with escapes would have the same hole. The
// closing tag's slash is a character class, the separator is fromCharCode, and stderr is sliced not split.
const NL = String.fromCharCode(10);
const blocks = [...src.matchAll(/<script(?![^>]*src=)[^>]*>(.*?)<[/]script>/gs)].map(m => m[1]);
if (!blocks.length) {
  console.error(`${APP} has no inline script: the extractor is broken, not the app.`);
  process.exit(1);
}
const js = join(tmpdir(), 'sa-syntax-' + process.pid + '.js');
writeFileSync(js, blocks.join(NL));
try {
  execSync(`node --check "${js}"`, { stdio: 'pipe' });
} catch (e) {
  console.error(`${APP}: the inline script does not parse.`);
  console.error(String(e.stderr || e.stdout || e.message).slice(0, 500));
  process.exit(1);
} finally {
  try { unlinkSync(js); } catch (_) {}
}
console.log(`syntax: the inline script parses (${blocks.length} block(s), ${blocks.join('').length} chars)`);



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
