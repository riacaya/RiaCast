# build-shell.ps1 - siapkan SDK WebView2 + kompilasi RiaCastShell
# Hasil: RiaCast.exe + WebView2 DLLs di root windows-app
param(
    [string]$VersiSdk = "1.0.2903.40",
    [switch]$LewatiUnduh,
    [switch]$SimpanPaket
)

$ErrorActionPreference = "Stop"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$RootDir = $PSScriptRoot
$CacheDir = Join-Path $RootDir "shell-libs"
$AppRoot = Split-Path -Parent (Split-Path -Parent $RootDir)
$FileCs  = Join-Path $RootDir "RiaCastShell.cs"
$FileIco = Join-Path $AppRoot "assets\riacast.ico"
$OutExe  = Join-Path $AppRoot "RiaCast.exe"

$DllPerlu = @("Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll")
$Arsitektur = @("win-x86", "win-x64", "win-arm64")

Write-Host ""
Write-Host "  RiaCast Shell build (WebView2 cangkang -> GitHub Pages)"
Write-Host "  SDK  : Microsoft.Web.WebView2 $VersiSdk"
Write-Host "  src  : $FileCs"
Write-Host ""

$Csc = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $Csc) { throw "csc.exe tidak ditemukan - butuh .NET Framework 4.x (Windows)." }
Write-Host "  [1/3] csc       : $Csc"

function SdkKurang {
    foreach ($n in $DllPerlu) { if (-not (Test-Path (Join-Path $AppRoot $n))) { return $true } }
    foreach ($a in $Arsitektur) { if (-not (Test-Path (Join-Path $AppRoot ("runtimes\$a\native\WebView2Loader.dll")))) { return $true } }
    return $false
}

if (-not (SdkKurang)) {
    Write-Host "  [2/3] SDK       : sudah ada - unduhan dilewati"
} else {
    if ($LewatiUnduh) { throw "DLL WebView2 belum lengkap dan -LewatiUnduh dipakai." }
    $NamaPaket = "microsoft.web.webview2.$VersiSdk.nupkg"
    $Url       = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$VersiSdk/$NamaPaket"
    $Isi       = Join-Path $CacheDir ("paket-" + $VersiSdk)
    $Nupkg     = Join-Path $CacheDir $NamaPaket
    if (-not (Test-Path $CacheDir)) { New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null }
    if (-not (Test-Path $Nupkg)) {
        Write-Host "  [2/3] unduh     : $Url"
        Invoke-WebRequest -Uri $Url -OutFile $Nupkg -UseBasicParsing
    }
    if (Test-Path $Isi) { Remove-Item $Isi -Recurse -Force }
    Copy-Item $Nupkg (Join-Path $CacheDir "kopi.zip") -Force
    Expand-Archive (Join-Path $CacheDir "kopi.zip") $Isi -Force
    Remove-Item (Join-Path $CacheDir "kopi.zip") -Force
    foreach ($n in $DllPerlu) { Copy-Item (Join-Path $Isi ("lib\net462\" + $n)) (Join-Path $AppRoot $n) -Force }
    foreach ($a in $Arsitektur) {
        $tujuan = Join-Path $AppRoot ("runtimes\$a\native")
        if (-not (Test-Path $tujuan)) { New-Item -ItemType Directory -Path $tujuan -Force | Out-Null }
        Copy-Item (Join-Path $Isi ("runtimes\$a\native\WebView2Loader.dll")) (Join-Path $tujuan "WebView2Loader.dll") -Force
    }
    if ($SimpanPaket) {
        Write-Host "  [2/3] paket     : disimpan di $CacheDir"
    } else {
        Remove-Item $Isi -Recurse -Force
        Remove-Item $Nupkg -Force
        if (Test-Path $CacheDir) { if ((Get-ChildItem $CacheDir -Force | Measure-Object).Count -eq 0) { Remove-Item $CacheDir -Force } }
        Write-Host "  [2/3] paket     : diambil lalu dibuang"
    }
}

Remove-Item (Join-Path $AppRoot "Microsoft.Web.WebView2.Wpf.dll") -Force -ErrorAction SilentlyContinue
foreach ($a in $Arsitektur) { Remove-Item (Join-Path $AppRoot ("runtimes\$a\native_uap")) -Recurse -Force -ErrorAction SilentlyContinue }

Get-Process -Name RiaCast -ErrorAction SilentlyContinue | ForEach-Object { try { $_.CloseMainWindow() | Out-Null } catch {}; Start-Sleep -Milliseconds 300; if (-not $_.HasExited) { $_.Kill() } }
Start-Sleep -Milliseconds 500

$Rsp = New-Object System.Collections.Generic.List[string]
$Rsp.Add("/nologo")
$Rsp.Add("/target:winexe")
$Rsp.Add("/platform:anycpu")
$Rsp.Add("/optimize+")
$Rsp.Add('/out:"' + $OutExe + '"')
if (Test-Path $FileIco) { $Rsp.Add('/win32icon:"' + $FileIco + '"') }
$Rsp.Add("/r:System.dll"); $Rsp.Add("/r:System.Core.dll")
$Rsp.Add("/r:System.Drawing.dll"); $Rsp.Add("/r:System.Windows.Forms.dll")
foreach ($n in $DllPerlu) { $Rsp.Add('/r:"' + (Join-Path $AppRoot $n) + '"') }
$Rsp.Add('"' + $FileCs + '"')
$RspFile = Join-Path $env:TEMP "riacast-csc.rsp"
Set-Content -Path $RspFile -Value $Rsp -Encoding Unicode
Write-Host "  [3/3] kompilasi -> RiaCast.exe ..."
& $Csc ("@" + $RspFile)
$kode = $LASTEXITCODE
Remove-Item $RspFile -Force -ErrorAction SilentlyContinue
if ($kode -ne 0 -or -not (Test-Path $OutExe)) { throw "Kompilasi gagal (exit=$kode)." }

Write-Host ""
Write-Host "  OK = $OutExe"
Write-Host "  Cangkang memuat: https://riacaya.github.io/RiaCast/"
Write-Host "  Fitur: tray, minimize-to-tray, opsi startup Windows (menu tray)."
Write-Host "  Log: %LOCALAPPDATA%\RiaCast\riacast-shell.log"
