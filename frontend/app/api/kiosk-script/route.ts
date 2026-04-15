import { type NextRequest, NextResponse } from "next/server";


export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const os = searchParams.get("os") ?? "windows";

  const appUrl = origin;

  if (os === "mac") {
    const content = [
      "#!/bin/bash",
      "# Brandeate - Acceso directo para maquinas de etiquetas (Mac)",
      "# Abre Chrome con --kiosk-printing: imprime directamente sin dialogo.",
      "# Primera vez: click derecho -> Abrir. Luego doble clic normal.",
      `open -a "Google Chrome" --args --kiosk-printing ${appUrl}`,
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
  const content = [
    "@echo off",
    "REM Brandeate - Acceso directo para maquinas de etiquetas (Windows)",
    "REM Abre Chrome con --kiosk-printing: imprime directamente sin dialogo.",
    `set CHROME="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"`,
    `if not exist %CHROME% set CHROME="C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"`,
    `start "" %CHROME% --kiosk-printing ${appUrl}`,
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
