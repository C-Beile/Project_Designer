@echo off
rem Baut Dito Designer und erzeugt den .exe-Installer (NSIS). Start per Doppelklick.
rem Ergebnis: target\release\bundle\nsis\*.exe  (Ordner oeffnet sich am Ende)
setlocal
cd /d "%~dp0"

rem MSVC-Toolchain erzwingen (rust-toolchain.toml kann auf GNU stehen).
set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc

if not exist "app\ui\node_modules" (
    echo [1/2] npm install ...
    pushd app\ui
    call npm install
    if errorlevel 1 ( popd & goto :fail )
    popd
)

rem Ohne Updater-Schluessel schlaegt der Build bei createUpdaterArtifacts fehl.
rem Dann wird die Update-Datei weggelassen. Der Installer bleibt gleich.
set CFG=
if "%TAURI_SIGNING_PRIVATE_KEY%"=="" if "%TAURI_SIGNING_PRIVATE_KEY_PATH%"=="" (
    echo Kein TAURI_SIGNING_PRIVATE_KEY gesetzt: baue ohne Updater-Artefakte.
    echo {"bundle":{"createUpdaterArtifacts":false}}> "%TEMP%\dito-no-updater.json"
    set CFG=--config "%TEMP%\dito-no-updater.json"
)

echo [2/2] tauri build ...
pushd app
call npx --prefix ui tauri build --bundles nsis %CFG%
set RC=%ERRORLEVEL%
popd
if not "%RC%"=="0" goto :fail

echo.
echo Fertig. Installer:
dir /b "target\release\bundle\nsis\*.exe"
start "" "target\release\bundle\nsis"
echo.
pause
exit /b 0

:fail
echo.
echo Build fehlgeschlagen.
pause
exit /b 1
