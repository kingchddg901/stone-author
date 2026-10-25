// A LINK IN A DOC POINTS AT A FILE, OR IT POINTS AT NOTHING AND NOBODY FINDS OUT.
//
// 119 relative links across 34 docs and not one thing checking them. They survived by luck: the
// first sweep that ever looked found every one of them live, which is a fact about the care taken
// rather than about the repository being safe. A path is exactly the kind of claim that rots
// quietly - check-fn-refs pins the LINE a function is declared on and re-pins it on every commit,
// and the file those lines live in had no such guard at all.
//
// It is also the error that prompted this. The claim "mkdocs --strict gates the links in CI" was
// made twice about a repository that has no mkdocs.yml, no mkdocs anywhere in .github, and four
// workflows none of which build the docs. The gate was imported from another project's memory and
// asserted without reading. So: the gate now exists, here, where it was said to be.
//
// WHAT IT DOES NOT CHECK, said plainly rather than left to look covered:
//   - http(s) targets. A network fetch in CI is a flaky gate, and a dead external link is a
//     different problem from a dead path.
//   - anchors. `file.md#section` is checked as far as `file.md`; whether that heading exists is
//     not read.
//   - images and link reference definitions, which this repo does not use in docs.
//
// CODE IS NOT PROSE, and the first version of this reported a dead link that did not exist:
// `PATTERNS[name](u)` inside backticks matches the markdown link pattern exactly. Fenced blocks and
// inline spans are blanked before anything is matched - blanked rather than removed, so the line
// numbers a failure reports still land where a person would look.
//
//   node tools/check-doc-links.mjs
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, relative, sep } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NL = String.fromCharCode(10);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.md$/i.test(e.name)) out.push(p);
  }
  return out;
}

// BLANKED, NOT REMOVED: a fenced block becomes the same number of blank lines and an inline span
// becomes spaces, so a reported line number is the line in the file.
function stripCode(text) {
  const lines = text.split(NL);
  let fenced = false;
  return lines.map(l => {
    if (/^\s*(```|~~~)/.test(l)) { fenced = !fenced; return ''; }
    if (fenced) return '';
    return l.replace(/`[^`]*`/g, m => ' '.repeat(m.length));
  }).join(NL);
}

const docs = walk(join(ROOT, 'docs'));
const fail = [];
let checked = 0, skipped = 0;

for (const file of docs) {
  const raw = readFileSync(file, 'utf8');
  const text = stripCode(raw);
  const lines = text.split(NL);
  for (let i = 0; i < lines.length; i++) {
    const re = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let m;
    while ((m = re.exec(lines[i]))) {
      const href = m[1];
      if (/^(https?:|mailto:|#|data:)/i.test(href)) { skipped++; continue; }
      checked++;
      const target = resolve(dirname(file), href.split('#')[0]);
      if (!existsSync(target)) {
        fail.push(`${relative(ROOT, file).split(sep).join('/')}:${i + 1}  ->  ${href}`);
        continue;
      }
      // A LINK TO A DIRECTORY resolves on disk and serves nothing, so it is not a pass.
      if (statSync(target).isDirectory() && !existsSync(join(target, 'README.md'))) {
        fail.push(`${relative(ROOT, file).split(sep).join('/')}:${i + 1}  ->  ${href} (a directory with no README.md)`);
      }
    }
  }
}

for (const f of fail) console.error('  DEAD  ' + f);
console.log('');
console.log(fail.length
  ? `doc-links: ${fail.length} dead of ${checked} relative link(s) across ${docs.length} docs.`
  : `doc-links: OK — ${checked} relative link(s) across ${docs.length} docs all resolve `
    + `(${skipped} external or anchor-only, not checked).`);
process.exit(fail.length ? 1 : 0);
