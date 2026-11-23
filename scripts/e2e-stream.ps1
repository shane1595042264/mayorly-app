# End-to-end: a League streamer dies in Chrome, and the desk switches.
#
# The stream rule lives where no unit test reaches: the Mayorly extension's content script on a
# stream site, its service worker posting to the app on 127.0.0.1, the app arming it only while the
# watched couch item runs, the detector on real frames from a real <video>, and the switch on the
# desk. This starts the built app in a profile of its own (MAYORLY_DATA_DIR) on the couch item
# "Stream watch" (rule: Kai'sa dies), having come from the task alpha; serves a pretend Twitch
# page (scripts/e2e-stream.html, as https://www.twitch.tv/e2e) and opens it in Chrome for Testing
# with the extension the app wrote to ~/.mayorly/chrome-extension. The page shows a League stream
# with a break card, a slow fade and an ad painted as a death, none of which may switch, then a death at 100 s, which
# must, once, and mute the page's video within a few seconds, through its Twitch mute button. A
# second run plays a League match of your own first (a listener on 127.0.0.1:2999, as the game's
# Live Client Data API): then the death must not switch, nor mute. A third plays GTA (the page names
# Grand Theft Auto VI): a black and white beat and FAILED on the red wash must not switch; WASTED at
# 50 s must, once, and mute. A fourth plays an ad break at 20 s with Twitch's banner: the ad rule
# must switch, once, mute, and say when the break is over. The first three keep the ad rule off
# (their ad is no death). A fifth, with no Chrome, starts a match of yours on a save with a couch
# item named League of Legends: the desk must go onto it from Stream watch, once, within seconds.
#
# CI runs it on a Windows runner (.github/workflows/ci.yml, job stream), never on anyone's own
# computer. It takes about eight minutes.
#   npm run build
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-stream.ps1 -Chrome <chrome.exe> [-Out result.json]
param(
  [string]$App = '',
  [string]$Chrome = '',
  [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell leaves $PSScriptRoot empty in a parameter's default, so the folder is found here.
if (-not $App) { $App = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
if (-not $Chrome -or -not (Test-Path $Chrome)) { throw "No Chrome at '$Chrome': pass -Chrome <chrome.exe>." }
$t0 = Get-Date
$result = [ordered]@{ ok = $false; runs = @(); error = $null; log = @() }
$electron = Join-Path $App 'node_modules\electron\dist\electron.exe'
# The extension the app writes at launch, which every Chrome run loads.
$ext = Join-Path $HOME '.mayorly\chrome-extension'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("mayorly-stream-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $tmp | Out-Null
$server = $null
$cert = $null
$fake = $null

function Epoch([datetime]$d) { [int64](($d.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds) }
function Stop-Mine([string]$name, [string]$under) {
  $mine = @(Get-CimInstance Win32_Process -Filter "Name='$name'" | Where-Object { $_.ExecutablePath -like "$under*" -and $_.CreationDate -ge $t0 })
  foreach ($p in $mine) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  foreach ($p in $mine) { Wait-Process -Id $p.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }
}
# Log lines as (time, text), the time read from the line's own ISO stamp.
function Log-Lines([string]$log) {
  if (-not (Test-Path $log)) { return @() }
  @(Get-Content $log | ForEach-Object {
      if ($_ -match '^(\S+Z)\s+\w+\s+(.*)$') { [pscustomobject]@{ at = [datetime]::Parse($Matches[1]).ToUniversalTime(); text = $Matches[2] } }
    })
}

# A pretend League match of yours: what the game serves while a match is loaded, a listener on
# 127.0.0.1:2999 (its Live Client Data API), which is how Mayorly knows one is on.
function Start-Match {
  $js = Join-Path $tmp 'match.cjs'
  Set-Content -Encoding ascii $js "require('net').createServer((s) => s.end()).listen(2999, '127.0.0.1')"
  $p = Start-Process -FilePath 'node' -ArgumentList @("`"$js`"") -PassThru -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(15)
  while (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port 2999 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    if ((Get-Date) -gt $deadline -or $p.HasExited) { throw 'The pretend League match did not listen on 2999.' }
    Start-Sleep -Milliseconds 300
  }
  $p
}
function Stop-Match($p) {
  if ($p -and -not $p.HasExited) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $p.Id -Timeout 10 -ErrorAction SilentlyContinue
  }
}

# A fresh profile and save (the seed test writes it; `$league` adds a couch item named League), the
# app up and its desk running. Returns the data folder, the log and the seed.
function Start-App([string]$name, [string]$adRule = 'off', [string]$league = 'off') {
  $data = Join-Path $tmp $name
  New-Item -ItemType Directory -Force $data | Out-Null
  $log = Join-Path $data 'logs\mayorly.log'
  $env:E2E_STREAM_SEED = Join-Path $data 'mayorly.json'
  $env:E2E_STREAM_AD = $adRule
  $env:E2E_STREAM_LEAGUE = $league
  Push-Location $App
  try { & npx vitest run src/shared/streamdeath.test.ts -t 'writes the e2e seed' | Out-Null } finally { Pop-Location }
  Remove-Item Env:E2E_STREAM_SEED
  Remove-Item Env:E2E_STREAM_AD
  Remove-Item Env:E2E_STREAM_LEAGUE
  if (-not (Test-Path (Join-Path $data 'mayorly.json'))) { throw "$name`: no seed was written." }
  $seed = (Get-Content (Join-Path $data 'mayorly.json') -Raw | ConvertFrom-Json).state

  $env:MAYORLY_DATA_DIR = $data
  $env:MAYORLY_DEBUG = '1'
  try {
    # Not $app: PowerShell names are not case-sensitive, and $App is the app's folder.
    $proc = Start-Process -FilePath $electron -ArgumentList ('"' + $App + '"') -PassThru
    $deadline = (Get-Date).AddSeconds(60)
    while (-not ((Test-Path $log) -and ((Get-Content $log -Raw) -match 'packaged='))) {
      if ((Get-Date) -gt $deadline) { throw "$name`: the app did not start within 60 seconds." }
      if ($proc.HasExited) { throw "$name`: the app quit at start, code $($proc.ExitCode)." }
      Start-Sleep -Milliseconds 300
    }
    Start-Sleep -Seconds 3
    if (-not (Test-Path (Join-Path $ext 'stream-eye.js'))) { throw "$name`: the app wrote no stream-eye.js to $ext." }
    # A running desk is paused at launch; mayorly://pause from a second copy resumes it, as a person
    # would. That copy hands the link to the one running and goes; it is stopped here if it lingers.
    $second = Start-Process -FilePath $electron -ArgumentList ('"' + $App + '"', 'mayorly://pause') -PassThru
    $deadline = (Get-Date).AddSeconds(15)
    while (-not ((Get-Content $log -Raw) -match 'url pause')) {
      if ((Get-Date) -gt $deadline) { throw "$name`: the desk was not resumed." }
      Start-Sleep -Milliseconds 300
    }
    if (-not $second.WaitForExit(5000)) { Stop-Process -Id $second.Id -Force -ErrorAction SilentlyContinue }
  } finally {
    Remove-Item Env:MAYORLY_DATA_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:MAYORLY_DEBUG -ErrorAction SilentlyContinue
  }
  @{ data = $data; log = $log; seed = $seed }
}

# One run: the app up, Chrome on the page; then waits until `$Until` seconds after the page's t0
# and reports what the log and the save say.
function Run-Stream([string]$name, [string]$plan, [int]$until, [string]$adRule = 'off') {
  $up = Start-App $name $adRule
  $data = $up.data
  $log = $up.log
  $alpha = ($up.seed.entries | Where-Object { $_.title -eq 'alpha' }).id
  $stream = ($up.seed.leisure | Where-Object { $_.title -eq 'Stream watch' }).id

  # The page's clock starts a little ahead, so Chrome is up and the rule has learned the picture.
  $start = (Get-Date).AddSeconds(12)
  $chromeData = Join-Path $tmp "$name-chrome"
  $url = "https://www.twitch.tv/e2e?plan=$plan&t0=$(Epoch $start)"
  # Windows PowerShell joins these with spaces and no quotes: each one is quoted here.
  $chromeArgs = @(
    "`"--user-data-dir=$chromeData`"", '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen',
    "`"--load-extension=$ext`"", '"--host-resolver-rules=MAP www.twitch.tv 127.0.0.1"', '--ignore-certificate-errors',
    '--autoplay-policy=no-user-gesture-required', '--window-position=0,0', '--window-size=1400,950', "`"$url`""
  )
  Start-Process -FilePath $Chrome -ArgumentList $chromeArgs | Out-Null
  $end = $start.AddSeconds($until)
  while ((Get-Date) -lt $end) { Start-Sleep -Seconds 1 }
  Start-Sleep -Seconds 3

  $lines = Log-Lines $log
  $startUtc = $start.ToUniversalTime()
  $said = @($lines | Where-Object { $_.text -match '\[(stream|league)\]' } | ForEach-Object { '{0:N1}s {1}' -f ($_.at - $startUtc).TotalSeconds, $_.text })
  $deaths = @($lines | Where-Object { $_.text -match '\[stream\] death on' } | ForEach-Object { [pscustomobject]@{ s = ($_.at - $startUtc).TotalSeconds; text = $_.text } })
  $ads = @($lines | Where-Object { $_.text -match '\[stream\] ad (on|over)' } | ForEach-Object { [pscustomobject]@{ s = ($_.at - $startUtc).TotalSeconds; text = $_.text } })
  # When the page's video was muted, from the page's own reports.
  $mutes = @()
  if (Test-Path $report) {
    $mutes = @(Get-Content $report | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.plan -eq $plan -and $_.muted } | ForEach-Object { ($_.at - (Epoch $start)) / 1000.0 })
  }
  $saved = (Get-Content (Join-Path $data 'mayorly.json') -Raw | ConvertFrom-Json).state.desk
  $on = if ($saved.block.kind -eq 'leisure') { $saved.block.leisureId } else { $saved.block.entryId }
  Stop-Mine 'chrome.exe' (Split-Path $Chrome)
  Stop-Mine 'electron.exe' (Join-Path $App 'node_modules\electron')
  return [ordered]@{
    name = $name; plan = $plan
    armed = [bool]($said -match '\] on: ')
    learned = [bool]($said -match '\] learned ')
    deaths = $deaths
    ads = $ads
    mutes = $mutes
    onDesk = if ($on -eq $alpha) { 'alpha' } elseif ($on -eq $stream) { 'Stream watch' } else { "$on" }
    said = $said
  }
}

try {
  if (-not (Test-Path (Join-Path $App 'out\main\index.js'))) { throw 'No build in out/: run npm run build first.' }
  if (-not (Test-Path $electron)) { & node (Join-Path $App 'node_modules\electron\install.js') | Out-Null }
  if (-not (Test-Path $electron)) { throw "No Electron at $electron." }

  # www.twitch.tv on this machine: a certificate for it and the page served on 443.
  $cert = New-SelfSignedCertificate -DnsName 'www.twitch.tv' -CertStoreLocation 'Cert:\CurrentUser\My'
  $pass = [Guid]::NewGuid().ToString('N')
  $pfx = Join-Path $tmp 'twitch.pfx'
  Export-PfxCertificate -Cert $cert -FilePath $pfx -Password (ConvertTo-SecureString -String $pass -Force -AsPlainText) | Out-Null
  $report = Join-Path $tmp 'report.jsonl'
  $server = Start-Process -FilePath 'node' -ArgumentList @((Join-Path $App 'scripts\e2e-stream-serve.cjs'), $pfx, $pass, '443', $report) -PassThru -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(20)
  while (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    if ((Get-Date) -gt $deadline -or $server.HasExited) { throw 'The pretend Twitch page was not served on 443.' }
    Start-Sleep -Milliseconds 500
  }

  # 1. The streamer dies once, at 100 s, after a break card, a slow fade and an ad that must not count.
  $full = Run-Stream 'full' 'full' 115
  $full.pass = $full.armed -and $full.learned -and @($full.deaths).Count -eq 1 -and @($full.deaths)[0].text -match 'switched$' -and @($full.deaths)[0].s -ge 100 -and @($full.deaths)[0].s -le 103.5 -and $full.onDesk -eq 'alpha' -and @($full.mutes).Count -ge 1 -and @($full.mutes)[0] -ge @($full.deaths)[0].s -and @($full.mutes)[0] -le @($full.deaths)[0].s + 4
  $result.runs += $full

  # 2. The same death while a League match of your own runs: no switch. Its seed has no task named
  # League, so the match moves nothing on its own either.
  $fake = Start-Match
  $own = Run-Stream 'own' 'death-only' 40
  $own.pass = $own.armed -and @($own.deaths).Count -ge 1 -and (@($own.deaths)[0].text -match 'your own League match is running$') -and $own.onDesk -eq 'Stream watch' -and @($own.mutes).Count -eq 0 -and [bool]($own.said -match 'no task named League')
  $result.runs += $own
  # The pretend League match ends here: it is run 2's alone.
  Stop-Match $fake
  $fake = $null

  # 3. GTA: its word, not its colour. A black and white beat and FAILED never count; WASTED at 50 s does, once.
  $gta = Run-Stream 'gta' 'gta' 62
  $gta.pass = $gta.armed -and @($gta.deaths).Count -eq 1 -and @($gta.deaths)[0].text -match 'switched$' -and @($gta.deaths)[0].s -ge 50 -and @($gta.deaths)[0].s -le 53.5 -and $gta.onDesk -eq 'alpha' -and @($gta.mutes).Count -ge 1 -and @($gta.mutes)[0] -ge @($gta.deaths)[0].s -and @($gta.mutes)[0] -le @($gta.deaths)[0].s + 4
  $result.runs += $gta

  # 4. An ad break at 20 s, with Twitch's banner: switched once, muted, and its end said.
  $ad = Run-Stream 'ad' 'ad' 45 'on'
  $adOn = @($ad.ads | Where-Object { $_.text -match '\] ad on twitch \(label\): switched$' })
  $adOver = @($ad.ads | Where-Object { $_.text -match '\] ad over on twitch$' })
  $ad.pass = $ad.armed -and $adOn.Count -eq 1 -and $adOn[0].s -ge 20 -and $adOn[0].s -le 22.5 -and @($ad.deaths).Count -eq 0 -and $ad.onDesk -eq 'alpha' -and @($ad.mutes).Count -ge 1 -and @($ad.mutes)[0] -ge 20 -and @($ad.mutes)[0] -le 23.5 -and $adOver.Count -eq 1 -and $adOver[0].s -ge 35 -and $adOver[0].s -le 44
  $result.runs += $ad

  # 5. A League match of yours starts while the desk is on Stream watch: onto the couch item named
  # League, once, within a few seconds, and the switch log says the game did it. No Chrome.
  $up = Start-App 'play' 'off' 'on'
  $league = ($up.seed.leisure | Where-Object { $_.title -eq 'League of Legends' }).id
  $began = (Get-Date).ToUniversalTime()
  $fake = Start-Match
  Start-Sleep -Seconds 12
  Stop-Match $fake
  $fake = $null
  Start-Sleep -Seconds 1
  $said = @(Log-Lines $up.log | Where-Object { $_.text -match '\[(league|switch)\]' } | ForEach-Object { '{0:N1}s {1}' -f ($_.at - $began).TotalSeconds, $_.text })
  $starts = @(Log-Lines $up.log | Where-Object { $_.text -match '\[league\] your match started: ' } | ForEach-Object { [pscustomobject]@{ s = ($_.at - $began).TotalSeconds; text = $_.text } })
  $switchFile = Join-Path $up.data 'switches.jsonl'
  $byGame = @(if (Test-Path $switchFile) { Get-Content $switchFile | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.cause -eq 'game' } })
  $desk = (Get-Content (Join-Path $up.data 'mayorly.json') -Raw | ConvertFrom-Json).state.desk
  Stop-Mine 'electron.exe' (Join-Path $App 'node_modules\electron')
  $play = [ordered]@{
    name = 'play'
    starts = $starts
    switches = @($byGame | ForEach-Object { "$($_.via): $($_.from.title) -> $($_.to.title)" })
    onDesk = if ($desk.block.leisureId -eq $league) { 'League of Legends' } else { "$($desk.block.leisureId)$($desk.block.entryId)" }
    status = $desk.status
    said = $said
  }
  $play.pass = $starts.Count -eq 1 -and $starts[0].text -match 'switched \(League of Legends\)$' -and $starts[0].s -le 8 -and $byGame.Count -eq 1 -and $byGame[0].to.title -eq 'League of Legends' -and $byGame[0].from.title -eq 'Stream watch' -and $play.onDesk -eq 'League of Legends' -and $play.status -eq 'running'
  $result.runs += $play

  $result.ok = $full.pass -and $own.pass -and $gta.pass -and $ad.pass -and $play.pass
} catch {
  $result.error = $_.Exception.Message
} finally {
  Stop-Match $fake
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  Stop-Mine 'chrome.exe' (Split-Path $Chrome)
  Stop-Mine 'electron.exe' (Join-Path $App 'node_modules\electron')
  if ($cert) { Remove-Item -Path ("Cert:\CurrentUser\My\" + $cert.Thumbprint) -ErrorAction SilentlyContinue }
  $last = Get-ChildItem $tmp -Recurse -Filter 'mayorly.log' -ErrorAction SilentlyContinue | Select-Object -Last 1
  if ($last) { $result.log = @(Get-Content $last.FullName -Tail 150 | ForEach-Object { [string]$_ }) }
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

$json = $result | ConvertTo-Json -Depth 6
if ($Out) { $json | Set-Content -Encoding utf8 $Out } else { $json }
if ($result.ok) { exit 0 } else { exit 1 }
