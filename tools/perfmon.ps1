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
  [string]$Browser = ""          # chrome | firefox | msedge; empty = whichever of them is running
)

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
  return @{
    name      = $max.ProcessName
    procs     = $all.Count
    totalMB   = [math]::Round($sum / 1MB, 1)
    biggestMB = [math]::Round($max.WorkingSet64 / 1MB, 1)
    biggestPid = $max.Id
  }
}

Write-Output ("perfmon -> {0}   every {1} ms   (Ctrl+C to stop)" -f $Out, $IntervalMs)
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
  try {
    $g = (Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples
    $line.gpu3d  = [math]::Round((($g | Where-Object { $_.InstanceName -like '*engtype_3D*' } | Measure-Object -Property CookedValue -Sum).Sum), 1)
    $line.gpuAll = [math]::Round((($g | Measure-Object -Property CookedValue -Sum).Sum), 1)
  } catch { }
  try {
    $gm = (Get-Counter '\GPU Process Memory(*)\Local Usage' -ErrorAction Stop).CounterSamples
    $line.gpuMemMB = [math]::Round((($gm | Measure-Object -Property CookedValue -Sum).Sum) / 1MB, 0)
  } catch { }
  $b = Get-BrowserStats $Browser
  if ($b) { $line.browser = $b }
  $line.sampleMs = [math]::Round(((Get-Date) - $t0).TotalMilliseconds, 0)
  $json = ($line | ConvertTo-Json -Compress -Depth 4)
  [System.IO.File]::AppendAllText($Out, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding $false))
  $sleep = $IntervalMs - $line.sampleMs
  if ($sleep -gt 0) { Start-Sleep -Milliseconds $sleep }
}
