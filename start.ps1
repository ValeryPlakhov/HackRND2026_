param([switch]$TrustedLocal, [switch]$Docker, [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 8080 }))
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskJdk = $null
if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\javac.exe'))) { $taskJdk = $env:JAVA_HOME }
if (-not $taskJdk) {
    $taskBundled = Get-ChildItem -LiteralPath '.runtime' -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\javac.exe') } | Select-Object -First 1
    if ($taskBundled) { $taskJdk = $taskBundled.FullName }
}
if ($taskJdk) { $taskJavac = Join-Path $taskJdk 'bin\javac.exe'; $taskJava = Join-Path $taskJdk 'bin\java.exe' }
else { $taskJavac = (Get-Command javac -ErrorAction Stop).Source; $taskJava = (Get-Command java -ErrorAction Stop).Source }
New-Item -ItemType Directory -Path 'build' -Force | Out-Null
$taskSources = (Get-ChildItem -LiteralPath 'src' -Filter '*.java').FullName
& $taskJavac --release 21 -encoding UTF-8 -d build $taskSources
if ($LASTEXITCODE -ne 0) { throw 'Compilation failed' }
$env:PORT = "$Port"
$env:BLUEPRINTS_RUNNER = if ($Docker) { 'docker' } elseif ($TrustedLocal) { 'local' } else { 'disabled' }
& $taskJava -Xmx512m -cp build BlueprintServer
