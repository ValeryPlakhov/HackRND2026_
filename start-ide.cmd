@echo off
setlocal
cd /d "%~dp0"
if exist "output\desktop\BlueprintsIDE\BlueprintsIDE.exe" (
  start "" "output\desktop\BlueprintsIDE\BlueprintsIDE.exe"
  exit /b 0
)
if exist "output\desktop\Blueprints-IDE-3.exe" (
  start "" "output\desktop\Blueprints-IDE-3.exe"
  exit /b 0
)
echo Сначала соберите настольную версию: python tests\build_desktop.py
pause
