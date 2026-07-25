@echo off
title Start Letter Chatters
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
if errorlevel 1 (
  echo.
  echo Letter Chatters could not start. See the message above.
  pause
)
