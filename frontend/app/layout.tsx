import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { LayoutStateProvider } from "@/components/layout-state-provider";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});


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
    <html lang="es" suppressHydrationWarning className={inter.variable}>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
              try {
                const storedTheme = localStorage.getItem("brandeate.theme");
                const storedSidebar = localStorage.getItem("brandeate.sidebar.collapsed");
                const theme =
                  storedTheme === "dark" || storedTheme === "light"
                    ? storedTheme
                    : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
                document.documentElement.dataset.theme = theme;
                document.documentElement.dataset.sidebarCollapsed = storedSidebar === "true" ? "true" : "false";
              } catch {}
            })();`,
          }}
        />
        <LayoutStateProvider>
          <AppShell>{children}</AppShell>
        </LayoutStateProvider>
      </body>
    </html>
  );
}
