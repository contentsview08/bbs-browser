# (このファイルは BOM 付き UTF-8。Windows PowerShell 5.1 は BOM がないと日本語を読み違え、ヒアストリングの終わりを見失う)
# ZIP 版(インストールせずに使う版)を作る。npm run build のあとに実行する: npm run package:zip
# 中身は本体の exe・portable.txt(この印があると、データを exe と同じフォルダの data\ に置く。src-tauri/src/lib.rs の portable_dir)・説明。
# つまり「展開したフォルダがインストール先」。フォルダごと消せばまっさらになる。WebView2(Windows 10/11 には最初から入っている)が要る
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $root 'apps/desktop/package.json') -Raw | ConvertFrom-Json).version
$exe = Join-Path $root 'apps/desktop/src-tauri/target/release/OBB.exe'
if (-not (Test-Path $exe)) { throw "先に npm run build を実行してください($exe がありません)" }

$outDir = Join-Path $root 'apps/desktop/src-tauri/target/release/bundle/zip'
$stage = Join-Path $outDir "OBB_$version"
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item $exe $stage
@"
このファイルが OBB.exe と同じフォルダにあると、ログ・設定をこのフォルダの data に置きます(ZIP 版の印)。
消すと、インストーラー版と同じ %APPDATA%\io.github.contentsview08.obb\ を使います。
"@ | Set-Content -Encoding UTF8 (Join-Path $stage 'portable.txt')
@"
OBB $version(ZIP 版)

このフォルダがそのままインストール先です。OBB.exe を起動するだけで使えます(インストールは要りません)。
ログ・既読・設定・Cookie はこのフォルダの data に入ります。フォルダごと消せばまっさらになり、別の場所に展開すれば別のデータになります。
Windows 10/11 に入っている WebView2 を使います。起動しないときは、Microsoft の「WebView2 ランタイム」を入れてください。
"@ | Set-Content -Encoding UTF8 (Join-Path $stage 'はじめにお読みください.txt')

$zip = Join-Path $outDir "OBB_${version}_x64_portable.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
Remove-Item -Recurse -Force $stage
Write-Host "作りました: $zip"
