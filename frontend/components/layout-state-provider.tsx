"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ToastProvider } from "@/components/toast";

type ThemeMode = "light" | "dark";

type LayoutStateValue = {
  isSidebarCollapsed: boolean;
  isReady: boolean;
  theme: ThemeMode;
  toggleSidebar: () => void;
  toggleTheme: () => void;
};

const THEME_KEY = "brandeate.theme";

const LayoutStateContext = createContext<LayoutStateValue | null>(null);

function resolveInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const storedTheme = window.localStorage.getItem(THEME_KEY);
  if (storedTheme === "dark" || storedTheme === "light") return storedTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function LayoutStateProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setTheme(resolveInitialTheme());
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [isReady, theme]);

  // Sidebar siempre desplegado — quitamos colapsado por completo.
  // Ensure the data attribute is reset on mount in case a stale value
  // from before this change was persisted to localStorage.
  useEffect(() => {
    if (!isReady) return;
    document.documentElement.dataset.sidebarCollapsed = "false";
    try {
      window.localStorage.removeItem("brandeate.sidebar.collapsed");
    } catch {
      // localStorage may be unavailable (private mode); ignore.
    }
  }, [isReady]);

  const toggleSidebar = useCallback(() => {
    // No-op: sidebar permanente.
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo<LayoutStateValue>(
    () => ({
      isSidebarCollapsed: false,
      isReady,
      theme,
      toggleSidebar,
      toggleTheme,
    }),
    [isReady, theme, toggleSidebar, toggleTheme],
  );

  return (
    <LayoutStateContext.Provider value={value}>
      <ToastProvider>{children}</ToastProvider>
    </LayoutStateContext.Provider>
  );
}

export function useLayoutState() {
  const value = useContext(LayoutStateContext);
  if (!value) {
    throw new Error("useLayoutState must be used within LayoutStateProvider");
  }
  return value;
}
