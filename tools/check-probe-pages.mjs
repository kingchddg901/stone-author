// DO THE PROBE PAGES STILL PARSE?
//
// `check-build` syntax-checks the app's inline script and stops there, so every HTML page under
// tools/ - the port harness, the tile probe, the recorded-unwarp pages - has been unchecked since
// they were written. They are opened by hand, rarely, and a break in one is found by whoever opens
// it next.
//
// THIS GATE EXISTS BECAUSE THAT HAPPENED. A string in gpu-port-harness was generated through a
// Python patch where `\\n` became a REAL newline rather than the two-character escape, so a JS string
// literal spanned a line break. Valid-looking in a diff, a SyntaxError at line 319, and the person
// who found it was Chris opening the page I had just told him to open.
//
// WHAT IT HAS TO PROVE:
//   1  every inline script in every tools/*.html parses, as a module
//   2  and the check can tell - a page with a deliberate break must be rejected
//
//   node tools/check-probe-pages.mjs
import { readdirSync, readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

const DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const tmp = mkdtempSync(join(tmpdir(), 'sa-probe-'));
let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('  ok    ' + name); return; }
  fails++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

// parses? returns null when it does, the first line of the error when it does not
function parses(src, tag) {
  const f = join(tmp, tag + '.mjs');
  writeFileSync(f, src);
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  unlinkSync(f);
  if (r.status === 0) return null;
  const line = (r.stderr || '').split('\n').find(l => /SyntaxError|Error:/.test(l));
  return line ? line.trim() : 'exit ' + r.status;
}

const pages = readdirSync(DIR).filter(f => f.endsWith('.html')).sort();
ok('there are probe pages to check', pages.length > 0, pages.length + ' found');

let blocks = 0;
for (const page of pages) {
  const html = readFileSync(join(DIR, page), 'utf8');
  const found = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  // a <script src=...> has no body to check
  const inline = found.filter(m => m[2].trim().length > 0);
  for (let i = 0; i < inline.length; i++) {
    blocks++;
    const err = parses(inline[i][2], page.replace(/\W+/g, '_') + '_' + i);
    ok(page + (inline.length > 1 ? ' [' + i + ']' : '') + ' parses', err === null, err);
  }
}
ok('and it actually looked at some script', blocks > 0, blocks + ' block(s)');

// ---- the ablation: a page with a real break must be caught -------------------------------------------
// THE EXACT SHAPE THAT GOT THROUGH: a string literal broken across a line, which is what `\\n`
// becoming a newline produces. If this gate cannot see that, it is decoration.
{
  const broken = "const a = '  OUT[0] = f();'\n          + '\n  OUT[1] = 0.0;';\n";
  ok('ABLATION a string literal split across a line is rejected', parses(broken, 'ablate') !== null);
  const whole = "const a = '  OUT[0] = f();'\n          + '  OUT[1] = 0.0;';\n";
  ok('and the same text unbroken is accepted', parses(whole, 'ablate2') === null);
}

// ---- AND NO INVISIBLE CHARACTERS IN THE TOOLS THEMSELVES ---------------------------------------------
// FOUR TIMES in one day a generated escape arrived as a control character instead of two visible ones.
// Python reads a lone backslash-b as BACKSPACE and converts it silently - only backslash-s warns - so a
// regex ships as /<0x08>S[.]/ which PARSES, RUNS, MATCHES NOTHING and reports green. A dead check is
// worse than a missing one, because the missing one is at least visible as missing.
//
// Nothing legitimate in this directory needs a character below space except tab, newline and return.
{
  const names = readdirSync(DIR).filter(f => f.endsWith(".mjs") || f.endsWith(".html"));
  const dirty = [];
  for (const f of names) {
    const src = readFileSync(join(DIR, f), "utf8");
    for (let i = 0; i < src.length; i++) {
      const c = src.charCodeAt(i);
      if (c < 9 || (c > 13 && c < 32)) { dirty.push(f + " at " + i + " (0x" + c.toString(16) + ")"); break; }
    }
  }
  ok(names.length + " tool file(s) carry no control character", dirty.length === 0, dirty.join("; "));
  // ABLATION: the exact shape that got through, four times
  const bs = "const re = /" + String.fromCharCode(8) + "S[.]/;";
  let seen = false;
  for (let i = 0; i < bs.length; i++) { const c = bs.charCodeAt(i); if (c < 9 || (c > 13 && c < 32)) seen = true; }
  ok("ABLATION a backspace inside a regex is seen", seen);
}

console.log('');
if (fails) { console.error('check-probe-pages: ' + fails + ' FAILED'); process.exit(1); }
console.log('check-probe-pages: ' + blocks + ' inline script(s) across ' + pages.length +
            ' page(s) parse.');
