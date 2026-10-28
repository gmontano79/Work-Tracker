Option Explicit
' Gracefully stops the Work Tracker local service. It does NOT delete the DB.
Dim sh, fso, root, reqPath, url, i, stopFile
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
reqPath = root & "\.work_tracker_stop_request"
url = "http://127.0.0.1:8765"

Function IsWorkTrackerOnline()
  On Error Resume Next
  Dim http
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

If Not IsWorkTrackerOnline() Then
  MsgBox "Work Tracker is not running. Nothing to stop.", vbInformation, "Work Tracker"
  WScript.Quit 0
End If
Set stopFile = fso.CreateTextFile(reqPath, True)
stopFile.WriteLine "stop"
stopFile.Close
For i = 1 To 40
  WScript.Sleep 250
  If Not IsWorkTrackerOnline() Then
    MsgBox "Work Tracker has stopped. Your tickets, projects, tasks and SQLite data remain saved.", vbInformation, "Work Tracker"
    WScript.Quit 0
  End If
Next
MsgBox "The app did not stop within 10 seconds. If it was launched from an older version, close its original CMD window and restart using WorkTracker_Start.vbs.", vbExclamation, "Work Tracker"
