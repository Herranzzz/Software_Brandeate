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
const SIDEBAR_KEY = "brandeate.sidebar.collapsed";

const LayoutStateContext = createContext<LayoutStateValue | null>(null);

function resolveInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const storedTheme = window.localStorage.getItem(THEME_KEY);
  if (storedTheme === "dark" || storedTheme === "light") return storedTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveInitialSidebar(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_KEY) === "true";
}

export function LayoutStateProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setTheme(resolveInitialTheme());
    setIsSidebarCollapsed(resolveInitialSidebar());
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [isReady, theme]);

  useEffect(() => {
    if (!isReady) return;
    document.documentElement.dataset.sidebarCollapsed = isSidebarCollapsed ? "true" : "false";
    window.localStorage.setItem(SIDEBAR_KEY, isSidebarCollapsed ? "true" : "false");
  }, [isReady, isSidebarCollapsed]);

  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((current) => !current);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo<LayoutStateValue>(
    () => ({
      isSidebarCollapsed,
      isReady,
      theme,
      toggleSidebar,
      toggleTheme,
    }),
    [isSidebarCollapsed, isReady, theme, toggleSidebar, toggleTheme],
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
