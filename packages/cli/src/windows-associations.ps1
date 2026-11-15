param([Parameter(Mandatory=$true)][string]$PlanFile, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$plan = Get-Content -LiteralPath $PlanFile -Raw | ConvertFrom-Json
$classes = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes')
try {
  # Preflight every protocol before writing anything. Never replace another app.
  foreach ($scheme in $plan.protocols) {
    $key = $classes.OpenSubKey($scheme)
    if ($key) {
      try { if ($key.GetValue('SparkOwner') -ne $plan.appId) { throw "Protocol '$scheme' belongs to another app" } } finally { $key.Dispose() }
    }
  }
  $command = '"' + $plan.executable + '" "%1"'
  $progId = $plan.appId + '.Document'
  if ($Remove) {
    foreach ($scheme in $plan.protocols) { $classes.DeleteSubKeyTree($scheme, $false) }
    foreach ($extension in $plan.extensions) {
      $key = $classes.OpenSubKey('.' + $extension + '\OpenWithProgids', $true)
      if ($key) { try { $key.DeleteValue($progId, $false) } finally { $key.Dispose() } }
    }
    $classes.DeleteSubKeyTree($progId, $false)
  } else {
    $key = $classes.CreateSubKey($progId)
    try {
      $key.SetValue('', [string]$plan.name); $key.SetValue('SparkOwner', [string]$plan.appId)
      $open = $key.CreateSubKey('shell\open\command'); try { $open.SetValue('', $command) } finally { $open.Dispose() }
    } finally { $key.Dispose() }
    foreach ($extension in $plan.extensions) {
      $key = $classes.CreateSubKey('.' + $extension + '\OpenWithProgids')
      try { $key.SetValue($progId, [byte[]]@(), [Microsoft.Win32.RegistryValueKind]::None) } finally { $key.Dispose() }
    }
    foreach ($scheme in $plan.protocols) {
      $key = $classes.CreateSubKey($scheme)
      try {
        $key.SetValue('', 'URL:' + $plan.name); $key.SetValue('URL Protocol', ''); $key.SetValue('SparkOwner', [string]$plan.appId)
        $open = $key.CreateSubKey('shell\open\command'); try { $open.SetValue('', $command) } finally { $open.Dispose() }
      } finally { $key.Dispose() }
    }
  }
  # Remove only stale registrations still owned by this project's previous plan.
  if ($plan.previous) {
    foreach ($scheme in $plan.previous.protocols) {
      if ($plan.protocols -contains $scheme) { continue }
      $key = $classes.OpenSubKey($scheme)
      $owned = $false
      if ($key) { try { $owned = $key.GetValue('SparkOwner') -eq $plan.previous.appId } finally { $key.Dispose() } }
      if ($owned) { $classes.DeleteSubKeyTree($scheme, $false) }
    }
    foreach ($extension in $plan.previous.extensions) {
      if ($plan.extensions -contains $extension -and $plan.appId -eq $plan.previous.appId) { continue }
      $key = $classes.OpenSubKey('.' + $extension + '\OpenWithProgids', $true)
      if ($key) { try { $key.DeleteValue($plan.previous.appId + '.Document', $false) } finally { $key.Dispose() } }
    }
  }
  Add-Type -MemberDefinition '[System.Runtime.InteropServices.DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e, uint f, System.IntPtr a, System.IntPtr b);' -Name Shell -Namespace Spark
  [Spark.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
} finally { $classes.Dispose() }
