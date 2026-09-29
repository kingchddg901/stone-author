# SAMPLE WHAT THE MACHINE IS DOING, so a render's per-tile timings can be read against it.
#
# A master records perTile.ms - 10,240 durations for a 512 tile - and that array says WHEN a tile was
# slow but never WHY. One tile on an S23 took 38 seconds against a 52 ms median; nothing in the file can
# say whether that was a GC pause, a thermal step, the disk, or another program. This writes a timestamped
# trace alongside, and tools/perf-align.mjs lines the two up afterwards.
#
# Windows only: it reads performance counters through Get-Counter. One JSON object per line, appended with
# a .NET no-BOM writer, because Out-File -Encoding utf8 on PS 5.1 prefixes a BOM to EVERY append and the
# resulting file is not JSONL any parser will read. One JSON object per line, appended, so
# a kill at any point leaves a readable file.
#
#   powershell -File tools/perfmon.ps1 -Out perf.jsonl
#   powershell -File tools/perfmon.ps1 -Out perf.jsonl -IntervalMs 500 -Browser firefox
param(
  [string]$Out = "perf.jsonl",
  [int]$IntervalMs = 1000,
  [string]$Browser = "",         # chrome | firefox | msedge; empty = whichever of them is running
  [switch]$Gpu,                  # GPU engine + memory counters. OFF by default: see below.
  [switch]$Force                 # overwrite an existing trace instead of refusing
)

# -Gpu IS OFF BY DEFAULT BECAUSE IT COSTS MORE THAN THE INTERVAL. \GPU Engine(*) enumerates every
# engine instance of every process on the machine, and at four concurrent Chrome renders one sample
# took 3,979 ms against a requested 3,000 - so the sampler ran flat out with no gap at all and its
# own cost rose with the load it was measuring. Turn it on when the GPU is the question and you can
# afford a coarse trace; leave it off when you want dependable spacing under heavy load.

$ErrorActionPreference = "Continue"
$names = @(
  '\Processor(_Total)\% Processor Time',
  '\Memory\Available MBytes',
  '\PhysicalDisk(_Total)\Disk Write Bytes/sec',
  '\Paging File(_Total)\% Usage'
)

function Get-BrowserStats([string]$want) {
  $candidates = if ($want) { @($want) } else { @('chrome', 'firefox', 'msedge') }
  $all = @()
  foreach ($c in $candidates) {
    $p = Get-Process -Name $c -ErrorAction SilentlyContinue
    if ($p) { $all += $p }
  }
  if (-not $all) { return $null }
  $sum = ($all | Measure-Object -Property WorkingSet64 -Sum).Sum
  $max = ($all | Sort-Object WorkingSet64 -Descending | Select-Object -First 1)
  # PER-PROCESS, not just the sum. Chrome's own task manager (Shift+Esc) does this properly and
  # labels each row by tab; Get-Process cannot see a tab title, so this is the nearest thing from
  # outside. It matters because the sum cannot answer the question a multi-render run asks - does
  # EACH render hold its own ~60 MB, or is one process holding all of it. With N renders in N
  # windows the N heaviest renderers are the N renders, so the top slice is readable as per-render.
  $top = @($all | Sort-Object WorkingSet64 -Descending | Select-Object -First 12 |
    ForEach-Object { @{ pid = $_.Id; mb = [math]::Round($_.WorkingSet64 / 1MB, 1) } })
  return @{
    name      = $max.ProcessName
    procs     = $all.Count
    totalMB   = [math]::Round($sum / 1MB, 1)
    biggestMB = [math]::Round($max.WorkingSet64 / 1MB, 1)
    biggestPid = $max.Id
    top       = $top
  }
}

if ((Test-Path $Out) -and -not $Force) {
  Write-Output ("REFUSING: {0} already exists. A trace is raw measured data and the run it describes" -f $Out)
  Write-Output  "is over, so it cannot be regenerated. Pass -Force to overwrite, or choose another name."
  exit 2
}
Write-Output ("perfmon -> {0}   every {1} ms   gpu {2}   (Ctrl+C to stop)" -f $Out, $IntervalMs, $(if ($Gpu) { "on" } else { "off" }))
if (Test-Path $Out) { Remove-Item $Out }

while ($true) {
  $t0 = Get-Date
  $line = @{ t = $t0.ToUniversalTime().ToString("o") }
  try {
    $s = (Get-Counter -Counter $names -ErrorAction Stop).CounterSamples
    $line.cpu       = [math]::Round($s[0].CookedValue, 1)
    $line.availMB   = [math]::Round($s[1].CookedValue, 0)
    $line.diskWrMBs = [math]::Round($s[2].CookedValue / 1MB, 2)
    $line.pagePct   = [math]::Round($s[3].CookedValue, 2)
  } catch { $line.counterError = $_.Exception.Message }
  # GPU: 3D engine across every process, and the total across all engine types.
  if ($Gpu) {
  try {
    $g = (Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples
    $line.gpu3d  = [math]::Round((($g | Where-Object { $_.InstanceName -like '*engtype_3D*' } | Measure-Object -Property CookedValue -Sum).Sum), 1)
    $line.gpuAll = [math]::Round((($g | Measure-Object -Property CookedValue -Sum).Sum), 1)
  } catch { }
  try {
    $gm = (Get-Counter '\GPU Process Memory(*)\Local Usage' -ErrorAction Stop).CounterSamples
    $line.gpuMemMB = [math]::Round((($gm | Measure-Object -Property CookedValue -Sum).Sum) / 1MB, 0)
  } catch { }
  }
  $b = Get-BrowserStats $Browser
  if ($b) { $line.browser = $b }
  $line.sampleMs = [math]::Round(((Get-Date) - $t0).TotalMilliseconds, 0)
  $sleep = $IntervalMs - $line.sampleMs
  if ($sleep -le 0) { $line.overran = $true }
  $json = ($line | ConvertTo-Json -Compress -Depth 4)
  [System.IO.File]::AppendAllText($Out, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding $false))
  if ($sleep -gt 0) { Start-Sleep -Milliseconds $sleep }
}
