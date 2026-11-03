Set WshShell = CreateObject("WScript.Shell")
ROOT = "C:\Site_imp\kapil-windows\JayeshVegda-Kapil_pro-49c561a"

Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
pbOk = False
On Error Resume Next
http.open "GET", "http://127.0.0.1:8090/api/health", False
http.setTimeouts 1500, 1500, 1500, 1500
http.send
If Err.Number = 0 And http.status = 200 Then pbOk = True
Err.Clear

caddyOk = False
http.open "GET", "http://127.0.0.1:4174/", False
http.setTimeouts 1500, 1500, 1500, 1500
http.send
If Err.Number = 0 And http.status >= 200 And http.status < 400 Then caddyOk = True
Err.Clear
On Error GoTo 0

If (Not pbOk) Or (Not caddyOk) Then
    WshShell.Run "wscript.exe """ & ROOT & "\windows\start-silent.vbs""", 0, False
End If
