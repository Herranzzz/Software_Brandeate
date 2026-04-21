import { type NextRequest, NextResponse } from "next/server";


export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const os = searchParams.get("os") ?? "windows";

  const appUrl = origin;
  const targetUrl = `${appUrl}/employees/print-queue`;

  if (os === "mac") {
    // Chrome solo respeta --kiosk-printing cuando arranca desde cero.
    // Si ya hay un proceso corriendo, la flag se ignora y simplemente se
    // añade una pestaña. Por eso cerramos Chrome antes de relanzarlo con
    // tu perfil normal (sin --user-data-dir), así mantienes bookmarks,
    // sesión iniciada, etc. No es un perfil de "invitado" ni aislado.
    const content = [
      "#!/bin/bash",
      "# Brandeate - Acceso directo para imprimir etiquetas sin dialogo (Mac)",
      "# Reutiliza tu Chrome normal (tu perfil, tus bookmarks, tu sesion).",
      "# Primera vez: click derecho -> Abrir (para dar permiso). Luego doble clic.",
      "",
      'CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"',
      "",
      "# 1. Cerrar Chrome si estuviese abierto (la flag --kiosk-printing",
      "#    solo se aplica al lanzar un proceso nuevo).",
      'osascript -e \'tell application "Google Chrome" to quit\' >/dev/null 2>&1',
      "sleep 1",
      "# Por si queda algun proceso residual.",
      'pkill -x "Google Chrome" >/dev/null 2>&1',
      "sleep 1",
      "",
      "# 2. Relanzar Chrome con tu perfil normal + la flag de impresion silenciosa.",
      `"$CHROME" --kiosk-printing "${targetUrl}" &`,
      "",
      "disown",
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

  // Windows .bat
  // Igual que en Mac: cerramos Chrome antes de relanzarlo con --kiosk-printing
  // para que use tu perfil de siempre y la flag tenga efecto.
  const content = [
    "@echo off",
    "REM Brandeate - Acceso directo para imprimir etiquetas sin dialogo (Windows)",
    "REM Reutiliza tu Chrome normal (tu perfil, tus bookmarks, tu sesion).",
    "",
    `set CHROME="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"`,
    `if not exist %CHROME% set CHROME="C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"`,
    "",
    "REM 1. Cerrar Chrome (la flag --kiosk-printing solo funciona al arrancar).",
    "taskkill /IM chrome.exe /F >nul 2>&1",
    "timeout /t 2 /nobreak >nul",
    "",
    "REM 2. Relanzar Chrome con tu perfil de siempre + impresion silenciosa.",
    `start "" %CHROME% --kiosk-printing ${targetUrl}`,
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
