Option Explicit
' Work Tracker launcher. Runs the existing Python app with its console hidden.
Dim sh, fso, root, url, i, cmd
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://127.0.0.1:8765"
sh.CurrentDirectory = root

Function IsWorkTrackerOnline()
  On Error Resume Next
  Dim http, result
  IsWorkTrackerOnline = False
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  If Err.Number <> 0 Then
    Err.Clear
    Exit Function
  End If
  http.setTimeouts 300, 300, 300, 1000
  http.Open "GET", url & "/api/settings", False
  http.Send
  If Err.Number = 0 Then
    IsWorkTrackerOnline = (http.Status = 200 And InStr(1, http.responseText, "database_file", vbTextCompare) > 0)
  End If
  Err.Clear
End Function

If IsWorkTrackerOnline() Then
  sh.Run url, 1, False
  WScript.Quit 0
End If
If Not fso.FileExists(root & "\launch_windows.bat") Then
  MsgBox "Cannot find launch_windows.bat in " & root, vbExclamation, "Work Tracker"
  WScript.Quit 1
End If
' Existing launcher starts the local Python service and opens Chrome once ready.
cmd = Chr(34) & root & "\launch_windows.bat" & Chr(34)
sh.Run cmd, 0, False
For i = 1 To 50
  WScript.Sleep 300
  If IsWorkTrackerOnline() Then WScript.Quit 0
Next
MsgBox "Work Tracker did not become available. For diagnosis, run launch_windows.bat once to see the error. Your saved data has not been deleted.", vbExclamation, "Work Tracker"
