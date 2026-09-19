@echo off
title La Bankota - Deploy a GitHub
color 0A
cd /d "A:\New-LA_BANKOTA\bankota-v2\backend-postgres"
echo ========================================================
echo   SUBIENDO CAMBIOS DE LA BANKOTA A GITHUB Y RENDER
echo ========================================================
echo.
powershell.exe -ExecutionPolicy Bypass -File "A:\New-LA_BANKOTA\bankota-v2\backend-postgres\deploy.ps1"
echo.
echo Presiona cualquier tecla para cerrar esta ventana...
pause >nul
