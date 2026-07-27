@echo off
title Start Letter Chatter
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
if errorlevel 1 (
  echo.
  echo Letter Chatter could not start. See the message above.
  pause
)
