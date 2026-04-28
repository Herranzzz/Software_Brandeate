"use client";

import { useEffect, useState } from "react";

export type Density = "compact" | "normal" | "spacious";

const STORAGE_KEY = "brandeate-density";
const DENSITIES: { value: Density; icon: string; label: string }[] = [
  { value: "compact",  icon: "≡", label: "Compacto" },
  { value: "normal",   icon: "☰", label: "Normal" },
  { value: "spacious", icon: "≣", label: "Espacioso" },
];

function applyDensity(density: Density) {
  document.documentElement.setAttribute("data-density", density);
}

export function DensityToggle() {
  const [density, setDensity] = useState<Density>("normal");

  // Read from localStorage on mount and apply
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Density | null;
    const initial: Density = stored && ["compact", "normal", "spacious"].includes(stored) ? stored : "normal";
    setDensity(initial);
    applyDensity(initial);
  }, []);

  function handleChange(next: Density) {
    setDensity(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyDensity(next);
  }

  return (
    <div className="density-toggle" role="group" aria-label="Densidad de tabla">
      {DENSITIES.map(({ value, icon, label }) => (
        <button
          key={value}
          type="button"
          className={`density-btn${density === value ? " is-active" : ""}`}
          aria-label={label}
          aria-pressed={density === value}
          title={label}
          onClick={() => handleChange(value)}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
