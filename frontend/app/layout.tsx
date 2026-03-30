import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";

import "./globals.css";


export const metadata: Metadata = {
  title: {
    default: "Brandeate",
    template: "%s | Brandeate",
  },
  description: "Plataforma operativa de Brandeate para pedidos, seguimiento, clientes e integraciones.",
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
