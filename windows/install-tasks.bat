@echo off
set "ROOT=C:\Site_imp\kapil-windows\JayeshVegda-Kapil_pro-49c561a"
set "LAUNCHER=%ROOT%\windows\start-kapil-task.bat"
set "TRIGGER=cmd /c ""%LAUNCHER%"""

schtasks /create /f /tn "Kapil Billing Start"    /tr "%TRIGGER%" /sc onlogon /rl limited
schtasks /create /f /tn "Kapil Billing Watchdog" /tr "%TRIGGER%" /sc minute /mo 10 /rl limited
schtasks /query /tn "Kapil Billing Start"    /fo list | findstr /i "TaskName Status Run"
schtasks /query /tn "Kapil Billing Watchdog" /fo list | findstr /i "TaskName Status Run"
schtasks /run /tn "Kapil Billing Start"
