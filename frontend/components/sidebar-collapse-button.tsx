"use client";

import { useLayoutState } from "@/components/layout-state-provider";

type SidebarCollapseButtonProps = {
  className?: string;
};

function PanelLeftIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <rect height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" width="14" x="5" y="5" />
      <path d="M10 5v14" stroke="currentColor" strokeWidth="1.8" />
      <path d="m14.5 9.5-2.5 2.5 2.5 2.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

export function SidebarCollapseButton({ className = "" }: SidebarCollapseButtonProps) {
  const { isSidebarCollapsed, toggleSidebar } = useLayoutState();

  return (
    <button
      aria-label={isSidebarCollapsed ? "Expandir menú" : "Colapsar menú"}
      className={`tenant-sidebar-control ${className}`.trim()}
      onClick={toggleSidebar}
      title={isSidebarCollapsed ? "Expandir menú" : "Colapsar menú"}
      type="button"
    >
      <PanelLeftIcon />
    </button>
  );
}
