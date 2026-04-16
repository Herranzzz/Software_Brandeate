import { type NextRequest, NextResponse } from "next/server";


export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const os = searchParams.get("os") ?? "windows";

  const appUrl = origin;

  if (os === "mac") {
    // IMPORTANT: `open -a "Google Chrome" --args` reuses an existing Chrome
    // process and the --kiosk-printing flag is silently ignored.
    // Calling the binary directly with --user-data-dir forces a NEW process
    // that always has the flag active, even when regular Chrome is open.
    const content = [
      "#!/bin/bash",
      "# Brandeate - Acceso directo para maquinas de etiquetas (Mac)",
      "# Abre Chrome con --kiosk-printing: imprime directamente sin dialogo.",
      "# Primera vez: click derecho -> Abrir (para dar permiso). Luego doble clic.",
      "",
      'CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"',
      'KIOSK_DIR="$HOME/.config/chrome-kiosk-print"',
      "",
      '# Lanzar Chrome en un perfil aislado para que --kiosk-printing siempre este activo',
      '# aunque ya haya una ventana normal de Chrome abierta.',
      '"$CHROME" --kiosk-printing --user-data-dir="$KIOSK_DIR" \\'
      ,`  "${appUrl}/employees/print-queue" &`,
      "",
    ].join("\n");

    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="abrir-chrome-impresora.command"',
        "Cache-Control": "no-store",
      },
    });
  }

  // Default: Windows .bat
  // IMPORTANT: `start chrome.exe --kiosk-printing` with Chrome already open
  // adds a tab to the existing process WITHOUT the flag.
  // --user-data-dir forces a separate Chrome process that always starts fresh.
  const content = [
    "@echo off",
    "REM Brandeate - Acceso directo para maquinas de etiquetas (Windows)",
    "REM Abre Chrome con --kiosk-printing: imprime directamente sin dialogo.",
    "REM Usa un perfil separado para que la flag siempre este activa.",
    `set CHROME="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"`,
    `if not exist %CHROME% set CHROME="C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"`,
    `set KIOSK_DIR=%LOCALAPPDATA%\\ChromeKioskPrint`,
    `start "" %CHROME% --kiosk-printing --user-data-dir="%KIOSK_DIR%" ${appUrl}/employees/print-queue`,
    "",
  ].join("\r\n");

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="abrir-chrome-impresora.bat"',
      "Cache-Control": "no-store",
    },
  });
}
