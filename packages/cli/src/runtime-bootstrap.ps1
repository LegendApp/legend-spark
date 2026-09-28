param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Entry,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$ScriptArgs
)
$ErrorActionPreference = 'Stop'
$platform = 'win32'
$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($arch -notin @('arm64', 'x64')) { throw "Unsupported runtime architecture: $arch" }
$sparkHome = if ($env:SPARK_HOME) { $env:SPARK_HOME } else { Join-Path $env:USERPROFILE '.spark' }
$cache = Join-Path $sparkHome 'tooling/runtimes'
$assets = Import-Csv (Join-Path $PSScriptRoot 'runtime-downloads.tsv') -Delimiter "`t"

function Test-Compatible([string]$Executable, [string]$Kind = '') {
  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $false }
  try {
    & $Executable (Join-Path $PSScriptRoot 'js-runtime.cjs') $Kind 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch { return $false }
}
function Start-Runtime([string]$Executable) {
  $env:SPARK_JS_RUNTIME = $Executable
  $env:PATH = "$(Split-Path -Parent $Executable);$env:PATH"
  & $Executable $Entry @ScriptArgs
  exit $LASTEXITCODE
}
function Get-Asset([string]$Kind) {
  return $assets | Where-Object { $_.runtime -eq $Kind -and $_.platform -eq $platform -and $_.arch -eq $arch } | Select-Object -First 1
}
function Get-Destination($Asset) {
  return Join-Path $cache "$($Asset.runtime)-$($Asset.version)-$platform-$arch-$($Asset.sha256)"
}
function Test-Cached($Asset) {
  $destination = Get-Destination $Asset
  $executable = Join-Path $destination $Asset.executable
  $marker = Join-Path $destination '.binary-sha256'
  return (Test-Path -LiteralPath $executable -PathType Leaf) -and (Test-Path -LiteralPath $marker -PathType Leaf) -and
    ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -eq (Get-Content -LiteralPath $marker -Raw).Trim()) -and (Test-Compatible $executable)
}

$requested = $env:SPARK_JS_RUNTIME
if ($requested -and $requested -notin @('node', 'bun')) {
  if (-not (Test-Compatible $requested)) { throw "Unsupported or missing runtime: $requested" }
  Start-Runtime $requested
}
$choices = if ($requested) { @($requested) } else { @('node', 'bun') }
foreach ($kind in $choices) {
  $command = Get-Command "$kind.exe" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command -and (Test-Compatible $command.Source $requested)) { Start-Runtime $command.Source }
}
foreach ($kind in $choices) {
  $asset = Get-Asset $kind
  if ($asset -and (Test-Cached $asset)) { Start-Runtime (Join-Path (Get-Destination $asset) $asset.executable) }
}
$download = if ($requested) { $requested } elseif ($env:SPARK_RUNTIME_DOWNLOAD) { $env:SPARK_RUNTIME_DOWNLOAD } else { 'node' }
if ($download -notin @('node', 'bun')) { throw 'SPARK_RUNTIME_DOWNLOAD must be node or bun.' }
$asset = Get-Asset $download
if (-not $asset) { throw "No pinned $download download for $platform/$arch. Install a compatible runtime manually." }
$destination = Get-Destination $asset
New-Item -ItemType Directory -Path $cache -Force | Out-Null
$lock = $null
$staging = $null
try {
  # An OS file lock is released even when installation is interrupted or crashes.
  for ($attempt = 0; $attempt -lt 60 -and -not $lock; $attempt++) {
    try { $lock = [IO.File]::Open("$destination.lock", [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch [IO.IOException] { Start-Sleep -Seconds 1 }
  }
  if (-not $lock) { throw "Another process is installing $download; retry shortly." }
  if (-not (Test-Cached $asset)) {
    $staging = Join-Path $cache ".install-$download-$([Guid]::NewGuid())"
    New-Item -ItemType Directory -Path $staging | Out-Null
    $archive = Join-Path $staging 'archive.zip'
    Write-Host "Downloading Spark's private $download $($asset.version) runtime..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $asset.url -OutFile $archive -UseBasicParsing -TimeoutSec 300
    if ((Get-Item -LiteralPath $archive).Length -gt 134217728 -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $asset.sha256) { throw 'Runtime download checksum or size mismatch.' }
    $unpacked = Join-Path $staging 'unpacked'
    Expand-Archive -LiteralPath $archive -DestinationPath $unpacked
    $executable = Join-Path $unpacked $asset.executable
    if (-not (Test-Compatible $executable)) { throw 'Downloaded runtime cannot run on this machine.' }
    (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash | Set-Content -LiteralPath (Join-Path $unpacked '.binary-sha256')
    if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
    Move-Item -LiteralPath $unpacked -Destination $destination
  }
} finally {
  if ($staging -and (Test-Path -LiteralPath $staging)) { Remove-Item -LiteralPath $staging -Recurse -Force }
  if ($lock) { $lock.Dispose() }
}
Start-Runtime (Join-Path $destination $asset.executable)
