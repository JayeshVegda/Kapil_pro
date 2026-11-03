Set WshShell = CreateObject("WScript.Shell")
ROOT = "C:\Site_imp\kapil-windows\JayeshVegda-Kapil_pro-49c561a"
cmd = "C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ROOT & "\windows\start-kapil.ps1"" -NoBrowser"
WshShell.Run cmd, 0, True
