@echo off
setlocal
cd /d "%~dp0"
title SimpliLidarViewer

echo.
echo  ==========================================
echo    SimpliLidarViewer  ^|  Local Launcher
echo  ==========================================
echo.
echo  Starting a local web server so that LAZ
echo  files and CDN libraries load correctly.
echo.
echo  The viewer will open in your browser.
echo  Close this window to stop the server.
echo  ==========================================
echo.

:: ── Try Python 3 (python command) ─────────────────────────────────
python --version >nul 2>&1
if not errorlevel 1 (
    echo  [OK] Using Python  ^(python -m http.server 8080^)
    echo.
    start "" "http://localhost:8080"
    python -m http.server 8080
    goto :done
)

:: ── Try Python 3 launcher (py command, Windows Launcher) ──────────
py --version >nul 2>&1
if not errorlevel 1 (
    echo  [OK] Using Python launcher  ^(py -m http.server 8080^)
    echo.
    start "" "http://localhost:8080"
    py -m http.server 8080
    goto :done
)

:: ── Try Node.js + npx serve ───────────────────────────────────────
node --version >nul 2>&1
if not errorlevel 1 (
    echo  [OK] Using Node.js  ^(npx serve -l 8080^)
    echo.
    start "" "http://localhost:8080"
    npx --yes serve -l 8080 .
    goto :done
)

:: ── Nothing found ─────────────────────────────────────────────────
echo  [ERROR] No web server found on this machine.
echo.
echo  To fix this, install Python (recommended):
echo    https://www.python.org/downloads/
echo    (Tick "Add Python to PATH" during setup)
echo.
echo  Then run this launcher again.
echo.
echo  TIP: For .las files only, you can also open
echo  index.html directly in your browser without
echo  needing this launcher.
echo.
pause

:done
endlocal
