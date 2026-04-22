import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { LayoutStateProvider } from "@/components/layout-state-provider";
import { fetchCurrentUser } from "@/lib/auth";

import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit",
  weight: ["300", "400", "500", "600", "700", "800"],
});


export const metadata: Metadata = {
  title: {
    default: "Brandeate",
    template: "%s | Brandeate",
  },
  description: "Plataforma operativa de Brandeate para pedidos, seguimiento, clientes e integraciones.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};


export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const currentUser = await fetchCurrentUser();
  return (
    <html lang="es" suppressHydrationWarning className={outfit.variable}>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
              try {
                const storedTheme = localStorage.getItem("brandeate.theme");
                const theme =
                  storedTheme === "dark" || storedTheme === "light"
                    ? storedTheme
                    : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
                document.documentElement.dataset.theme = theme;
                const storedSidebar = localStorage.getItem("brandeate.sidebar.collapsed");
                document.documentElement.dataset.sidebarCollapsed = storedSidebar === "true" ? "true" : "false";
              } catch {}
            })();`,
          }}
        />
        <LayoutStateProvider>
          <AppShell currentUser={currentUser ? { name: currentUser.name, role: currentUser.role } : null}>
            {children}
          </AppShell>
        </LayoutStateProvider>
      </body>
    </html>
  );
}
