#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  Brandeate · Acceso directo para máquinas de etiquetas (Mac)
#
#  Abre Chrome con --kiosk-printing para que window.print() envíe
#  directamente a la impresora sin mostrar ningún diálogo.
#
#  INSTRUCCIONES:
#    1. Copia este archivo al escritorio de cada máquina con impresora.
#    2. La primera vez: click derecho → Abrir (para dar permiso de ejecución).
#    3. A partir de entonces: doble clic abre Chrome listo para imprimir.
#
#  POR QUÉ --user-data-dir:
#    "open -a Google Chrome --args --kiosk-printing" reutiliza el proceso de
#    Chrome que ya está abierto y el flag se ignora. Llamar al binario
#    directamente con un directorio de perfil separado fuerza un proceso nuevo
#    que siempre arranca con --kiosk-printing activo.
# ─────────────────────────────────────────────────────────────────────────────

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
KIOSK_DIR="$HOME/.config/chrome-kiosk-print"

"$CHROME" --kiosk-printing --user-data-dir="$KIOSK_DIR" \
  "https://app.brandeate.com/employees/print-queue" &
