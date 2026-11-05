param(
  [string]$Sdk = "$env:LOCALAPPDATA\Android\Sdk",
  [string]$BuildTools = '35.0.0',
  [string]$Keystore,
  [string]$KeyAlias = 'archive'
)
$ErrorActionPreference = 'Stop'
$androidRoot = $PSScriptRoot
$appRoot = Split-Path $androidRoot
$webRoot = Join-Path $appRoot 'dist'
$buildRoot = Join-Path $androidRoot 'build'
$platform = Join-Path $Sdk 'platforms\android-35\android.jar'
$toolsRoot = Join-Path $Sdk "build-tools\$BuildTools"
if (!(Test-Path -LiteralPath (Join-Path $webRoot 'index.html'))) { throw '먼저 app 폴더에서 npm run build를 실행하세요.' }
if (!(Test-Path -LiteralPath $platform)) { throw 'Android SDK 35가 필요합니다. -Sdk로 위치를 지정하세요.' }
if ($Keystore -and !(Test-Path -LiteralPath $Keystore -PathType Leaf)) { throw '서명 키 파일을 찾을 수 없습니다.' }
foreach ($part in @('classes','dex','keys')) { New-Item -ItemType Directory -Path (Join-Path $buildRoot $part) -Force | Out-Null }
function Run-Tool([string]$Tool, [string[]]$ToolArgs) {
  & $Tool @ToolArgs
  if ($LASTEXITCODE -ne 0) { throw "$Tool 실패: $LASTEXITCODE" }
}
$javaSource = @(Get-ChildItem -LiteralPath (Join-Path $androidRoot 'src') -Filter '*.java' -Recurse | ForEach-Object FullName)
Run-Tool 'javac' (@('-encoding','UTF-8','-source','8','-target','8','-classpath',$platform,'-d', (Join-Path $buildRoot 'classes')) + $javaSource)
Run-Tool 'jar' @('cf', (Join-Path $buildRoot 'classes.jar'), '-C', (Join-Path $buildRoot 'classes'), '.')
Run-Tool (Join-Path $toolsRoot 'd8.bat') @('--min-api','26','--lib',$platform,'--output',(Join-Path $buildRoot 'dex'),(Join-Path $buildRoot 'classes.jar'))
Run-Tool (Join-Path $toolsRoot 'aapt2.exe') @('compile','--dir',(Join-Path $androidRoot 'res'),'-o',(Join-Path $buildRoot 'resources.zip'))
$unsigned = Join-Path $buildRoot 'unsigned.apk'
Run-Tool (Join-Path $toolsRoot 'aapt2.exe') @('link','-o',$unsigned,'--manifest',(Join-Path $androidRoot 'AndroidManifest.xml'),'-I',$platform,'--min-sdk-version','26','--target-sdk-version','35','--version-code','1','--version-name','0.1.0','-R',(Join-Path $buildRoot 'resources.zip'))
Run-Tool 'jar' @('uf',$unsigned,'-C',(Join-Path $buildRoot 'dex'),'classes.dex')
# Windows aapt2의 -A는 하위 경로를 역슬래시로 기록할 수 있으므로 직접 추가한다.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$webFiles = @(Get-ChildItem -LiteralPath $webRoot -File -Recurse)
$webPrefix = (Resolve-Path -LiteralPath $webRoot).Path.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$package = [IO.Compression.ZipFile]::Open($unsigned, [IO.Compression.ZipArchiveMode]::Update)
try {
  foreach ($file in $webFiles) {
    $entryName = 'assets/' + $file.FullName.Substring($webPrefix.Length).Replace('\', '/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($package, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $package.Dispose() }

# 파일 누락과 잘못된 구분자를 서명 전에 검사한다.
$package = [IO.Compression.ZipFile]::OpenRead($unsigned)
try {
  $entryNames = @{}
  foreach ($entry in $package.Entries) {
    if ($entry.FullName.Contains('\')) { throw "APK 경로에 역슬래시가 있습니다: $($entry.FullName)" }
    if ($entryNames.ContainsKey($entry.FullName)) { throw "APK 경로가 중복되었습니다: $($entry.FullName)" }
    $entryNames[$entry.FullName] = $true
  }
  foreach ($file in $webFiles) {
    $entryName = 'assets/' + $file.FullName.Substring($webPrefix.Length).Replace('\', '/')
    $entry = $package.GetEntry($entryName)
    if (!$entry -or $entry.Length -ne $file.Length) { throw "APK 웹 파일이 누락되었거나 크기가 다릅니다: $entryName" }
  }
  if (!$package.GetEntry('assets/index.html')) { throw 'APK 시작 화면이 없습니다.' }
} finally { $package.Dispose() }
Write-Output "APK 웹 파일 경로 검사 완료: $($webFiles.Count)개"
$aligned = Join-Path $buildRoot 'aligned.apk'
Run-Tool (Join-Path $toolsRoot 'zipalign.exe') @('-f','-p','4',$unsigned,$aligned)
$key = if ($Keystore) { (Resolve-Path -LiteralPath $Keystore).Path } else { Join-Path $buildRoot 'keys\debug.keystore' }
if (!$Keystore -and !(Test-Path -LiteralPath $key)) {
  Run-Tool 'keytool' @('-genkeypair','-keystore',$key,'-storepass','android','-keypass','android','-alias','androiddebugkey','-dname','CN=Android Debug,O=Android,C=US','-keyalg','RSA','-keysize','2048','-validity','10000')
}
$releaseRoot = Join-Path (Split-Path $appRoot) '설치파일'
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
$apk = Join-Path $releaseRoot $(if ($Keystore) { 'aRcHivE-Android-0.1.0-release.apk' } else { 'aRcHivE-Android-0.1.0.apk' })
if ($Keystore) {
  # 비밀번호는 apksigner가 콘솔에서 직접 묻는다. 명령이나 파일에 기록하지 않는다.
  Run-Tool (Join-Path $toolsRoot 'apksigner.bat') @('sign','--ks',$key,'--ks-key-alias',$KeyAlias,'--out',$apk,$aligned)
} else {
  Run-Tool (Join-Path $toolsRoot 'apksigner.bat') @('sign','--ks',$key,'--ks-pass','pass:android','--key-pass','pass:android','--out',$apk,$aligned)
}
Run-Tool (Join-Path $toolsRoot 'apksigner.bat') @('verify','--verbose',$apk)
Run-Tool (Join-Path $toolsRoot 'zipalign.exe') @('-c','-p','4',$apk)
Write-Output "APK: $apk"
