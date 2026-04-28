import { type NextRequest, NextResponse } from "next/server";


/**
 * Generates a per-OS launcher script for the kiosk-printing Chrome flow.
 *
 * Query params:
 *   - os:      "windows" | "mac"
 *   - printer: optional printer name. If provided, the script sets it as the
 *              system default before launching Chrome. This is how you route
 *              labels to a Zebra/label printer independently of the user's
 *              normal default (which may be a regular A4 printer).
 *
 *              Chrome's --kiosk-printing ALWAYS prints to the OS default
 *              printer — there is no browser API to pick a printer. So we
 *              change the default at the OS level right before launching.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const os = searchParams.get("os") ?? "windows";
  const printer = (searchParams.get("printer") ?? "").trim();
  const appUrl = origin;
  // ?kiosk=1 lets the page auto-enable the silent-print preference on first
  // load so the operator never has to also flip the /settings toggle by hand.
  const targetUrl = `${appUrl}/employees/print-queue?kiosk=1`;

  const slug = printer
    ? printer.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "impresora"
    : "";

  if (os === "mac") {
    const filename = slug
      ? `abrir-chrome-${slug}.command`
      : "abrir-chrome-impresora.command";

    // Shell-escape the printer name for /bin/bash single-quoted strings.
    const escapedPrinter = printer.replace(/'/g, "'\"'\"'");

    const lines: string[] = [
      "#!/bin/bash",
      "# Brandeate - Acceso directo para imprimir etiquetas sin dialogo (Mac)",
      "# Reutiliza tu Chrome normal (tu perfil, tus bookmarks, tu sesion).",
      "# Primera vez: click derecho -> Abrir (para dar permiso). Luego doble clic.",
      "",
      'CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"',
      "",
    ];

    if (printer) {
      lines.push(
        `# 1. Fijar la impresora de etiquetas como predeterminada del sistema.`,
        `#    CUPS expone ese cambio en el siguiente job; no afecta a GUI apps abiertas.`,
        `PRINTER_NAME='${escapedPrinter}'`,
        `if command -v lpoptions >/dev/null 2>&1; then`,
        `  lpoptions -d "$PRINTER_NAME" >/dev/null 2>&1 || \\`,
        `    echo "[Brandeate] Aviso: no se pudo fijar la impresora '$PRINTER_NAME' como predeterminada. Compruebala en Ajustes > Impresoras."`,
        `fi`,
        "",
      );
    }

    lines.push(
      "# 2. Cerrar Chrome si estuviese abierto (la flag --kiosk-printing",
      "#    solo se aplica al lanzar un proceso nuevo).",
      'osascript -e \'tell application "Google Chrome" to quit\' >/dev/null 2>&1',
      "sleep 1",
      'pkill -x "Google Chrome" >/dev/null 2>&1',
      "sleep 1",
      "",
      "# 3. Relanzar Chrome con tu perfil normal + la flag de impresion silenciosa.",
      `"$CHROME" --kiosk-printing "${targetUrl}" &`,
      "",
      "disown",
      "",
    );

    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Windows .bat
  const filename = slug
    ? `abrir-chrome-${slug}.bat`
    : "abrir-chrome-impresora.bat";

  // Escape double quotes inside the batch file — rare but possible in printer names.
  const escapedPrinter = printer.replace(/"/g, '""');

  const lines: string[] = [
    "@echo off",
    "REM Brandeate - Acceso directo para imprimir etiquetas sin dialogo (Windows)",
    "REM Reutiliza tu Chrome normal (tu perfil, tus bookmarks, tu sesion).",
    "",
    `set CHROME="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"`,
    `if not exist %CHROME% set CHROME="C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"`,
    "",
  ];

  if (printer) {
    lines.push(
      "REM 1. Fijar la impresora de etiquetas como predeterminada del sistema.",
      "REM    Usamos PowerShell (Set-Printer) y, si falla, wmic como fallback.",
      `set PRINTER_NAME="${escapedPrinter}"`,
      `powershell -NoProfile -Command "(New-Object -ComObject WScript.Network).SetDefaultPrinter(%PRINTER_NAME%)" >nul 2>&1`,
      `if errorlevel 1 wmic printer where name=%PRINTER_NAME% call setdefaultprinter >nul 2>&1`,
      "",
    );
  }

  lines.push(
    "REM 2. Cerrar Chrome (la flag --kiosk-printing solo funciona al arrancar).",
    "taskkill /IM chrome.exe /F >nul 2>&1",
    "timeout /t 2 /nobreak >nul",
    "",
    "REM 3. Relanzar Chrome con tu perfil de siempre + impresion silenciosa.",
    `start "" %CHROME% --kiosk-printing ${targetUrl}`,
    "",
  );

  return new NextResponse(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
