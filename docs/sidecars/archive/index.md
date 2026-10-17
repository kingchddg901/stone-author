# Masters, as they describe themselves

Extracted from each master by `findMeta` in `tools/tiff-meta.mjs`, written by
`tools/meta-index.mjs`. `index.json` is the source of truth; this table is a view of it.
The masters themselves are not published — render the slab yourself and compare.

```
file                                            width   light  lit>40  spectrum          engine    rule    lift  from  bleed   tile    inputs           build
---------------------------------------------  ------  ------  ------  --------  --------------  ------  ------  ----  -----  -----  --------  --------------
stone-1024-uv-android-chrome-0926-164517.tif     1024       -       -     black               -       -       -     -     13   1024         -               -
regression test-1024-uv-win-chrome-1017-003930.tif    1024   53.30   40.95     black      win-chrome   blink       0  auto      4    512  95ef95fe  2026.10.17.130
stone-1024-uv-win-chrome-1001-024343.png         1024   60.58   51.66     black      win-chrome       -       0   set      -      -  a98ab1f5    2026.09.30.1
stone-1024-uv-win-chrome-1001-024358.tif         1024   53.31   40.96     black      win-chrome   blink       0  auto      4    512  a98ab1f5    2026.09.30.1
stone-1024-day-win-chrome-1017-000430.tif        1024  229.52  100.00  daylight      win-chrome       -       -     -      4    512  36751256  2026.10.17.128
stone-1024-day-win-chrome-1017-001238.tif        1024  229.52  100.00  daylight      win-chrome       -       -     -      4    512  36751256  2026.10.17.129
stone-1024-day-win-chrome-1017-001601.tif        1024  229.52  100.00  daylight      win-chrome       -       -     -      4    512  36751256  2026.10.17.129
stone-1024-day-win-chrome-1017-001745.tif        1024  229.52  100.00  daylight      win-chrome       -       -     -      4    512  36751256  2026.10.17.130
stone-2048-uv-android-chrome-0926-164530.tif     2048       -       -     black               -       -       -     -     25   2048         -               -
regression test-2048-uv-win-chrome-1017-003923.tif    2048   53.30   40.48     black      win-chrome   blink       0  auto      4   1024  95ef95fe  2026.10.17.130
glass-2048-day-win-chrome-1011-131252.tif        2048  175.85  100.00  daylight      win-chrome       -       -     -      4   2048  2c1563e3   2026.10.11.29
glass-2048-day-win-chrome-1011-131306.png        2048  143.76  100.00  daylight      win-chrome       -       -     -      -      -  2c1563e3   2026.10.11.29
stone-4096-uv-android-chrome-0926-164540.tif     4096       -       -     black               -       -       -     -     50   2048         -               -
regression test-4096-uv-win-chrome-1017-003912.tif    4096   53.17   39.88     black      win-chrome   blink       0  auto      4   2048  95ef95fe  2026.10.17.130
diagnostic-8192-records-deviceMemory.tif         8192       -       -     black               -       -       -     -     99   2048  a98ab1f5               -
stone-8192-uv-android-chrome-0926-164602.tif     8192       -       -     black               -       -       -     -     99   2048         -               -
iPhone wood test-8192-uv-win-chrome-1015-174016.png    8192   62.19   54.54     black      win-chrome       -   0.015   set      -      -  95ef95fe   2026.10.15.83
regression test-8192-uv-win-chrome-1016-235936.tif    8192   53.37   39.95     black      win-chrome   blink   0.015  auto      4   4096  95ef95fe  2026.10.16.127
regression test-8192-uv-win-chrome-1016-235952.tif    8192   53.37   39.95     black      win-chrome   blink   0.015  auto      4   4096  95ef95fe  2026.10.16.127
regression test-8192-uv-win-chrome-1017-000146.tif    8192   53.37   39.95     black      win-chrome   blink   0.015  auto      4   4096  95ef95fe  2026.10.16.127
regression test-8192-uv-win-chrome-1017-003900.tif    8192   53.37   39.95     black      win-chrome   blink   0.015  auto      4   4096  95ef95fe  2026.10.17.130
stone-8192-day-android-chrome-0926-142815.tif    8192       -       -  daylight               -       -       -     -     99   4096  2259e26a               -
stone-16384-uv-android-chrome-0926-164703.tif   16384       -       -     black               -       -       -     -    197   2048         -               -
regression test-16384-uv-win-chrome-1017-003847.tif   16384   60.91   50.60     black      win-chrome   blink     0.1  auto      4   4096  95ef95fe  2026.10.17.130
glass-16384-day-win-chrome-1011-131734.png      16384  143.81  100.00  daylight      win-chrome       -       -     -      -      -  2c1563e3   2026.10.11.29
regression test-16384-day-win-chrome-1015-233757.tif   16384   43.98   32.87  daylight      win-chrome       -       -     -      4   8192  1e3cc661   2026.10.16.99
regression test-16384-day-win-chrome-1015-233941.tif   16384   43.98   32.87  daylight      win-chrome       -       -     -      4   8192  1e3cc661  BROKEN-RESUME-DO-NOT-DEPLOY
stone-20480-uv-android-chrome-0926-164834.tif   20480       -       -     black               -       -       -     -    246   2048         -               -
regression test-20480-uv-win-chrome-1017-003829.tif   20480   59.46   48.11     black      win-chrome   blink   0.143  auto      4   8192  95ef95fe  2026.10.17.130
stone-24576-uv-android-chrome-0926-165037.tif   24576       -       -     black               -       -       -     -    295   2048         -               -
regression test-24576-uv-win-chrome-1017-003801.tif   24576   61.41   50.91     black      win-chrome   blink   0.186  auto      4   4096  95ef95fe  2026.10.17.130
stone-32768-uv-android-chrome-0926-165357.tif   32768       -       -     black               -       -       -     -    394   2048         -               -
iPhone wood test-32768-uv-win-chrome-1015-174239.tif   32768   64.00   56.16     black      win-chrome   blink   0.271  auto      4   2048  95ef95fe   2026.10.15.83
iPhone wood test-32768-uv-win-chrome-1015-221514.tif   32768   61.33   50.21     black      win-chrome   blink   0.271  auto      4   2048  95ef95fe   2026.10.16.89
iPhone wood test-32768-uv-win-chrome-1015-222012.tif   32768   61.33   50.21     black      win-chrome   blink   0.271  auto      4   2048  95ef95fe   2026.10.16.89
iPhone wood test-32768-uv-win-chrome-1015-222634.tif   32768   61.33   50.21     black      win-chrome   blink   0.271  auto      4   2048  95ef95fe   2026.10.16.89
regression test-32768-uv-win-chrome-1015-223318.tif   32768   61.34   50.20     black      win-chrome   blink   0.271  auto      4   4096  95ef95fe   2026.10.15.83
regression test-32768-uv-win-chrome-1015-223419.tif   32768   61.34   50.20     black      win-chrome   blink   0.271  auto      4   4096  95ef95fe   2026.10.16.89
regression test-32768-uv-win-chrome-1015-225342.tif   32768   61.33   50.21     black      win-chrome   blink   0.271  auto      4   2048  95ef95fe   2026.10.16.92
regression test-32768-uv-win-chrome-1015-225742.tif   32768   61.33   50.21     black      win-chrome   blink   0.271  auto      4   2048  95ef95fe   2026.10.16.93
regression test-32768-uv-win-chrome-1015-225949.tif   32768   61.33   50.21     black      win-chrome   blink   0.271  auto      4   2048  95ef95fe   2026.10.16.92
regression test-32768-uv-win-chrome-1017-003731.tif   32768   61.34   50.20     black      win-chrome   blink   0.271  auto      4   4096  95ef95fe  2026.10.17.130
stone-32768-uv-win-chrome-1015-201827.tif       32768   61.35   50.23     black      win-chrome   blink   0.271  auto      4   4096  65724e44   2026.10.16.89
iPhone wood test-32768-day-win-chrome-1015-221732.tif   32768   46.24   35.78  daylight      win-chrome       -       -     -      4   4096  1e3cc661   2026.10.16.89
iPhone wood test-32768-day-win-chrome-1015-221934.tif   32768   46.24   35.78  daylight      win-chrome       -       -     -      4   4096  1e3cc661   2026.10.16.89
regression test-32768-day-win-chrome-1015-232221.tif   32768   45.34   35.28  daylight      win-chrome       -       -     -      4   4096  d819c613   2026.10.16.97
regression test-32768-day-win-chrome-1015-232606.tif   32768   45.34   35.28  daylight      win-chrome       -       -     -      4   4096  d819c613   2026.10.16.99
regression test-32768-day-win-chrome-1015-233715.tif   32768   46.24   35.78  daylight      win-chrome       -       -     -      4   4096  1e3cc661  BROKEN-RESUME-DO-NOT-DEPLOY
regression test-32768-day-win-chrome-1015-234425.tif   32768   46.24   35.78  daylight      win-chrome       -       -     -      4   4096  1e3cc661  BROKEN-RESUME-DO-NOT-DEPLOY
regression test-32768-day-win-chrome-1015-234512.tif   32768   46.24   35.78  daylight      win-chrome       -       -     -      4   4096  1e3cc661   2026.10.16.99
regression test-32768-day-win-chrome-1016-003248.tif   32768   46.24   35.78  daylight      win-chrome       -       -     -      4   4096  1e3cc661  2026.10.16.104
stone-32768-day-win-chrome-1001-025803.tif      32768   45.03   34.96  daylight      win-chrome       -       -     -      4   4096  2259e26a    2026.09.30.1
stone-32768-day-win-chrome-1015-202408.tif      32768   45.03   34.96  daylight      win-chrome       -       -     -      4   8192  eea11ddb   2026.10.16.89
DEGRADED-65535-uv-2048tiles.tif                 65535       -       -     black               -       -       -     -    787   2048         -               -
stone-65535-uv-android-chrome-0926-171334.tif   65535       -       -     black               -       -       -     -    787   4096  a98ab1f5               -
stone-65535-uv-android-firefox-0926-170549.tif   65535       -       -     black               -       -       -     -    787   8192  a98ab1f5               -
stone-65535-uv-ios-safari-0926-142059.tif       65535       -       -     black               -       -       -     -    787   4096  a98ab1f5               -
stone-65535-uv-linux-chrome-0926-153019.tif     65535       -       -     black               -       -       -     -    787   8192  a98ab1f5               -
stone-65535-uv-win-chrome-0926-153033.tif       65535       -       -     black               -       -       -     -    787   8192  a98ab1f5               -
stone-65535-uv-win-firefox-0926-150619.tif      65535       -       -     black               -       -       -     -    787   8192  a98ab1f5               -
regression test-65535-uv-win-chrome-1017-003654.tif   65535   61.48   46.98     black      win-chrome   blink   0.612  auto      4   4096  95ef95fe  2026.10.17.130
stone-65535-uv-win-chrome-1001-024652.tif       65535   61.50   47.00     black      win-chrome   blink   0.612  auto      4   8192  a98ab1f5    2026.09.30.1
stone-65535-uv-win-chrome-1001-025637.tif       65535   61.50   47.00     black      win-chrome   blink   0.612  auto      4   8192  a98ab1f5    2026.09.30.1
stone-65535-uv-win-chrome-1001-030725.tif       65535   40.35   37.35     black      win-chrome   blink   0.612  auto    427   4096  48f6b300    2026.09.30.1
stone-65535-uv-win-chrome-1009-001522.tif       65535   41.30   39.72     black      win-chrome   blink   0.612  auto    427   4096  3d7798a0    2026.10.01.1
stone-65535-uv-win-chrome-1015-202126.tif       65535   61.50   47.00     black      win-chrome   blink   0.612  auto      4   2048  65724e44   2026.10.16.89
stone-65535-day-android-chrome-0926-161157.tif   65535       -       -  daylight               -       -       -     -    787   2048         -               -
stone-65535-day-android-chrome-0926-161931.tif   65535       -       -  daylight               -       -       -     -    787   4096  2259e26a               -
stone-65535-day-android-firefox-0926-165706.tif   65535       -       -  daylight               -       -       -     -    787   8192  2259e26a               -
stone-65535-day-ios-safari-0926-141847.tif      65535       -       -  daylight               -       -       -     -    787   4096  2259e26a               -
stone-65535-day-linux-chrome-0926-152456.tif    65535       -       -  daylight               -       -       -     -    787   8192  2259e26a               -
stone-65535-day-win-chrome-0926-152650.tif      65535       -       -  daylight               -       -       -     -    787   8192  2259e26a               -
stone-65535-day-win-firefox-0926-145433.tif     65535       -       -  daylight               -       -       -     -    787   8192  2259e26a               -
glass-65535-day-win-chrome-1011-135512.tif      65535  143.81  100.00  daylight      win-chrome       -       -     -      4   4096  2c1563e3   2026.10.11.29
stone-65535-day-win-chrome-1001-030401.tif      65535   69.03   83.43  daylight      win-chrome       -       -     -    427   4096  c325e09f    2026.09.30.1
stone-65535-day-win-chrome-1010-123817.tif      65535   69.18  100.00  daylight      win-chrome       -       -     -      4   4096  e7e5547b   2026.10.10.18
tree-65535-day-win-chrome-1010-180116.tif       65535   39.97   39.54  daylight      win-chrome       -       -     -      4   2048  c931363e   2026.10.10.51
regression test-131072-uv-win-chrome-1017-003508.tif  131072   60.18   40.43     black      win-chrome   blink       1  auto      4   4096  95ef95fe  2026.10.17.130
glass-131072-day-win-chrome-1011-203108.tif    131072  143.80  100.00  daylight      win-chrome       -       -     -      4   4096  8c6d6582   2026.10.11.39
iPhone wood test-262144-uv-win-chrome-1015-180638.tif  262144   55.89   33.86     black      win-chrome   blink       1  auto      4   2048  95ef95fe   2026.10.15.83
regression test-262144-uv-win-chrome-1016-144508.tif  262144   55.88   33.84     black      win-chrome   blink       1  auto      4   2048  95ef95fe  2026.10.16.119
iPhone wood test on s23-262144-day-android-chrome-1015-084911.tif  262144   52.84   98.77  daylight  android-chrome       -       -     -      4   1024  8cef8303   2026.10.15.83
stone-262144-day-android-chrome-1015-043639.tif  262144   53.17  100.00  daylight  android-chrome       -       -     -      4   1024  a5bb7b48   2026.10.14.82
iPhone wood test-262144-day-ios-safari-1014-225800.tif  262144   52.84   98.77  daylight      ios-safari       -       -     -      4    512  8cef8303   2026.10.14.82
iPhone wood test-262144-day-ios-safari-1015-002415.tif  262144   52.84   98.77  daylight      ios-safari       -       -     -      4    512  8cef8303   2026.10.14.82
glass-262144-day-win-chrome-1012-003012-signed.tif  262144  143.80  100.00  daylight      win-chrome       -       -     -      4   4096  8c6d6582   2026.10.11.42
glass-262144-day-win-chrome-1012-003012.tif    262144  143.80  100.00  daylight      win-chrome       -       -     -      4   4096  8c6d6582   2026.10.11.42
iPhone wood test-262144-day-win-chrome-1014-235042.tif  262144   52.84   98.77  daylight      win-chrome       -       -     -      4    512  8cef8303   2026.10.14.82
regression test-524288-uv-win-chrome-1016-173730.tif  524288   53.09   30.08     black      win-chrome   blink       1  auto      4   4096  95ef95fe  2026.10.16.124
regression test-1048576-uv-win-chrome-1016-225553.tif  1048576   51.53   28.04     black      win-chrome   blink       1  auto      4   8192  95ef95fe  2026.10.16.127
```

## Proven to run on

Hardware CLASS, in the clear on every master. The device identity is sealed and is not here.

```
device                                engine   cores   mem GB      dpr   maxTexture   masters    largest                render tiles
--------------------------  ----------------  ------  -------  -------  -----------  --------  ---------  --------------------------
(unmapped)                    android-chrome       4        2    1.331         4096         1     262144                        1024
(unmapped)                    android-chrome       8        8    2.000         8192         1     262144                        1024
(unmapped)                        ios-safari       4        -    3.000        16384         2     262144                         512
(unmapped)                        win-chrome      12       16    1.000                      3      16384                            
(unmapped)                        win-chrome      12       16    1.000        16384        13      65535       512, 2048, 4096, 8192
(unmapped)                        win-chrome      12       16    1.125                      1       8192                            
(unmapped)                        win-chrome      12       16    1.125        16384         9     262144                  2048, 4096
(unmapped)                        win-chrome      12       16    1.200        16384         4     262144                  2048, 4096
(unmapped)                        win-chrome      12       16    1.350        16384         3      32768                  2048, 4096
(unmapped)                        win-chrome      12       16    1.500        16384        29    1048576  512, 1024, 2048, 4096, 8192

distinct hardware classes: 10
```
