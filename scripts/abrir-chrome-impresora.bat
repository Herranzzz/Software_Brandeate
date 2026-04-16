@echo off
REM ─────────────────────────────────────────────────────────────────────────────
REM  Brandeate · Acceso directo para máquinas de etiquetas (Windows)
REM
REM  Abre Chrome con --kiosk-printing para que window.print() envíe
REM  directamente a la impresora sin mostrar ningún diálogo.
REM
REM  INSTRUCCIONES:
REM    1. Copia este archivo al escritorio de cada máquina con impresora.
REM    2. Haz doble clic para abrir Chrome listo para imprimir.
REM
REM  POR QUÉ --user-data-dir:
REM    Si Chrome ya está abierto, "start chrome.exe --kiosk-printing" abre una
REM    ventana en el proceso existente y el flag se ignora. Con --user-data-dir
REM    se fuerza un proceso nuevo que siempre arranca con la flag activa.
REM ─────────────────────────────────────────────────────────────────────────────

REM Ruta de Chrome estándar — cámbiala si está instalado en otro lugar
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"

REM Si no existe en Program Files, prueba Program Files (x86)
if not exist %CHROME% (
    set CHROME="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

REM Perfil separado para que --kiosk-printing siempre esté activo
set KIOSK_DIR=%LOCALAPPDATA%\ChromeKioskPrint

start "" %CHROME% --kiosk-printing --user-data-dir="%KIOSK_DIR%" https://app.brandeate.com/employees/print-queue

REM Si Chrome no se encuentra en ninguna ruta estándar, avisa al usuario
if errorlevel 1 (
    echo.
    echo ERROR: No se encontro Chrome en las rutas habituales.
    echo Edita este archivo y ajusta la variable CHROME con la ruta correcta.
    pause
)
