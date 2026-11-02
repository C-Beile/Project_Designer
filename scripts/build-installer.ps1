# Builds the Forge installer/bundle for a given Rust target triple. The target is a parameter,
# not a hardcoded value, so a later macOS round only has to pass `-Target aarch64-apple-darwin`
# here - no build-script rewrite (chef-prompt §2.3 / packager.md Teil B point 3). Only
# `x86_64-pc-windows-gnu` is actually built/tested on this machine today; the macOS path is
# structurally present but unverified (no Mac hardware available - not claimed to work).
#
# Usage:
#   ./scripts/build-installer.ps1                                  # default: x86_64-pc-windows-gnu
#   ./scripts/build-installer.ps1 -Target aarch64-apple-darwin      # future macOS target (untested here)

param(
    [string]$Target = "x86_64-pc-windows-gnu"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

# RISKS.md R22: tauri-winres/embed-resource shells out to a bare "windres" via PATH with no env
# var override, and a `.cargo/config.toml` PATH force has proven unreliable for it in long-running
# sessions - the verified workaround is prepending the WinLibs mingw64 bin dir in the *calling*
# shell before every build that goes through app/src-tauri.
$MingwBin = "C:\Users\ClemensBeile\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
if (Test-Path $MingwBin) {
    $env:PATH = "$MingwBin;$env:PATH"
}

Write-Host "Building Forge installer for target: $Target"

Push-Location (Join-Path $RepoRoot "app")
try {
    # `cargo tauri build --target <triple>` drives both the Rust release build and Tauri's own
    # bundler (msi/nsis on Windows, per tauri.conf.json's bundle.targets) in one step - no extra
    # packaging tool, per packager.md's "keine externe Zusatzsoftware ohne triftigen Grund".
    # The Tauri CLI is installed in ui/node_modules; --prefix runs it from there while the working
    # directory stays app/, where it finds src-tauri/tauri.conf.json.
    $env:CARGO_NET_OFFLINE = "true"
    $ErrorActionPreference = "Continue"
    npx --prefix ui tauri build --target $Target
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
}
