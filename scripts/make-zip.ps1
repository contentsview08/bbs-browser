# ZIP 版(インストールせずに使う版)を作る。npm run build のあとに実行する: npm run package:zip
# 中身は本体の exe と説明だけ。WebView2(Windows 10/11 には最初から入っている)が要る。
# データ(DB・設定)は、インストーラー版と同じく %APPDATA%\io.github.yumekui8.bbs-browser\ に置く
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $root 'apps/desktop/package.json') -Raw | ConvertFrom-Json).version
$exe = Join-Path $root 'apps/desktop/src-tauri/target/release/bbs-browser.exe'
if (-not (Test-Path $exe)) { throw "先に npm run build を実行してください($exe がありません)" }

$outDir = Join-Path $root 'apps/desktop/src-tauri/target/release/bundle/zip'
$stage = Join-Path $outDir "bbs-browser_$version"
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item $exe $stage
@"
bbs-browser $version(ZIP 版)

bbs-browser.exe を起動するだけで使えます(インストールは要りません)。
Windows 10/11 に入っている WebView2 を使います。起動しないときは、Microsoft の「WebView2 ランタイム」を入れてください。
ログ・設定は %APPDATA%\io.github.yumekui8.bbs-browser\ に保存します(このフォルダを消しても残ります)。
"@ | Set-Content -Encoding UTF8 (Join-Path $stage 'はじめにお読みください.txt')

$zip = Join-Path $outDir "bbs-browser_${version}_x64_portable.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
Remove-Item -Recurse -Force $stage
Write-Host "作りました: $zip"
