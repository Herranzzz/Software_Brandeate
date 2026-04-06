"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type AppModalProps = {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  width?: "default" | "wide";
  bodyClassName?: string;
};

export function AppModal({
  open,
  onClose,
  eyebrow,
  title,
  subtitle,
  actions,
  children,
  width = "default",
  bodyClassName = "",
}: AppModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!mounted || !open) {
    return null;
  }

  return createPortal(
    <div
      className="app-modal-backdrop"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        aria-modal="true"
        className={`app-modal-sheet${width === "wide" ? " app-modal-sheet-wide" : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="app-modal-head">
          <div>
            {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
            <h3 className="section-title section-title-small">{title}</h3>
            {subtitle ? <p className="subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="app-modal-actions">{actions}</div> : null}
        </div>

        <div className={`app-modal-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
