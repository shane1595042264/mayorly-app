# End-to-end: drag the tomato with real Windows mouse input and check that it moved.
#
# The drag lives where no unit test reaches: the click-through overlay, Electron's forwarded mouse
# moves, the shell taking the pointer over the pet, the page's hit test and the pointer capture all
# have to agree, and the drag broke more than once when one of them changed. This starts the built
# app in a profile of its own (MAYORLY_DATA_DIR), puts its tomato in the middle of the main screen,
# presses on it, carries it and lets go with SendInput, as a hand would, and reads where the app
# saved it. It drags again after the pointer has left, again after the app stalled for a second and
# a half (which can cost Electron its mouse hook), and right-clicks the tomato for its menu.
#
# CI runs it on a Windows runner (.github/workflows/ci.yml, job drag), so nobody's own computer is
# used for it. It takes the mouse for about half a minute.
#   npm run build
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-drag.ps1 [-Out result.json]
# Exit code 0 when every drag landed and the menu opened.
param(
  [string]$App = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$Out = ''
)
$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Hand {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
  public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; }
  static void Send(uint flags, int x, int y) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    INPUT i = new INPUT();
    i.type = 0;
    i.mi.dx = (int)Math.Round((x - vx) * 65535.0 / (vw - 1));
    i.mi.dy = (int)Math.Round((y - vy) * 65535.0 / (vh - 1));
    i.mi.dwFlags = flags | 0x0001 | 0x8000 | 0x4000; // MOVE | ABSOLUTE | VIRTUALDESK
    SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Move(int x, int y) { Send(0, x, y); }
  public static void Down(int x, int y) { Send(0x0002, x, y); }
  public static void Up(int x, int y) { Send(0x0004, x, y); }
  public static void RightClick(int x, int y) { Send(0x0008, x, y); System.Threading.Thread.Sleep(60); Send(0x0010, x, y); }
  public static void Escape() { keybd_event(0x1B, 0, 0, UIntPtr.Zero); keybd_event(0x1B, 0, 2, UIntPtr.Zero); }

  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  /** The window a press at this point goes to: its process, its title and its extended style. */
  public static string Under(int x, int y) {
    POINT p; p.X = x; p.Y = y;
    IntPtr h = WindowFromPoint(p), r = GetAncestor(h, 2);
    uint pid; GetWindowThreadProcessId(r, out pid);
    var c = new System.Text.StringBuilder(256); var t = new System.Text.StringBuilder(256);
    GetClassName(r, c, 256); GetWindowText(r, t, 256);
    return String.Format("pid {0} {1} '{2}' ex 0x{3:X}", pid, c, t, GetWindowLong(r, -20));
  }
  /** A popup menu (class #32768) is showing and belongs to this process. */
  public static bool MenuOpen(uint pid) {
    IntPtr h = IntPtr.Zero;
    while ((h = FindWindowEx(IntPtr.Zero, h, "#32768", null)) != IntPtr.Zero) {
      uint owner; GetWindowThreadProcessId(h, out owner);
      if (owner == pid && IsWindowVisible(h)) return true;
    }
    return false;
  }
}
'@

# Physical pixels everywhere in this script; the app's coordinates are physical over the DPI scale.
[void][Hand]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
$scale = [Hand]::GetDpiForSystem() / 96.0
$screenW = [Hand]::GetSystemMetrics(0)
$screenH = [Hand]::GetSystemMetrics(1)
$t0 = Get-Date

$data = Join-Path ([IO.Path]::GetTempPath()) ("mayorly-e2e-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $data | Out-Null
$hud = Join-Path $data 'hud.json'
$log = Join-Path $data 'logs\mayorly.log'

# The tomato's bottom centre, in the app's points: the middle of the main screen.
$spot = @{ x = [Math]::Round($screenW / $scale / 2); y = [Math]::Round($screenH / $scale / 2) }
@{ anchor = $spot } | ConvertTo-Json -Compress | Set-Content -Encoding ascii $hud
# A save, so this is not a first run: a first run opens the deck over the whole screen.
'{"lastBeat":null,"state":{"schema":1}}' | Set-Content -Encoding ascii (Join-Path $data 'mayorly.json')
$stamp = { (Get-Date).ToUniversalTime().ToString('HH:mm:ss.fff') }

$result = [ordered]@{ ok = $false; scale = $scale; screen = "$screenW x $screenH"; started = (& $stamp); drags = @(); menu = $null; error = $null; ended = $null; log = @() }
$proc = $null
$saved = New-Object Hand+POINT
[void][Hand]::GetCursorPos([ref]$saved)

function Read-Anchor {
  $j = Get-Content $hud -Raw | ConvertFrom-Json
  return @{ x = [double]$j.anchor.x; y = [double]$j.anchor.y }
}

# The middle of the tomato, in physical pixels.
function Tomato {
  $a = Read-Anchor
  return @{ x = [int][Math]::Round($a.x * $scale); y = [int][Math]::Round(($a.y - 24) * $scale) }
}

# Arrive from outside the pet, from up and to the left, as a hand does.
function Approach($t) {
  [Hand]::Move($t.x - [int](220 * $scale), $t.y - [int](120 * $scale))
  Start-Sleep -Milliseconds 250
  foreach ($k in 1..6) { [Hand]::Move($t.x - [int]((220 - 220 * $k / 6) * $scale), $t.y - [int]((120 - 120 * $k / 6) * $scale)); Start-Sleep -Milliseconds 30 }
  Start-Sleep -Milliseconds 400
}

# Press on the tomato, carry it by (dx, dy) points in small steps, let go; landed when it is there.
function Drag-Tomato([double]$dx, [double]$dy, [string]$name) {
  $from = Read-Anchor
  $at = & $stamp
  $t = Tomato
  Approach $t
  $under = [Hand]::Under($t.x, $t.y)
  [Hand]::Down($t.x, $t.y)
  Start-Sleep -Milliseconds 120
  $steps = 18
  foreach ($k in 1..$steps) {
    [Hand]::Move($t.x + [int]($dx * $scale * $k / $steps), $t.y + [int]($dy * $scale * $k / $steps))
    Start-Sleep -Milliseconds 20
  }
  Start-Sleep -Milliseconds 150
  [Hand]::Up($t.x + [int]($dx * $scale), $t.y + [int]($dy * $scale))
  Start-Sleep -Milliseconds 1200
  $to = Read-Anchor
  $want = @{ x = $from.x + $dx; y = $from.y + $dy }
  $landed = [Math]::Abs($to.x - $want.x) -le 12 -and [Math]::Abs($to.y - $want.y) -le 12
  return [ordered]@{ name = $name; at = $at; from = $from; want = $want; got = $to; landed = $landed; under = $under }
}

function Wander {
  [Hand]::Move([int](($spot.x - 300) * $scale), [int](($spot.y + 200) * $scale))
  Start-Sleep -Milliseconds 800
}

try {
  $env:MAYORLY_DATA_DIR = $data
  # The overlay's own account of the pointer (hit, held, the input it hears), for when a drag fails.
  $env:MAYORLY_DEBUG = '1'
  $electron = Join-Path $App 'node_modules\electron\dist\electron.exe'
  if (-not (Test-Path (Join-Path $App 'out\main\index.js'))) { throw 'No build in out/: run npm run build first.' }
  # The electron package fetches its binary on first use, not on npm ci; a fresh runner has none yet.
  if (-not (Test-Path $electron)) { & node (Join-Path $App 'node_modules\electron\install.js') | Out-Null }
  if (-not (Test-Path $electron)) { throw "No Electron at $electron." }
  $proc = Start-Process -FilePath $electron -ArgumentList ('"' + $App + '"') -PassThru
  # Up when its log says so, then time for the page to load and draw the pet.
  $deadline = (Get-Date).AddSeconds(60)
  while (-not ((Test-Path $log) -and ((Get-Content $log -Raw) -match 'packaged='))) {
    if ((Get-Date) -gt $deadline) { throw 'The app did not start within 60 seconds.' }
    if ($proc.HasExited) { throw "The app quit at start, code $($proc.ExitCode)." }
    Start-Sleep -Milliseconds 300
  }
  Start-Sleep -Seconds 4

  $result.drags += Drag-Tomato -240 -160 'first drag'
  Wander
  $result.drags += Drag-Tomato 200 120 'second drag, after the pointer left'

  # A stall: the app does not answer for a second and a half while the pointer moves outside the
  # pet, where the overlay is click-through and Electron's mouse hook is installed. Windows drops
  # a hook that answers that late, for good. The pet must still take the pointer.
  Wander
  # $proc keeps the handle open: a handle from a throwaway Process object can be closed by the
  # garbage collector mid-stall, and the app then stays frozen.
  $h = $proc.Handle
  if ([Hand]::NtSuspendProcess($h) -ne 0) { throw 'Could not pause the app.' }
  try {
    foreach ($k in 1..30) { [Hand]::Move([int](($spot.x - 300 + 10 * $k) * $scale), [int](($spot.y + 250) * $scale)); Start-Sleep -Milliseconds 50 }
  } finally {
    if ([Hand]::NtResumeProcess($h) -ne 0) { throw 'Could not resume the app.' }
  }
  Start-Sleep -Milliseconds 800
  $result.drags += Drag-Tomato -200 -120 'after the app stalled'
  Wander
  $result.drags += Drag-Tomato 240 160 'again after the stall'

  # A right click on the tomato opens its menu (the tray's, Quit included); Escape closes it.
  Wander
  $t = Tomato
  Approach $t
  [Hand]::RightClick($t.x, $t.y)
  Start-Sleep -Milliseconds 700
  $opened = [Hand]::MenuOpen([uint32]$proc.Id)
  [Hand]::Escape()
  Start-Sleep -Milliseconds 400
  $result.menu = [ordered]@{ opened = $opened; closed = -not [Hand]::MenuOpen([uint32]$proc.Id) }

  $result.ok = (@($result.drags | Where-Object { -not $_.landed }).Count -eq 0) -and $opened
} catch {
  $result.error = $_.Exception.Message
} finally {
  $result.ended = & $stamp
  [void][Hand]::SetCursorPos($saved.X, $saved.Y)
  # Every process this test started (the app and its GPU, renderer and utility children), by the
  # executable and the time, then a wait until they are gone, so nothing is left running.
  $mine = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.ExecutablePath -like "$App\node_modules\electron\*" -and $_.CreationDate -ge $t0 })
  foreach ($p in $mine) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  foreach ($p in $mine) { Wait-Process -Id $p.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }
  Remove-Item Env:MAYORLY_DATA_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:MAYORLY_DEBUG -ErrorAction SilentlyContinue
  if (Test-Path $log) { $result.log = @(Get-Content $log -Tail 120 | ForEach-Object { [string]$_ }) }
  Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
}

$json = $result | ConvertTo-Json -Depth 6
if ($Out) { $json | Set-Content -Encoding utf8 $Out } else { $json }
if ($result.ok) { exit 0 } else { exit 1 }
