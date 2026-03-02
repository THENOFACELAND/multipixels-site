@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Ce dossier n'est pas un depot Git.
  pause
  exit /b 1
)

set "MSG=%*"
if "%~1"=="" set "MSG=Mise a jour site"

echo.
echo [1/4] Ajout des fichiers...
git add .
if errorlevel 1 (
  echo [ERREUR] git add a echoue.
  pause
  exit /b 1
)

echo [2/4] Verification des changements...
git diff --cached --quiet
if %errorlevel%==0 (
  echo Aucun changement a deployer.
  pause
  exit /b 0
)

echo [3/4] Commit...
git commit -m "%MSG%"
if errorlevel 1 (
  echo [ERREUR] Commit impossible.
  pause
  exit /b 1
)

echo [4/4] Push vers GitHub...
git push
if errorlevel 1 (
  echo [ERREUR] Push echoue.
  pause
  exit /b 1
)

echo.
echo Deploiement termine avec succes.
echo GitHub Pages mettra le site a jour automatiquement.
pause
exit /b 0
