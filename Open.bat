@echo off
cd /d "%~dp0"
if not exist "BOM_SMT_Comparator.html" (
  echo BOM_SMT_Comparator.html was not found in this folder.
  pause
  exit /b 1
)
start "" "%~dp0BOM_SMT_Comparator.html"
