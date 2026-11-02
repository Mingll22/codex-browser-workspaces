param([Parameter(Mandatory=$true)][string]$StopPath)
$ErrorActionPreference = 'Stop'
Add-Type -Name CBWForeground -Namespace Win32 -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();'
$watch = [Diagnostics.Stopwatch]::StartNew()
$initial = [Win32.CBWForeground]::GetForegroundWindow().ToInt64()
$last = $initial
$changes = [System.Collections.Generic.List[object]]::new()
[Console]::WriteLine('READY')
while ($watch.ElapsedMilliseconds -lt 60000 -and !(Test-Path -LiteralPath $StopPath)) {
  $current = [Win32.CBWForeground]::GetForegroundWindow().ToInt64()
  if ($current -ne $last) { $changes.Add(@{ ms=$watch.ElapsedMilliseconds; hwnd=$current }); $last=$current }
  Start-Sleep -Milliseconds 25
}
[Console]::WriteLine((@{ initial=$initial; final=$last; elapsedMs=$watch.ElapsedMilliseconds; changes=@($changes.ToArray()) } | ConvertTo-Json -Depth 4 -Compress))
