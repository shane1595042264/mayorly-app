# Mayorly: a prompt you send an AI in a desktop app (Claude, ChatGPT and Codex, Gemini) or a
# browser, seen the way a person sees it: the app in front shows a Stop button while it answers.
# Its appearing is the prompt, written to ~/.mayorly/ai.jsonl like the hooks' lines; Mayorly
# switches the desk. Reads only the app in front, through Windows UI Automation, near the box you
# type in; never what you type. Quits when Mayorly does.
#
#   powershell -File ai-watch.ps1 -Parent <Mayorly's pid>
#   powershell -File ai-watch.ps1 -Once -Report out.txt     what it sees right now, once
param([int]$Parent = 0, [switch]$Once, [string]$Report = '')
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Front {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static IntPtr Window() { return GetForegroundWindow(); }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
}
'@

$A = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]::Descendants
$ignoreCase = [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase
# What the AI apps call the button that stops an answer.
$names = @('Stop', 'Stop response', 'Stop generating', 'Stop streaming', 'Stop answering', 'Stop responding', 'Stop writing')
$byName = [System.Windows.Automation.Condition[]]@($names | ForEach-Object { New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, $_, $ignoreCase) })
$button = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$stop = New-Object System.Windows.Automation.AndCondition($button, (New-Object System.Windows.Automation.OrCondition($byName)))
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$inbox = Join-Path $env:USERPROFILE '.mayorly\ai.jsonl'

# The app in front, as Mayorly names it; null for anything else, which is never read.
function App-Of([string]$proc, [string]$title) {
  switch -regex ($proc) {
    '^claude$' { return 'claude-app' }
    '^(chatgpt|codex)$' { return 'chatgpt-app' }
    '^gemini$' { return 'gemini-app' }
    '^(chrome|msedge|brave|arc|vivaldi|opera)$' {
      if ($title -match 'ChatGPT') { return 'chatgpt-web' }
      if ($title -match 'Gemini') { return 'gemini-web' }
      if ($title -match 'Claude') { return 'claude-web' }
      # Any other page: an AI in a side panel (Claude in Chrome, Gemini in Chrome).
      return 'browser'
    }
  }
  return $null
}

# Is an answer being written: a Stop button near the focused element (the box you type in, or
# the Send button you clicked), looking a few containers up, not through the whole window.
function Busy([int]$fpid) {
  $f = $A::FocusedElement
  if (-not $f -or $f.Current.ProcessId -ne $fpid) { return $null }
  $e = $f
  for ($i = 0; $i -lt 7 -and $e; $i++) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window) { break }
    if ($e.FindFirst($scope, $stop)) { return $true }
    $e = $walker.GetParent($e)
  }
  return $false
}

$busy = @{}
while ($true) {
  if ($Parent -and -not (Get-Process -Id $Parent -ErrorAction SilentlyContinue)) { break }
  $h = [Front]::Window()
  $fpid = [Front]::Pid($h)
  $proc = (Get-Process -Id $fpid -ErrorAction SilentlyContinue).ProcessName
  $title = [Front]::Title($h)
  $app = if ($proc) { App-Of $proc.ToLower() $title } else { $null }
  $now = if ($app) { Busy $fpid } else { $null }
  if ($Once) {
    "front: $proc '$title' app: $app answering: $now" | Set-Content -Encoding utf8 $Report
    break
  }
  if ($app -and $null -ne $now) {
    $was = [bool]$busy[$fpid]
    $busy[$fpid] = $now
    if ($now -and -not $was) {
      $at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      Add-Content -Path $inbox -Value ('{"at":' + $at + ',"app":"' + $app + '","event":"prompt","manual":true}') -Encoding ascii
    }
  }
  Start-Sleep -Milliseconds 800
}
