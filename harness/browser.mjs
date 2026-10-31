// LAUNCHING CHROMIUM, with the one failure this repo's own notes had recorded as unexplained.
//
// `node harness/*.mjs` died on every box where Playwright's own chromium will not start, and the
// error arrives with its name stripped off: a full `chrome.exe` declares a PRIVATE SIDE-BY-SIDE
// ASSEMBLY named after its own version, and when that assembly is absent CreateProcess fails with
// ERROR_SXS_CANT_GEN_ACTCTX. libuv has no errno for the side-by-side class, so it reports UNKNOWN and
// Playwright prints `browserType.launch: spawn UNKNOWN` — a perfectly specific Windows error wearing
// no name at all. The Application event log is where it is legible, id 33:
//
//     Activation context generation failed for ...chromium-1140/chrome-win/chrome.exe.
//     Dependent Assembly 130.0.6723.31 could not be found.
//
// Diagnosed 2026-10-31, each alternative ruled out by measuring it rather than reasoning about it:
//
//     node spawning node, and cmd.exe        both ok      so it is NOT the harness sandbox
//     84 files, 344.5 MB, chrome.dll 252 MB  complete     so the download is NOT partial
//     chrome-headless-shell, same cache dir  RUNS         so it is NOT antivirus or policy
//     revisions 1140 AND 1223                both fail    so it is NOT a stale install
//
// The shell starts because it is one self-contained binary with no such manifest. So: try what
// Playwright wants first, which is what CI gets and means CI never reaches the fallback, and on
// failure look for a headless shell in Playwright's own browser cache.
//
// IT NAMES THE BINARY IT USED, every time, because a number measured on an unexpected browser is a
// silent confound and this file exists because a browser silently would not start. Set SA_CHROMIUM to
// an executable to force one.
//
// harness/engines.mjs IS DELIBERATELY NOT WIRED TO THIS. It compares engine builds against the
// numbers in docs/final-render.md, so there the browser's identity IS the measurement and quietly
// substituting a different Blink would produce numbers that look comparable and are not.
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

const WIN = platform() === 'win32';
const SHELL_EXE = WIN ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';

// Where Playwright keeps browsers, in the order it looks itself.
function cacheDirs() {
  const out = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) out.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  if (WIN && process.env.LOCALAPPDATA) out.push(join(process.env.LOCALAPPDATA, 'ms-playwright'));
  else if (platform() === 'darwin') out.push(join(homedir(), 'Library', 'Caches', 'ms-playwright'));
  else out.push(join(homedir(), '.cache', 'ms-playwright'));
  return out.filter(d => { try { return existsSync(d); } catch { return false; } });
}

// The newest headless shell on this machine, BY REVISION rather than by directory order, so a box
// carrying several installs gets the one closest to current.
function findShell() {
  const forced = process.env.SA_CHROMIUM;
  if (forced) return existsSync(forced) ? forced : null;
  const found = [];
  for (const dir of cacheDirs()) {
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const m = /^chromium_headless_shell-(\d+)$/.exec(name);
      if (!m) continue;
      let subs = [];
      try { subs = readdirSync(join(dir, name)); } catch { continue; }
      for (const sub of subs) {
        const exe = join(dir, name, sub, SHELL_EXE);
        if (existsSync(exe)) found.push({ rev: Number(m[1]), exe });
      }
    }
  }
  found.sort((a, b) => b.rev - a.rev);
  return found.length ? found[0].exe : null;
}

const firstLine = s => String(s).split('\n').find(l => l.trim()) || String(s);
let announced = '';
const announce = s => { if (announced !== s) { announced = s; console.log(s); } };

export async function launchChromium(opts = {}) {
  try {
    const b = await chromium.launch(opts);
    announce('browser: playwright chromium ' + b.version());
    return b;
  } catch (e) {
    const why = firstLine(e.message);
    const shell = findShell();
    if (!shell) {
      throw new Error("playwright's chromium would not launch (" + why + ') and no '
        + 'chrome-headless-shell was found in its browser cache. Run `npx playwright install '
        + 'chromium` (which fetches the shell alongside the browser), or point SA_CHROMIUM at a '
        + 'chromium executable.');
    }
    const b = await chromium.launch({ ...opts, executablePath: shell });
    announce('browser: FALLBACK ' + b.version() + ' at ' + shell
             + '\n         because playwright chromium said: ' + why);
    return b;
  }
}
