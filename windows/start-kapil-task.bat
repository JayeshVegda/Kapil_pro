@echo off
rem Kapil Billing launcher for Task Scheduler — no PowerShell dependency.
rem Idempotent: skips any component that is already healthy, so it is safe to
rem run at logon AND every few minutes as a watchdog.
setlocal
set "ROOT=C:\Site_imp\kapil-windows\JayeshVegda-Kapil_pro-49c561a"
set "CURL=%SystemRoot%\System32\curl.exe"
set "PBLOG=%ROOT%\runtime\logs"
if not exist "%PBLOG%" mkdir "%PBLOG%" >nul 2>&1

rem --- PocketBase ---
"%CURL%" -s -m 3 -o nul http://127.0.0.1:8090/api/health
if %errorlevel%==0 goto :caddy
start "Kapil PocketBase" /min /d "%ROOT%" cmd /c ""%ROOT%\runtime\bin\pocketbase.exe" serve --dir "%ROOT%\runtime\data" --http 127.0.0.1:8090 --migrationsDir "%ROOT%\pb_migrations" > "%PBLOG%\pocketbase.out.log" 2> "%PBLOG%\pocketbase.err.log""

:caddy
rem --- Caddy (UI + /pb proxy + Tailscale entry) ---
"%CURL%" -s -m 3 -o nul http://127.0.0.1:4174/
if %errorlevel%==0 goto :done
set "KAPIL_DIST_DIR=%ROOT:/=\%\dist"
set "KAPIL_DIST_DIR=%KAPIL_DIST_DIR:\=/%"
start "Kapil Caddy" /min /d "%ROOT%" cmd /c ""%ROOT%\runtime\bin\caddy.exe" run --config "%ROOT%\windows\Caddyfile" --adapter caddyfile > "%PBLOG%\caddy.out.log" 2> "%PBLOG%\caddy.err.log""

:done
exit /b 0
