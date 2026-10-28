@echo off
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel% equ 0 (
  py -3 app.py
) else (
  where python >nul 2>&1
  if %errorlevel% equ 0 (
    python app.py
  ) else (
    echo Python 3 is required to run this local app.
    echo Ask IT whether Python is already approved on your PC.
    pause
  )
)
