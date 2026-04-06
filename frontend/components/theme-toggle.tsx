"use client";

import { useLayoutState } from "@/components/layout-state-provider";

type ThemeToggleProps = {
  className?: string;
};

function SunIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 3.5v2.2M12 18.3v2.2M5.64 5.64l1.56 1.56M16.8 16.8l1.56 1.56M3.5 12h2.2M18.3 12h2.2M5.64 18.36l1.56-1.56M16.8 7.2l1.56-1.56" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M19 14.8A7.8 7.8 0 0 1 9.2 5a8.4 8.4 0 1 0 9.8 9.8Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

export function ThemeToggle({ className = "" }: ThemeToggleProps) {
  const { theme, toggleTheme } = useLayoutState();
  const isDark = theme === "dark";

  return (
    <button
      aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className={`tenant-sidebar-control ${className}`.trim()}
      onClick={toggleTheme}
      title={isDark ? "Modo claro" : "Modo oscuro"}
      type="button"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
