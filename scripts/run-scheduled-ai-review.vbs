' Launches run-scheduled-ai-review.cmd with no visible console window.
' Windows Task Scheduler would otherwise flash a black window every run.
Dim shell, fso, here
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & here & "\run-scheduled-ai-review.cmd""", 0, False
