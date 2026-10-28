Option Explicit
' Opt-in: creates Desktop shortcuts. Does not configure Windows auto-start.
Dim sh, fso, root, desktop, wscriptExe, shortcut
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
desktop = sh.SpecialFolders("Desktop")
wscriptExe = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe"
If Not fso.FileExists(root & "\WorkTracker_Start.vbs") Then
  MsgBox "Missing WorkTracker_Start.vbs", vbExclamation, "Work Tracker"
  WScript.Quit 1
End If
Set shortcut = sh.CreateShortcut(desktop & "\Work Tracker.lnk")
shortcut.TargetPath = wscriptExe
shortcut.Arguments = Chr(34) & root & "\WorkTracker_Start.vbs" & Chr(34)
shortcut.WorkingDirectory = root
shortcut.Description = "Open Work Tracker in your browser (background SQLite server)"
If fso.FileExists(root & "\worktracker.ico") Then
  shortcut.IconLocation = root & "\worktracker.ico,0"
Else
  shortcut.IconLocation = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\shell32.dll, 3"
End If
shortcut.Save
Set shortcut = sh.CreateShortcut(desktop & "\Stop Work Tracker.lnk")
shortcut.TargetPath = wscriptExe
shortcut.Arguments = Chr(34) & root & "\WorkTracker_Stop.vbs" & Chr(34)
shortcut.WorkingDirectory = root
shortcut.Description = "Stop the Work Tracker background server gracefully"
shortcut.IconLocation = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\shell32.dll, 131"
shortcut.Save
MsgBox "Desktop shortcuts created: Work Tracker and Stop Work Tracker. Windows auto-start was NOT enabled.", vbInformation, "Work Tracker"
