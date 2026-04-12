"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type SettingsTab = {
  id: string;
  label: string;
  icon: string;
};

type SettingsTabsProps = {
  tabs: SettingsTab[];
  preserveParams?: string[]; // extra searchParams to keep (e.g. "shop_id")
};

export function SettingsTabs({ tabs, preserveParams = [] }: SettingsTabsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") ?? tabs[0]?.id;

  function buildHref(tabId: string) {
    const params = new URLSearchParams();
    params.set("tab", tabId);
    preserveParams.forEach((key) => {
      const val = searchParams.get(key);
      if (val) params.set(key, val);
    });
    return `${pathname}?${params.toString()}`;
  }

  return (
    <nav className="settings-tabs-nav" aria-label="Secciones de ajustes">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={buildHref(tab.id)}
          className={`settings-tab-link${activeTab === tab.id ? " settings-tab-active" : ""}`}
          scroll={false}
        >
          <span className="settings-tab-icon">{tab.icon}</span>
          <span className="settings-tab-label">{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}
