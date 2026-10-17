// DOES THE EXPORT CLOCK MEASURE THE MACHINE, OR THE PERSON?
//
// The elapsed shown beside "Saved the render" is `Date.now() - expT0`. Three of the four places that
// read it sit straight after a NON-blocking save, so they measure work. The fourth sat after
// `resumeConfirmSaved` - the save-confirm modal, which by design waits for a human to come back and
// say the file arrived.
//
// The 1,048,576 master displayed 351:29 and recorded 300.5 min in its own metadata. Fifty-one minutes
// of a dialog sitting unattended, counted as render time, in the one number anybody reads off the
// screen. Nothing was wrong with the render and nothing in the file was wrong either - `ms.total` is
// captured up with the rest of the metadata, so the TIFF was honest while the UI was not. That is the
// worst shape a measurement bug can take: the artifact and the display disagree, and only the display
// is ever looked at.
//
// THE INVARIANT: between a human-blocking await and the done message that follows it, the clock must
// not be read inline. Capture it first, show it after.
//
//   node tools/check-export-clock.mjs
import { readFileSync } from 'fs';

const APP = new URL('../app/stone-author.html', import.meta.url);
const SRC = readFileSync(APP, 'utf8');

// Calls that hand control to a person and do not come back until they act.
const BLOCKING = ['resumeConfirmSaved(', 'bigDialog(', 'resumeDialog('];
const CLOCK = 'Date.now() - expT0';
const DONE = "TR('exp.done-";

let fails = 0;
const ok = (what, cond, got) => {
  if (!cond) { fails++; console.error('  FAIL  ' + what + (got === undefined ? '' : '   ' + got)); }
  else console.log('  ok    ' + what + (got === undefined ? '' : '   ' + got));
};

// Every (blocking await -> next done message) window, and whether the clock is read inside it.
function offenders(src) {
  const out = [];
  for (const call of BLOCKING) {
    for (let i = src.indexOf(call); i >= 0; i = src.indexOf(call, i + 1)) {
      const done = src.indexOf(DONE, i);
      if (done < 0) continue;
      // To the END of the done line, not to its start: the clock is read INSIDE the message,
      // so a window that stops at `TR('exp.done-` can never contain the thing it is looking for.
      const stop = src.indexOf("\n", done);
      const between = src.slice(i, stop < 0 ? done : stop);
      // Another blocking call in between means THAT one owns the window, not this one.
      if (BLOCKING.some(c => between.indexOf(c, call.length) >= 0)) continue;
      // And a function definition in between means they are not in the same function at all.
      // Without this, `resumeDialog` in the load-time resume OFFER paired with the PNG done
      // message 600 lines later and reported a defect that cannot happen - textual adjacency
      // is not control flow.
      if (/\n  (?:async )?function /.test(between)) continue;
      if (between.includes(CLOCK)) out.push({ call, line: src.slice(0, i).split('\n').length });
    }
  }
  return out;
}

// ---- the app as it stands ----------------------------------------------------------------------------
{
  const bad = offenders(SRC);
  ok('no done message reads the clock after a blocking dialog', bad.length === 0,
     bad.length ? bad.map(b => b.call + ' at line ' + b.line).join(', ') : 'all 4 done-render sites clean');
}

// ---- the check is not vacuous ------------------------------------------------------------------------
// A rename of the confirm, or of the message key, would make the scan above pass by finding nothing.
{
  const sites = BLOCKING.reduce((n, c) => n + SRC.split(c).length - 1, 0);
  ok('the blocking calls it guards still exist', sites >= 2, sites + ' call site(s)');
  ok('and the done messages still exist', SRC.split(DONE).length - 1 >= 2,
     (SRC.split(DONE).length - 1) + ' done message(s)');
  ok('the clock expression is still spelled the way this scan reads it', SRC.includes(CLOCK));
  ok('and the TIFF path still captures it BEFORE the confirm',
     /const msDone = Date\.now\(\) - expT0;\s*\n\s*await resumeConfirmSaved\(/.test(SRC));
}

// ---- ABLATION - put the defect back and require red --------------------------------------------------
// Without this, the pass above is a scan that has never been shown able to fail.
{
  const broken = SRC.replace(
    /const msDone = Date\.now\(\) - expT0;\s*\n(\s*)await resumeConfirmSaved\(blob\.size\);\s*\n\s*expStat\(TR\('exp\.done-render', \{ px: W, t: expElapsed\(msDone\) \}\), 1\);/,
    "$1await resumeConfirmSaved(blob.size);\n$1expStat(TR('exp.done-render', { px: W, t: expElapsed(Date.now() - expT0) }), 1);");
  ok('the ablation actually changed the source', broken !== SRC);
  const bad = offenders(broken);
  ok('and putting the defect back goes RED', bad.length === 1,
     bad.length ? bad[0].call + ' at line ' + bad[0].line : 'STILL CLEAN - this check cannot see the bug');
}

// ---- the other three sites are clean for a REASON, not by luck ---------------------------------------
// They read the clock after download()/saveBlob(), which return on dispatch. If one of those ever grows
// a confirm, the scan above catches it; this records why they are exempt today.
{
  // Only the DONE messages. expClock() reads it inline too and must - it is the running display.
  const n = (SRC.match(/exp\.done-[^\n]*expElapsed\(Date\.now\(\) - expT0\)/g) || []).length;
  ok('three done messages read the clock inline, each after a non-blocking save', n === 3,
     n + ' inline, plus expClock which ticks and must stay inline');
}

console.log('');
if (fails) { console.error('check-export-clock: ' + fails + ' FAILED'); process.exit(1); }
console.log('check-export-clock: the displayed elapsed measures the render, not the person reading');
console.log('                    the dialog. Screen and metadata agree.');
