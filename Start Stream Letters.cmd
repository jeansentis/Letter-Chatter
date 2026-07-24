@echo off
title Start Stream Letters
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
if errorlevel 1 (
  echo.
  echo Stream Letters could not start. See the message above.
  pause
)
